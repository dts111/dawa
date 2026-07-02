import os
import json
import math
import httpx
import asyncpg
from typing import Optional
from shapely.geometry import shape, mapping
from shapely.affinity import scale as shp_scale

ORS_URL = "https://api.openrouteservice.org/v2/directions/{profile}/geojson"
ORS_KEY = os.getenv("ORS_API_KEY", "")


async def find_nearest_node(conn: asyncpg.Connection, lng: float, lat: float) -> Optional[dict]:
    """Return the road network vertex (source/target) closest to the given point."""
    row = await conn.fetchrow("""
        WITH vertices AS (
            SELECT source AS node_id,
                   ST_X(ST_StartPoint(geom)) AS lng,
                   ST_Y(ST_StartPoint(geom)) AS lat,
                   name,
                   road_type,
                   ST_Distance(
                       ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857),
                       ST_Transform(ST_StartPoint(geom), 3857)
                   ) AS dist
            FROM road_network
            WHERE cost > 0
            UNION ALL
            SELECT target AS node_id,
                   ST_X(ST_EndPoint(geom)) AS lng,
                   ST_Y(ST_EndPoint(geom)) AS lat,
                   name,
                   road_type,
                   ST_Distance(
                       ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857),
                       ST_Transform(ST_EndPoint(geom), 3857)
                   ) AS dist
            FROM road_network
            WHERE cost > 0
        )
        SELECT node_id, lng, lat, name, road_type, dist
        FROM vertices
        ORDER BY dist
        LIMIT 1
    """, lng, lat)
    if not row:
        return None
    is_junction = await _node_has_impacted_road(conn, row["node_id"])
    return {
        "node_id": row["node_id"],
        "lng": row["lng"],
        "lat": row["lat"],
        "distance_m": row["dist"],
        "road_name": row["name"],
        "road_type": row["road_type"],
        "is_junction": is_junction,
    }


async def _get_node_coords(conn: asyncpg.Connection, node_id: int) -> Optional[tuple[float, float]]:
    """Return (lng, lat) for a road_network node."""
    row = await conn.fetchrow("""
        SELECT
            COALESCE(
                (SELECT ST_X(ST_StartPoint(geom)) FROM road_network WHERE source = $1 AND cost > 0 LIMIT 1),
                (SELECT ST_X(ST_EndPoint(geom))   FROM road_network WHERE target = $1 AND cost > 0 LIMIT 1)
            ) AS lng,
            COALESCE(
                (SELECT ST_Y(ST_StartPoint(geom)) FROM road_network WHERE source = $1 AND cost > 0 LIMIT 1),
                (SELECT ST_Y(ST_EndPoint(geom))   FROM road_network WHERE target = $1 AND cost > 0 LIMIT 1)
            ) AS lat
    """, node_id)
    if not row or row["lng"] is None:
        return None
    return (float(row["lng"]), float(row["lat"]))

async def _node_has_impacted_road(conn: asyncpg.Connection, node_id: int) -> bool:
    """Return True if this node already connects to a slip road or impacted road type."""
    row = await conn.fetchrow("""
        SELECT 1 FROM road_network
        WHERE (source = $1 OR target = $1)
          AND road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
          AND cost > 0
        LIMIT 1
    """, node_id)
    return row is not None


async def _find_outward_junction(
    conn: asyncpg.Connection,
    node_id: int,
    forward: bool,
    closure_bearing: float,
    max_hops: int = 60,
) -> Optional[tuple[int, float, float]]:
    """
    Walk along directed motorway edges to find the nearest junction node (one connected to
    a slip/impacted road). Duplicated from routers/network.py to avoid circular import.
    forward=False → walk backward (find approach junction before start node)
    forward=True  → walk forward  (find departure junction after end node)
    closure_bearing (degrees) filters to same-carriageway edges only via cos(diff) > 0.5.
    Returns (node_id, lng, lat) so the caller can query by exact node_id.
    """
    if forward:
        walk_sql = """
            WITH RECURSIVE walk(node_id, depth) AS (
                SELECT DISTINCT rn.target, 1
                FROM road_network rn
                WHERE rn.source = $1 AND rn.road_type = 'motorway' AND rn.cost > 0
                  AND cos(ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom)) - RADIANS($3::float8)) > 0.5
                UNION ALL
                SELECT DISTINCT rn.target, w.depth + 1
                FROM walk w
                JOIN road_network rn ON rn.source = w.node_id
                WHERE rn.road_type = 'motorway' AND rn.cost > 0 AND w.depth < $2
                  AND cos(ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom)) - RADIANS($3::float8)) > 0.5
            )
            SELECT w.node_id,
                COALESCE(
                    (SELECT ST_X(ST_StartPoint(geom)) FROM road_network WHERE source = w.node_id AND cost > 0 LIMIT 1),
                    (SELECT ST_X(ST_EndPoint(geom))   FROM road_network WHERE target = w.node_id AND cost > 0 LIMIT 1)
                ) AS lng,
                COALESCE(
                    (SELECT ST_Y(ST_StartPoint(geom)) FROM road_network WHERE source = w.node_id AND cost > 0 LIMIT 1),
                    (SELECT ST_Y(ST_EndPoint(geom))   FROM road_network WHERE target = w.node_id AND cost > 0 LIMIT 1)
                ) AS lat
            FROM walk w
            WHERE w.node_id != $1
              AND EXISTS (
                SELECT 1 FROM road_network rn
                WHERE (rn.source = w.node_id OR rn.target = w.node_id)
                  AND rn.road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
                  AND rn.cost > 0
              )
            ORDER BY w.depth ASC
            LIMIT 1
        """
    else:
        walk_sql = """
            WITH RECURSIVE walk(node_id, depth) AS (
                SELECT DISTINCT rn.source, 1
                FROM road_network rn
                WHERE rn.target = $1 AND rn.road_type = 'motorway' AND rn.cost > 0
                  AND cos(ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom)) - RADIANS($3::float8)) > 0.5
                UNION ALL
                SELECT DISTINCT rn.source, w.depth + 1
                FROM walk w
                JOIN road_network rn ON rn.target = w.node_id
                WHERE rn.road_type = 'motorway' AND rn.cost > 0 AND w.depth < $2
                  AND cos(ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom)) - RADIANS($3::float8)) > 0.5
            )
            SELECT w.node_id,
                COALESCE(
                    (SELECT ST_X(ST_StartPoint(geom)) FROM road_network WHERE source = w.node_id AND cost > 0 LIMIT 1),
                    (SELECT ST_X(ST_EndPoint(geom))   FROM road_network WHERE target = w.node_id AND cost > 0 LIMIT 1)
                ) AS lng,
                COALESCE(
                    (SELECT ST_Y(ST_StartPoint(geom)) FROM road_network WHERE source = w.node_id AND cost > 0 LIMIT 1),
                    (SELECT ST_Y(ST_EndPoint(geom))   FROM road_network WHERE target = w.node_id AND cost > 0 LIMIT 1)
                ) AS lat
            FROM walk w
            WHERE w.node_id != $1
              AND EXISTS (
                SELECT 1 FROM road_network rn
                WHERE (rn.source = w.node_id OR rn.target = w.node_id)
                  AND rn.road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
                  AND rn.cost > 0
              )
            ORDER BY w.depth ASC
            LIMIT 1
        """
    row = await conn.fetchrow(walk_sql, node_id, max_hops, closure_bearing)
    if row and row["lng"] is not None:
        return (int(row["node_id"]), float(row["lng"]), float(row["lat"]))
    return None


def _bearing(p1: list, p2: list) -> float:
    """Compass bearing in degrees (0–360) from p1 to p2 ([lng, lat])."""
    lng1, lat1 = p1; lng2, lat2 = p2
    cos_lat = math.cos(math.radians((lat1 + lat2) / 2))
    return math.degrees(math.atan2((lng2 - lng1) * cos_lat, lat2 - lat1)) % 360


def _avoid_polygon(closure_geojson: dict, buffer_m: float = 50) -> dict:
    """
    Buffer the closure LineString into a polygon ORS can avoid.

    Uses a latitude-corrected buffer so the polygon is equally wide in both
    the N-S and E-W directions (at lat~51° a naive degree buffer is ~30%
    too narrow E-W, letting ORS slip through the sides of the polygon).
    50 m covers the full M25 dual carriageway width without blocking the
    junction slip roads that typically diverge further away.
    """
    geom = shape(closure_geojson)
    coords = list(geom.coords) if hasattr(geom, "coords") else []
    avg_lat = sum(c[1] for c in coords) / max(len(coords), 1) if coords else 51.4
    cos_lat = math.cos(math.radians(avg_lat))
    centroid = geom.centroid
    # Stretch E-W so degrees are equal-length in both axes, buffer, then squeeze back
    geom_eq = shp_scale(geom, xfact=1.0 / cos_lat, yfact=1.0, origin=centroid)
    buf_eq = geom_eq.buffer(buffer_m / 111_000)
    buf = shp_scale(buf_eq, xfact=cos_lat, yfact=1.0, origin=centroid)
    return mapping(buf)


def _parse_features(
    features: list[dict],
    rank_start: int,
    max_routes: int,
    ors_origin: list | None = None,
    ors_destination: list | None = None,
    exit_slip_geom: list | None = None,
    entry_slip_geom: list | None = None,
) -> list[dict]:
    results = []
    for rank, feat in enumerate(features, start=rank_start):
        if len(results) >= max_routes:
            break
        geom = feat.get("geometry")
        props = feat.get("properties", {})
        summary = props.get("summary", {})

        road_names: list[str] = []
        for seg in props.get("segments", []):
            for step in seg.get("steps", []):
                name = (step.get("name") or "").strip("- ")
                if name and name not in road_names:
                    road_names.append(name)

        # Attach slip road geometry at each end so the green line includes the
        # full exit slip (junction → A-road) and entry slip (A-road → junction)
        if geom and geom.get("type") == "LineString":
            route_coords = list(geom.get("coordinates", []))
            if exit_slip_geom:
                route_coords = exit_slip_geom + route_coords
            if entry_slip_geom:
                route_coords = route_coords + entry_slip_geom
            geom = {"type": "LineString", "coordinates": route_coords}

        results.append({
            "path_id": rank,
            "route_rank": rank,
            "edge_ids": [],
            "node_ids": [],
            "travel_time_min": round(summary.get("duration", 0) / 60, 2),
            "distance_m": round(summary.get("distance", 0) * 1000, 1),
            "geojson": geom,
            "non_hgv_edges": 0,
            "total_edges": 1,
            "route_attributes": {
                "named_roads": road_names[:15],
                "road_type_m": {},
                "speed_range": None,
                "ors_origin": ors_origin,
                "ors_destination": ors_destination,
            },
        })
    return results



async def generate_routes(
    conn: asyncpg.Connection,
    source_node: int,
    target_node: int,
    vehicle_type: str = "car",
    n_routes: int = 3,
    closure_geojson: dict | None = None,
) -> list[dict]:
    """
    Generate diversion routes via OpenRouteService.

    ORS anchors are the motorway junction nodes (same as red line extension endpoints).
    All road types are permitted — motorways, A-roads, B-roads — so ORS can use any road
    in the DBFO network and naturally prioritises faster roads (motorway > A > B).
    The closed section is blocked only via avoid_polygons, not by road class.
    """
    start = await _get_node_coords(conn, source_node)
    end = await _get_node_coords(conn, target_node)
    if not start or not end:
        return []

    profile = "driving-hgv" if vehicle_type == "hgv" else "driving-car"
    headers = {"Authorization": ORS_KEY, "Content-Type": "application/json"}

    # Resolve junction nodes → find their slip roads → use far (A-road) ends as ORS anchors.
    # The full slip road geometry is prepended/appended to the route so the green line
    # includes: junction → exit slip → [ORS route] → entry slip → junction.
    ors_start: list = list(start)
    ors_end:   list = list(end)
    exit_slip_geom: list = []   # coords: junction_start → A-road (prepended)
    entry_slip_geom: list = []  # coords: A-road → junction_end (appended)
    junc_start_coord: list = list(start)
    junc_end_coord:   list = list(end)

    try:
        closure_bearing = _bearing(list(start), list(end))

        # Find junction nodes (same directed walk as red line extension)
        if await _node_has_impacted_road(conn, source_node):
            junc_start_id = source_node
            junc_start_coord = list(start)
        else:
            j = await _find_outward_junction(conn, source_node, forward=False, closure_bearing=closure_bearing)
            if j:
                junc_start_id, junc_start_coord = j[0], [j[1], j[2]]
            else:
                junc_start_id = source_node

        if await _node_has_impacted_road(conn, target_node):
            junc_end_id = target_node
            junc_end_coord = list(end)
        else:
            j = await _find_outward_junction(conn, target_node, forward=True, closure_bearing=closure_bearing)
            if j:
                junc_end_id, junc_end_coord = j[0], [j[1], j[2]]
            else:
                junc_end_id = target_node

        # Exit slip: source = junction node → target = A-road (traffic direction).
        # Exclude connectors whose far end joins back onto a motorway (CW↔ACW connectors).
        row = await conn.fetchrow("""
            SELECT ST_X(ST_EndPoint(rn.geom)) AS far_lng,
                   ST_Y(ST_EndPoint(rn.geom)) AS far_lat,
                   ST_AsGeoJSON(rn.geom) AS geojson
            FROM road_network rn
            WHERE rn.source = $1
              AND rn.road_type IN ('motorway_link', 'trunk_link')
              AND rn.cost > 0
              AND NOT EXISTS (
                  SELECT 1 FROM road_network rn2
                  WHERE (rn2.source = rn.target OR rn2.target = rn.target)
                    AND rn2.road_type = 'motorway'
                    AND rn2.cost > 0
              )
            ORDER BY ST_Length(rn.geom) DESC
            LIMIT 1
        """, junc_start_id)
        if row and row["far_lng"] is not None:
            ors_start = [float(row["far_lng"]), float(row["far_lat"])]
            exit_slip_geom = json.loads(row["geojson"]).get("coordinates", [])

        # Entry slip: source = A-road → target = junction node (traffic direction).
        # Exclude connectors whose far end joins back onto a motorway.
        row = await conn.fetchrow("""
            SELECT ST_X(ST_StartPoint(rn.geom)) AS far_lng,
                   ST_Y(ST_StartPoint(rn.geom)) AS far_lat,
                   ST_AsGeoJSON(rn.geom) AS geojson
            FROM road_network rn
            WHERE rn.target = $1
              AND rn.road_type IN ('motorway_link', 'trunk_link')
              AND rn.cost > 0
              AND NOT EXISTS (
                  SELECT 1 FROM road_network rn2
                  WHERE (rn2.source = rn.source OR rn2.target = rn.source)
                    AND rn2.road_type = 'motorway'
                    AND rn2.cost > 0
              )
            ORDER BY ST_Length(rn.geom) DESC
            LIMIT 1
        """, junc_end_id)
        if row and row["far_lng"] is not None:
            ors_end = [float(row["far_lng"]), float(row["far_lat"])]
            entry_slip_geom = json.loads(row["geojson"]).get("coordinates", [])

        print(f"[routing] junc_start_id={junc_start_id} coord={junc_start_coord}")
        print(f"[routing] junc_end_id={junc_end_id} coord={junc_end_coord}")
        print(f"[routing] exit_slip far_end={ors_start} geom_pts={len(exit_slip_geom)}")
        print(f"[routing] entry_slip far_end={ors_end} geom_pts={len(entry_slip_geom)}")
        if exit_slip_geom:
            print(f"[routing] exit_slip start={exit_slip_geom[0]} end={exit_slip_geom[-1]}")
        if entry_slip_geom:
            print(f"[routing] entry_slip start={entry_slip_geom[0]} end={entry_slip_geom[-1]}")
    except Exception as exc:
        print(f"[routing] failed to resolve slip anchors: {exc}")

    coords = [ors_start, ors_end]

    payload = {
        "coordinates": coords,
        "radiuses": [-1, -1],
        "alternative_routes": {
            "share_factor": 0.6,
            "target_count": n_routes,
            "weight_factor": 1.6,
        },
        "instructions": True,
        "units": "km",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(ORS_URL.format(profile=profile), headers=headers, json=payload)
        if resp.status_code != 200:
            payload.pop("options", None)
            resp = await client.post(ORS_URL.format(profile=profile), headers=headers, json=payload)
        features = resp.json().get("features", []) if resp.status_code == 200 else []

    return _parse_features(features, rank_start=1, max_routes=n_routes,
                           ors_origin=junc_start_coord, ors_destination=junc_end_coord,
                           exit_slip_geom=exit_slip_geom, entry_slip_geom=entry_slip_geom)
