"""
Fetch the exact M25 road geometry from OpenStreetMap via Overpass API.
Uses OSM relation 106164 (M25 motorway, National Highways UK).
Run once: python extract_m25_track.py
"""
import json
from pathlib import Path
import httpx

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {"Accept": "*/*", "User-Agent": "M25DiversionPlanner/1.0"}

# Two passes: geometry coords + node ID lists (for chaining).
# Uses ref=M25 directly rather than the relation so the Dartford Crossing
# (QE2 Bridge + tunnels) is included — those ways are tagged ref=M25 but
# are not members of relation 106164.
QUERY_GEOM = """
[out:json][timeout:180];
way["ref"="M25"]["highway"="motorway"](51.2,-0.65,51.8,0.35);
out geom;
"""

QUERY_NODES = """
[out:json][timeout:180];
way["ref"="M25"]["highway"="motorway"](51.2,-0.65,51.8,0.35);
out;
"""


def fetch(query: str) -> dict:
    resp = httpx.post(OVERPASS_URL, data={"data": query}, headers=HEADERS, timeout=180)
    resp.raise_for_status()
    return resp.json()


def chain_ways(ways_geom: dict, ways_nodes: dict) -> list[list]:
    """
    Split ways into separate continuous chains (one per carriageway).
    Returns a list of chains, each chain being an ordered list of way IDs.
    Gaps in connectivity start a new chain rather than stopping entirely.
    """
    start_map: dict[int, list] = {}
    end_map:   dict[int, list] = {}

    for wid, nodes in ways_nodes.items():
        if len(nodes) < 2:
            continue
        start_map.setdefault(nodes[0],  []).append(wid)
        end_map.setdefault(nodes[-1], []).append(wid)

    visited: set = set()
    chains: list[list] = []

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
                        # Reverse so it connects forward
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
    """Concatenate way coordinates, skipping duplicate junction nodes."""
    coords = []
    for wid in chain:
        pts = ways_geom.get(wid, [])
        if not pts:
            continue
        # Always skip first point of continuation ways to avoid duplicates
        coords.extend(pts if not coords else pts[1:])
    return coords


def build_geojson(chains: list[list], ways_geom: dict) -> dict:
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


print("Fetching M25 geometry from Overpass (OSM relation 106164)...")
print("  Pass 1: way geometry...")
data_geom  = fetch(QUERY_GEOM)
print("  Pass 2: way node lists...")
data_nodes = fetch(QUERY_NODES)

ways_geom = {
    e["id"]: [[n["lon"], n["lat"]] for n in e.get("geometry", [])]
    for e in data_geom["elements"] if e["type"] == "way"
}
ways_nodes = {
    e["id"]: e.get("nodes", [])
    for e in data_nodes["elements"] if e["type"] == "way"
}

print(f"  {len(ways_geom)} motorway ways found")

chains = chain_ways(ways_geom, ways_nodes)
print(f"  {len(chains)} carriageway chains found")
for i, c in enumerate(chains):
    pts = sum(len(ways_geom.get(w, [])) for w in c)
    print(f"    Chain {i+1}: {len(c)} ways, ~{pts} pts")

geojson = build_geojson(chains, ways_geom)
total_pts = sum(len(f["geometry"]["coordinates"]) for f in geojson["features"])
print(f"  Total coordinate pairs: {total_pts}")

out_path = Path(__file__).parent.parent / "frontend" / "src" / "m25_track.json"
out_path.write_text(json.dumps(geojson, separators=(",", ":")))
print(f"Saved to {out_path}")
