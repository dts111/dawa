"""
Fetch the exact M25 road geometry from OpenStreetMap via Overpass API.
Uses OSM relation 106164 (M25 motorway, National Highways UK).
Run once: python extract_m25_track.py
"""
import json
import sys
import time
from pathlib import Path
import httpx

sys.path.insert(0, str(Path(__file__).parent))
from m25_junctions import JUNCTIONS

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {"Accept": "*/*", "User-Agent": "M25DiversionPlanner/1.0"}

# ── Query 1: M25 motorway + motorway_link (full ring + slip roads) ────────────
QUERY_GEOM_M25 = """
[out:json][timeout:180];
way["ref"="M25"]["highway"~"motorway|motorway_link"](51.2,-0.65,51.8,0.35);
out geom;
"""
QUERY_NODES_M25 = """
[out:json][timeout:180];
way["ref"="M25"]["highway"~"motorway|motorway_link"](51.2,-0.65,51.8,0.35);
out;
"""

# ── Query 2: A282 Dartford Crossing (trunk/trunk_link, not ref=M25) ───────────
QUERY_GEOM_A282 = """
[out:json][timeout:60];
way["ref"="A282"]["highway"~"trunk|trunk_link"](51.43,0.22,51.51,0.30);
out geom;
"""
QUERY_NODES_A282 = """
[out:json][timeout:60];
way["ref"="A282"]["highway"~"trunk|trunk_link"](51.43,0.22,51.51,0.30);
out;
"""


# Connecting motorways and A-roads at each M25 junction (user-specified list)
JUNCTION_CONNECTIONS = {
    "J2":  ["A2"],
    "J3":  ["M20"],
    "J4":  ["A21"],
    "J5":  ["M26"],
    "J6":  ["A22"],
    "J7":  ["M23"],
    "J8":  ["A217"],
    "J9":  ["A243"],
    "J10": ["A3"],
    "J11": ["A317"],
    "J12": ["M3"],
    "J13": ["A30"],
    "J14": ["A3113"],
    "J15": ["M4"],
    "J16": ["M40"],
    "J17": ["A412"],
    "J18": ["A404"],
    "J19": ["A41"],
    "J20": ["A41"],
    "J21": ["M1"],
    "J22": ["A1081"],
    "J23": ["A1(M)"],
    "J25": ["A10"],
    "J26": ["A121"],
    "J27": ["M11"],
    "J28": ["A12"],
    "J29": ["A127"],
    "J30": ["A13"],
}

# Build a lookup from junction id -> junction coords
JUNCTION_BY_ID = {j["id"]: j for j in JUNCTIONS}


def make_junction_query(out_geom: bool) -> str:
    """
    Build an Overpass union query that fetches, within 500 m of every M25
    junction:
      1. The specific connecting motorway / A-road (by ref) for that junction
      2. Any roundabout circulatory roads (junction=roundabout)
    """
    radius = 500
    rb_filter = '["junction"="roundabout"]'
    out_clause = "out geom;" if out_geom else "out;"

    parts = []
    for jid, refs in JUNCTION_CONNECTIONS.items():
        jct = JUNCTION_BY_ID.get(jid)
        if not jct:
            continue
        around = f"(around:{radius},{jct['lat']},{jct['lon']})"
        # One clause per connecting road ref
        for ref in refs:
            parts.append(f'  way["ref"="{ref}"]{around};')
        # Roundabouts at this junction
        parts.append(f'  way{rb_filter}{around};')

    return "[out:json][timeout:180];\n(\n" + "\n".join(parts) + f"\n);\n{out_clause}"


def fetch(query: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            resp = httpx.post(OVERPASS_URL, data={"data": query}, headers=HEADERS, timeout=180)
            if resp.status_code == 429:
                wait = 30 * (attempt + 1)
                print(f"    Rate limited — waiting {wait}s before retry {attempt + 1}/{retries}...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            print(f"    Timeout — retry {attempt + 1}/{retries}...")
            time.sleep(10)
    raise RuntimeError("Overpass API failed after retries")


def extract_geom(data: dict) -> dict:
    return {
        e["id"]: [[n["lon"], n["lat"]] for n in e.get("geometry", [])]
        for e in data["elements"] if e["type"] == "way"
    }


def extract_nodes(data: dict) -> dict:
    return {
        e["id"]: e.get("nodes", [])
        for e in data["elements"] if e["type"] == "way"
    }


def chain_ways(ways_geom: dict, ways_nodes: dict) -> list:
    """
    Split ways into separate continuous chains (one per carriageway/link).
    Gaps in connectivity start a new chain rather than stopping entirely.
    """
    start_map: dict = {}
    end_map:   dict = {}

    for wid, nodes in ways_nodes.items():
        if len(nodes) < 2:
            continue
        start_map.setdefault(nodes[0],  []).append(wid)
        end_map.setdefault(nodes[-1], []).append(wid)

    visited: set = set()
    chains: list = []

    for seed in ways_geom:
        if seed in visited:
            continue

        chain = [seed]
        visited.add(seed)
        current = seed

        while True:
            nodes = ways_nodes.get(current, [])
            if not nodes:
                break
            tail = nodes[-1]

            next_id = None
            for candidate in start_map.get(tail, []):
                if candidate not in visited:
                    next_id = candidate
                    break

            if next_id is None:
                for candidate in end_map.get(tail, []):
                    if candidate not in visited:
                        ways_geom[candidate]  = list(reversed(ways_geom[candidate]))
                        ways_nodes[candidate] = list(reversed(ways_nodes[candidate]))
                        next_id = candidate
                        break

            if next_id is None:
                break

            visited.add(next_id)
            chain.append(next_id)
            current = next_id

        chains.append(chain)

    return chains


def build_coords(chain: list, ways_geom: dict) -> list:
    coords = []
    for wid in chain:
        pts = ways_geom.get(wid, [])
        if not pts:
            continue
        coords.extend(pts if not coords else pts[1:])
    return coords


def build_geojson(chains: list, ways_geom: dict) -> dict:
    features = []
    for i, chain in enumerate(chains):
        coords = build_coords(chain, ways_geom)
        if len(coords) < 2:
            continue
        features.append({
            "type": "Feature",
            "properties": {"name": "M25 Motorway", "carriageway": i + 1},
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    return {"type": "FeatureCollection", "features": features}


# ── Fetch ─────────────────────────────────────────────────────────────────────
print("Fetching M25 motorway + link ways...")
data_geom_m25  = fetch(QUERY_GEOM_M25);  time.sleep(5)
data_nodes_m25 = fetch(QUERY_NODES_M25); time.sleep(5)

print("Fetching A282 Dartford Crossing trunk ways...")
data_geom_a282  = fetch(QUERY_GEOM_A282); time.sleep(5)
data_nodes_a282 = fetch(QUERY_NODES_A282); time.sleep(5)

print("Fetching junction circulatories + 500 m connecting roads at all 32 junctions...")
q_geom = make_junction_query(out_geom=True)
data_geom_jct = fetch(q_geom)
# No nodes query needed for junction roads — they are added directly as
# individual features (no chaining required) so geometry alone is sufficient.

# ── Chain M25 ring + A282 (these need chaining for a continuous line) ─────────
ways_geom_ring = {
    **extract_geom(data_geom_m25),
    **extract_geom(data_geom_a282),
}
ways_nodes_ring = {
    **extract_nodes(data_nodes_m25),
    **extract_nodes(data_nodes_a282),
}
print(f"  M25 ring ways: {len(ways_geom_ring)}")

# ── Junction connecting roads — geometry extracted directly ───────────────────
jct_ways_geom = extract_geom(data_geom_jct)
print(f"  Junction connecting ways: {len(jct_ways_geom)}")

# ── Chain and export ──────────────────────────────────────────────────────────
chains = chain_ways(ways_geom_ring, ways_nodes_ring)
print(f"  {len(chains)} ring chains")

geojson = build_geojson(chains, ways_geom_ring)

# Add junction connecting roads as individual LineString features
for wid, coords in jct_ways_geom.items():
    if len(coords) < 2:
        continue
    geojson["features"].append({
        "type": "Feature",
        "properties": {"name": "M25 Junction Link"},
        "geometry": {"type": "LineString", "coordinates": coords},
    })

total_pts = sum(len(f["geometry"]["coordinates"]) for f in geojson["features"])
print(f"  Total features: {len(geojson['features'])}  coordinate pairs: {total_pts}")

out_path = Path(__file__).parent.parent / "frontend" / "src" / "m25_track.json"
out_path.write_text(json.dumps(geojson, separators=(",", ":")))
print(f"Saved to {out_path}")
