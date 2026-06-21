"""
Import M25 corridor road network from the Overpass API into pgRouting-ready road_network table.

Run once after `docker compose up db -d`:
    docker compose exec backend python scripts/import_osm.py

Or locally (with .env set up):
    python scripts/import_osm.py
"""
import asyncio
import json
import math
import os
import sys
from collections import defaultdict

import asyncpg
import httpx
import osmium
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("DATABASE_URL", "postgresql://planner:planner_dev@localhost:5432/diversion_planner")
if "+asyncpg" in DB_URL:
    DB_URL = DB_URL.replace("postgresql+asyncpg://", "postgresql://")

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# M25 corridor bounding box: roughly SW corner of Surrey to NE corner of Essex
# [south, west, north, east]
BBOX = "51.0,-0.7,51.8,0.5"

HIGHWAY_TYPES = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link"

OVERPASS_QUERY = f"""
[out:json][timeout:120];
(
  way["highway"~"^({HIGHWAY_TYPES})$"]({BBOX});
);
out geom;
"""

HIERARCHY = {
    "motorway": 1, "motorway_link": 1,
    "trunk": 2, "trunk_link": 2,
    "primary": 3, "primary_link": 3,
    "secondary": 4, "secondary_link": 4,
}
DEFAULT_SPEEDS = {
    "motorway": 112, "motorway_link": 72,
    "trunk": 96, "trunk_link": 64,
    "primary": 64, "primary_link": 48,
    "secondary": 48, "secondary_link": 40,
}
ONE_WAY_TYPES = {"motorway", "motorway_link"}


def haversine_m(lng1, lat1, lng2, lat2) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(d / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def way_to_edges(way: dict) -> list[dict]:
    """
    Split an OSM way into individual edges (one per consecutive node pair).
    Each edge becomes a row in road_network.
    """
    tags = way.get("tags", {})
    highway = tags.get("highway", "unclassified")
    name = tags.get("name") or tags.get("ref") or highway.replace("_", " ").title()
    maxspeed_raw = tags.get("maxspeed")
    if maxspeed_raw:
        try:
            speed = int(str(maxspeed_raw).split()[0].replace("mph", "").strip())
        except (ValueError, AttributeError):
            speed = DEFAULT_SPEEDS.get(highway, 50)
    else:
        speed = DEFAULT_SPEEDS.get(highway, 50)
    rank = HIERARCHY.get(highway, 5)
    one_way = tags.get("oneway", "yes" if highway in ONE_WAY_TYPES else "no")
    hgv = tags.get("hgv", "yes") not in ("no", "private", "restricted")
    max_h = _parse_float(tags.get("maxheight"))
    max_w = _parse_float(tags.get("maxweight"))
    max_wi = _parse_float(tags.get("maxwidth"))

    geom_nodes = way.get("geometry", [])
    edges = []
    for i in range(len(geom_nodes) - 1):
        n1, n2 = geom_nodes[i], geom_nodes[i + 1]
        lng1, lat1 = n1["lon"], n1["lat"]
        lng2, lat2 = n2["lon"], n2["lat"]
        length = haversine_m(lng1, lat1, lng2, lat2)
        travel_min = (length / 1000) / speed * 60
        rev_cost = -1.0 if one_way == "yes" else travel_min

        edges.append({
            "osm_id": way["id"],
            "cost": round(travel_min, 6),
            "reverse_cost": round(rev_cost, 6),
            "length_m": round(length, 2),
            "name": name,
            "road_type": highway,
            "speed_limit": speed,
            "hierarchy_rank": rank,
            "hgv_suitable": hgv,
            "max_height_m": max_h,
            "max_weight_t": max_w,
            "max_width_m": max_wi,
            "geom_wkt": f"SRID=4326;LINESTRING({lng1} {lat1},{lng2} {lat2})",
        })
    return edges


def _parse_float(val) -> float | None:
    if not val:
        return None
    try:
        return float(str(val).replace("t", "").replace("m", "").strip())
    except ValueError:
        return None


class _WayHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []
        south, west, north, east = [float(x) for x in BBOX.split(",")]
        self._bbox = (south, west, north, east)
        self._types = set(HIGHWAY_TYPES.split("|"))

    def way(self, w):
        if w.tags.get("highway") not in self._types:
            return
        nodes = [{"lat": n.location.lat, "lon": n.location.lon}
                 for n in w.nodes if n.location.valid()]
        if len(nodes) < 2:
            return
        south, west, north, east = self._bbox
        lats = [n["lat"] for n in nodes]
        lons = [n["lon"] for n in nodes]
        if max(lats) < south or min(lats) > north or max(lons) < west or min(lons) > east:
            return
        self.ways.append({"id": w.id, "type": "way", "tags": dict(w.tags), "geometry": nodes})


def fetch_from_pbf(pbf_path: str) -> list[dict]:
    print(f"Reading road network from {pbf_path}...")
    handler = _WayHandler()
    handler.apply_file(pbf_path, locations=True)
    print(f"  Received {len(handler.ways)} OSM ways")
    return handler.ways


async def fetch_osm_data() -> list[dict]:
    # Split bbox into quadrants to avoid Overpass timeout on large areas
    south, west, north, east = [float(x) for x in BBOX.split(",")]
    mid_lat = (south + north) / 2
    mid_lng = (west + east) / 2
    quadrants = [
        f"{south},{west},{mid_lat},{mid_lng}",
        f"{south},{mid_lng},{mid_lat},{east}",
        f"{mid_lat},{west},{north},{mid_lng}",
        f"{mid_lat},{mid_lng},{north},{east}",
    ]

    ways_by_id: dict[int, dict] = {}
    async with httpx.AsyncClient(timeout=180) as client:
        for i, bbox in enumerate(quadrants, 1):
            query = f"""
[out:json][timeout:90];
(
  way["highway"~"^({HIGHWAY_TYPES})$"]({bbox});
);
out geom;
"""
            print(f"  Fetching quadrant {i}/4 ({bbox})...")
            for attempt in range(3):
                try:
                    resp = await client.post(
                        OVERPASS_URL,
                        data={"data": query},
                        headers={
                            "Content-Type": "application/x-www-form-urlencoded",
                            "Accept": "application/json",
                            "User-Agent": "M25TTRODiversionPlanner/1.0",
                        },
                    )
                    resp.raise_for_status()
                    break
                except Exception as e:
                    if attempt == 2:
                        raise
                    wait = 60 * (attempt + 1)
                    print(f"    Attempt {attempt+1} failed ({e}), retrying in {wait}s...")
                    await asyncio.sleep(wait)
            data = resp.json()
            for el in data.get("elements", []):
                if el["type"] == "way":
                    ways_by_id[el["id"]] = el
            if i < len(quadrants):
                print("  Waiting 20s before next quadrant...")
                await asyncio.sleep(20)

    ways = list(ways_by_id.values())
    print(f"  Received {len(ways)} unique OSM ways across all quadrants")
    return ways


async def insert_edges(conn: asyncpg.Connection, edges: list[dict]):
    print(f"Inserting {len(edges)} edges into road_network...")
    await conn.execute("TRUNCATE road_network RESTART IDENTITY CASCADE")
    await conn.executemany("""
        INSERT INTO road_network
            (osm_id, cost, reverse_cost, length_m, name, road_type, speed_limit,
             hierarchy_rank, hgv_suitable, max_height_m, max_weight_t, max_width_m, geom)
        VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ST_GeomFromEWKT($13))
    """, [
        (
            e["osm_id"], e["cost"], e["reverse_cost"], e["length_m"], e["name"],
            e["road_type"], e["speed_limit"], e["hierarchy_rank"], e["hgv_suitable"],
            e["max_height_m"], e["max_weight_t"], e["max_width_m"], e["geom_wkt"],
        )
        for e in edges
    ])
    print("  Edges inserted. Building pgRouting topology...")
    await conn.execute("""
        SELECT pgr_createTopology('road_network', 0.00001, 'geom', 'id', clean := true)
    """)
    count = await conn.fetchval("SELECT COUNT(*) FROM road_network")
    print(f"  Done. {count} edges in road_network.")


async def main():
    scripts_dir = os.path.dirname(__file__)
    county_files = [
        os.path.join(scripts_dir, f"{c}-latest.osm.pbf")
        for c in ("surrey", "kent", "essex", "hertfordshire", "buckinghamshire", "berkshire", "greater-london")
    ]
    pbf_files = [p for p in county_files if os.path.exists(p)]

    if pbf_files:
        ways_by_id = {}
        for pbf_path in pbf_files:
            for way in fetch_from_pbf(pbf_path):
                ways_by_id[way["id"]] = way
        ways = list(ways_by_id.values())
        print(f"  Total unique ways across all counties: {len(ways)}")
    else:
        ways = await fetch_osm_data()
    edges = []
    for way in ways:
        edges.extend(way_to_edges(way))
    print(f"Parsed {len(edges)} directed edges from {len(ways)} OSM ways")

    conn = await asyncpg.connect(DB_URL)
    try:
        await insert_edges(conn, edges)
    finally:
        await conn.close()
    print("Import complete.")


if __name__ == "__main__":
    asyncio.run(main())
