"""
pgRouting-based diversion engine (runs on the DBFO road_network, no external API).

Guarantees, by construction:
  1. The diversion can NEVER traverse the closed section — the closure's directed
     edges are removed from the routing graph before routing. (The opposing
     carriageway stays open, matching a directional TTRO closure.)
  2. Diversions use ONLY the strategic network — road_network contains nothing
     but motorway/trunk/primary/secondary (+ links), so local streets are
     impossible.
  3. Up to `n_routes` genuinely distinct alternatives. If the network physically
     offers fewer distinct routes, fewer are returned (never padded duplicates).

Alternative-route strategy: ITERATIVE PENALTY DIJKSTRA, not pgr_KSP.
The imported network splits every OSM way into 2-point micro-edges, so a
20 km diversion path has ~2,000 nodes. Yen's algorithm (pgr_KSP) runs a
Dijkstra per spur node per alternative — thousands of Dijkstras — and never
returns in practice. Instead we run ONE pgr_dijkstra per route (fast, indexed,
bbox-clipped), then multiply the cost of the edges just used by PENALTY_FACTOR
and route again: the next shortest path naturally diverges. True travel time
is always recomputed from the raw (unpenalised) edge costs.

Output dicts match services.routing_engine._parse_features so routers/routes.py
and services/assessment.py work unchanged — but here path_edges/path_nodes,
HGV counts, road-type breakdown and speed range are REAL values from the
DBFO network, not placeholders.
"""
import json
import time
import asyncpg
from typing import Optional

from services.routing_engine import (
    _bearing,
    _get_node_coords,
    _node_has_impacted_road,
    _find_outward_junction,
)

# Standard UK articulated HGV envelope used when vehicle_type == "hgv"
HGV_HEIGHT_M = 4.0
HGV_WEIGHT_T = 44.0
HGV_WIDTH_M = 2.55

# Graph is clipped to the closure bbox expanded by this margin (degrees, ~28 km)
# to keep Dijkstra fast; diversions further out than this are not credible anyway.
BBOX_MARGIN_DEG = 0.25

# Two candidate routes are "the same" if they share more than this fraction of edges
MAX_EDGE_OVERLAP = 0.6

# Cost multiplier applied to edges already used by earlier routes
PENALTY_FACTOR = 3.0

# Give up after this many Dijkstra passes even if fewer than n_routes found
MAX_ATTEMPTS_EXTRA = 3


def _edge_sql(
    excluded_edge_ids: list[int],
    vehicle_type: str,
    bbox: tuple[float, float, float, float],
    penalized_edge_ids: Optional[set[int]] = None,
) -> str:
    """Build the edge-set SQL for pgr_dijkstra. All interpolated values are
    numeric — no user-controlled strings — so inline formatting is SQL-safe."""
    excl = ",".join(str(int(e)) for e in excluded_edge_ids) or "-1"
    min_lng, min_lat, max_lng, max_lat = bbox

    if penalized_edge_ids:
        pen = ",".join(str(int(e)) for e in penalized_edge_ids)
        cost_expr = (
            f"CASE WHEN id IN ({pen}) THEN cost * {PENALTY_FACTOR} ELSE cost END AS cost, "
            f"CASE WHEN id IN ({pen}) THEN reverse_cost * {PENALTY_FACTOR} ELSE reverse_cost END AS reverse_cost"
        )
    else:
        cost_expr = "cost, reverse_cost"

    sql = (
        f"SELECT id, source, target, {cost_expr} FROM road_network "
        f"WHERE cost > 0 AND id NOT IN ({excl}) "
        f"AND geom && ST_MakeEnvelope({min_lng:.6f}, {min_lat:.6f}, {max_lng:.6f}, {max_lat:.6f}, 4326)"
    )
    if vehicle_type == "hgv":
        sql += (
            " AND hgv_suitable = true"
            f" AND (max_height_m IS NULL OR max_height_m >= {HGV_HEIGHT_M})"
            f" AND (max_weight_t IS NULL OR max_weight_t >= {HGV_WEIGHT_T})"
            f" AND (max_width_m IS NULL OR max_width_m >= {HGV_WIDTH_M})"
        )
    return sql


async def _closure_edge_ids(
    conn: asyncpg.Connection,
    from_node: int,
    to_node: int,
    bbox: tuple[float, float, float, float],
) -> list[int]:
    """Directed shortest path between the two closure junctions = the closed
    carriageway section (including any extension past the picked nodes).
    Bbox-clipped for speed — the closure always lies between its junctions."""
    min_lng, min_lat, max_lng, max_lat = bbox
    edges_sql = (
        "SELECT id, source, target, cost, reverse_cost FROM road_network "
        "WHERE cost > 0 "
        f"AND geom && ST_MakeEnvelope({min_lng:.6f}, {min_lat:.6f}, {max_lng:.6f}, {max_lat:.6f}, 4326)"
    )
    rows = await conn.fetch("""
        SELECT path.edge
        FROM pgr_dijkstra($1::text, $2::bigint, $3::bigint, directed := true) path
        WHERE path.edge >= 0
    """, edges_sql, from_node, to_node)
    return [r["edge"] for r in rows]


async def _dijkstra(
    conn: asyncpg.Connection, edges_sql: str, from_node: int, to_node: int
) -> tuple[list[int], list[int]]:
    """One shortest path. Returns (edge_ids in travel order, node_ids in travel order)."""
    rows = await conn.fetch("""
        SELECT path.edge, path.node
        FROM pgr_dijkstra($1::text, $2::bigint, $3::bigint, directed := true) path
        ORDER BY path.seq
    """, edges_sql, from_node, to_node)
    if not rows:
        return [], []
    edge_ids = [r["edge"] for r in rows if r["edge"] >= 0]
    node_ids = [r["node"] for r in rows]
    return edge_ids, node_ids


def _overlap(a: set[int], b: set[int]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


async def generate_routes_pgr(
    conn: asyncpg.Connection,
    source_node: int,
    target_node: int,
    vehicle_type: str = "car",
    n_routes: int = 3,
    closure_geojson: dict | None = None,
    extra_excluded_edges: Optional[list[int]] = None,
) -> list[dict]:
    """
    Generate diversion routes on the DBFO network via iterative penalty Dijkstra.

    Anchors: same junction-resolution logic as the ORS engine and the red-line
    extension — the diversion starts at the last junction BEFORE the closure and
    ends at the first junction AFTER it.
    """
    t_start = time.time()
    start = await _get_node_coords(conn, source_node)
    end = await _get_node_coords(conn, target_node)
    if not start or not end:
        return []

    closure_bearing = _bearing(list(start), list(end))

    # Resolve outward junction anchors (identical policy to the ORS engine)
    if await _node_has_impacted_road(conn, source_node):
        junc_start = source_node
    else:
        j = await _find_outward_junction(conn, source_node, forward=False, closure_bearing=closure_bearing)
        junc_start = j[0] if j else source_node

    if await _node_has_impacted_road(conn, target_node):
        junc_end = target_node
    else:
        j = await _find_outward_junction(conn, target_node, forward=True, closure_bearing=closure_bearing)
        junc_end = j[0] if j else target_node

    junc_start_coord = await _get_node_coords(conn, junc_start) or start
    junc_end_coord = await _get_node_coords(conn, junc_end) or end

    # Clip graph to a bbox around the closure for performance (GIST-indexed)
    min_lng = min(junc_start_coord[0], junc_end_coord[0]) - BBOX_MARGIN_DEG
    max_lng = max(junc_start_coord[0], junc_end_coord[0]) + BBOX_MARGIN_DEG
    min_lat = min(junc_start_coord[1], junc_end_coord[1]) - BBOX_MARGIN_DEG
    max_lat = max(junc_start_coord[1], junc_end_coord[1]) + BBOX_MARGIN_DEG
    bbox = (min_lng, min_lat, max_lng, max_lat)

    # Closed edges = directed path junction→junction (never routable again below)
    t0 = time.time()
    excluded = await _closure_edge_ids(conn, junc_start, junc_end, bbox)
    print(f"[routing_pgr] closure edges: {len(excluded)} ({time.time() - t0:.1f}s)")
    if extra_excluded_edges:
        excluded = list({*excluded, *extra_excluded_edges})
    if not excluded:
        print(f"[routing_pgr] WARNING: no closure edges resolved between {junc_start} and {junc_end}")

    # --- Iterative penalty routing ---
    selected: list[tuple[list[int], list[int]]] = []   # (edge_ids, node_ids)
    selected_edge_sets: list[set[int]] = []
    penalized: set[int] = set()

    for attempt in range(1, n_routes + MAX_ATTEMPTS_EXTRA + 1):
        edges_sql = _edge_sql(excluded, vehicle_type, bbox, penalized)
        t0 = time.time()
        edge_ids, node_ids = await _dijkstra(conn, edges_sql, junc_start, junc_end)
        dt = time.time() - t0
        if not edge_ids:
            print(f"[routing_pgr] attempt {attempt}: no path ({dt:.1f}s) — stopping")
            break

        edge_set = set(edge_ids)
        distinct = all(_overlap(edge_set, s) <= MAX_EDGE_OVERLAP for s in selected_edge_sets)
        print(f"[routing_pgr] attempt {attempt}: {len(edge_ids)} edges ({dt:.1f}s) "
              f"{'accepted' if distinct or not selected else 'too similar — penalising and retrying'}")
        if distinct or not selected:
            selected.append((edge_ids, node_ids))
            selected_edge_sets.append(edge_set)
        penalized |= edge_set
        if len(selected) >= n_routes:
            break

    if not selected:
        print(f"[routing_pgr] no routes found {junc_start}→{junc_end} (vehicle={vehicle_type})")
        return []

    # --- Build result dicts with REAL attributes from the DBFO network ---
    results = []
    for rank, (edge_ids, node_ids) in enumerate(selected, start=1):
        detail = await conn.fetch("""
            SELECT rn.id, rn.source, rn.target, rn.name, rn.road_type, rn.length_m,
                   rn.cost, rn.speed_limit, rn.hgv_suitable,
                   ST_AsGeoJSON(rn.geom) AS geojson, e.ord
            FROM unnest($1::bigint[]) WITH ORDINALITY AS e(edge_id, ord)
            JOIN road_network rn ON rn.id = e.edge_id
            ORDER BY e.ord
        """, edge_ids)

        # Stitch geometry in travel order, flipping edges traversed against their
        # stored direction (two-way roads used via reverse_cost)
        coords: list[list[float]] = []
        named_roads: list[str] = []
        road_sequence: list[dict] = []
        road_type_m: dict[str, float] = {}
        speeds: list[int] = []
        non_hgv = 0
        true_cost_min = 0.0
        for i, row in enumerate(detail):
            seg = json.loads(row["geojson"])["coordinates"]
            if i < len(node_ids) and row["source"] != node_ids[i]:
                seg = seg[::-1]
            coords.extend(seg if not coords else seg[1:])
            true_cost_min += row["cost"] or 0.0
            name = (row["name"] or "").strip()
            if name and name not in named_roads:
                named_roads.append(name)
            if name and (not road_sequence or road_sequence[-1]["name"] != name):
                road_sequence.append({"name": name, "road_type": row["road_type"], "start_coord": seg[0]})
            road_type_m[row["road_type"]] = road_type_m.get(row["road_type"], 0.0) + (row["length_m"] or 0.0)
            if row["speed_limit"]:
                speeds.append(row["speed_limit"])
            if not row["hgv_suitable"]:
                non_hgv += 1

        distance_m = sum(row["length_m"] or 0.0 for row in detail)

        results.append({
            "path_id": rank,
            "route_rank": rank,
            "edge_ids": [int(e) for e in edge_ids],
            "node_ids": [int(n) for n in node_ids],
            "travel_time_min": round(true_cost_min, 2),
            "distance_m": round(distance_m, 1),
            "geojson": {"type": "LineString", "coordinates": coords},
            "non_hgv_edges": non_hgv,
            "total_edges": max(len(edge_ids), 1),
            "route_attributes": {
                "engine": "pgr",
                "named_roads": named_roads[:15],
                "road_sequence": road_sequence[:30],
                "road_type_m": {kk: round(vv, 1) for kk, vv in road_type_m.items()},
                "speed_range": {"min": min(speeds), "max": max(speeds)} if speeds else None,
                "ors_origin": list(junc_start_coord),
                "ors_destination": list(junc_end_coord),
                "excluded_closure_edges": len(excluded),
            },
        })

    print(f"[routing_pgr] {len(results)} route(s) {junc_start}→{junc_end}, "
          f"{len(excluded)} closure edges excluded, vehicle={vehicle_type}, "
          f"total {time.time() - t_start:.1f}s")
    return results
