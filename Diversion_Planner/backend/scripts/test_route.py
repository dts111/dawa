"""
Diagnose why a specific closure (or start/end node pair) does or doesn't produce a
diversion route — the exact walkthrough used to find the 422 "no routes found" bug
for a closure sitting on a slip/interchange link with no alternative route.

Reuses the real anchor-resolution and routing functions from services/, so this
always reflects current production behaviour (not a frozen copy of the logic).

Usage (inside the backend container):
    docker compose exec backend python scripts/test_route.py --closure <closure_id>
    docker compose exec backend python scripts/test_route.py <start_node> <end_node> [car|hgv]
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncpg
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("DATABASE_URL", "postgresql://planner:planner_dev@localhost:5432/diversion_planner")
if "+asyncpg" in DB_URL:
    DB_URL = DB_URL.replace("postgresql+asyncpg://", "postgresql://")


async def _node_degree(conn: asyncpg.Connection, node_id: int) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM road_network WHERE source = $1 OR target = $1", node_id
    )


async def main():
    from services.routing_engine import _bearing, _get_node_coords, _node_has_impacted_road, _find_outward_junction
    from services.routing_pgr import _closure_edge_ids, _edge_sql, _dijkstra, BBOX_MARGIN_DEG, generate_routes_pgr

    conn = await asyncpg.connect(DB_URL)
    try:
        if sys.argv[1:2] == ["--closure"]:
            closure_id = sys.argv[2]
            row = await conn.fetchrow(
                "SELECT start_node, end_node, closure_type FROM closures WHERE id = $1::uuid", closure_id
            )
            if not row:
                print(f"No closure found with id {closure_id}")
                return
            source_node, target_node = row["start_node"], row["end_node"]
            print(f"Closure {closure_id} ({row['closure_type']}): start_node={source_node} end_node={target_node}\n")
            vehicle = sys.argv[3] if len(sys.argv) >= 4 else "car"
        else:
            source_node, target_node = int(sys.argv[1]), int(sys.argv[2])
            vehicle = sys.argv[3] if len(sys.argv) >= 4 else "car"

        start = await _get_node_coords(conn, source_node)
        end = await _get_node_coords(conn, target_node)
        if not start or not end:
            print(f"✗ start or end node not found in road_network (start={start}, end={end})")
            return

        deg_start = await _node_degree(conn, source_node)
        deg_end = await _node_degree(conn, target_node)
        print(f"start_node {source_node}: {start}, degree={deg_start}")
        print(f"end_node   {target_node}: {end}, degree={deg_end}")

        bearing = _bearing(list(start), list(end))
        has_start = await _node_has_impacted_road(conn, source_node)
        has_end = await _node_has_impacted_road(conn, target_node)
        print(f"\nis start already a resolved junction? {has_start}")
        print(f"is end already a resolved junction?   {has_end}")

        junc_start = source_node
        if not has_start:
            j = await _find_outward_junction(conn, source_node, forward=False, closure_bearing=bearing)
            print(f"  walked outward (backward) from start -> {j}")
            junc_start = j[0] if j else source_node

        junc_end = target_node
        if not has_end:
            j = await _find_outward_junction(conn, target_node, forward=True, closure_bearing=bearing)
            print(f"  walked outward (forward) from end -> {j}")
            junc_end = j[0] if j else target_node

        print(f"\nresolved anchors: junc_start={junc_start} junc_end={junc_end}")

        sc = await _get_node_coords(conn, junc_start)
        ec = await _get_node_coords(conn, junc_end)
        min_lng = min(sc[0], ec[0]) - BBOX_MARGIN_DEG
        max_lng = max(sc[0], ec[0]) + BBOX_MARGIN_DEG
        min_lat = min(sc[1], ec[1]) - BBOX_MARGIN_DEG
        max_lat = max(sc[1], ec[1]) + BBOX_MARGIN_DEG
        bbox = (min_lng, min_lat, max_lng, max_lat)

        excluded = await _closure_edge_ids(conn, junc_start, junc_end, bbox)
        print(f"excluded closure edges: {len(excluded)}")

        edges_sql = _edge_sql(excluded, vehicle, bbox, None)
        edge_ids, _ = await _dijkstra(conn, edges_sql, junc_start, junc_end)
        if edge_ids:
            print(f"\n✓ alternative route exists: {len(edge_ids)} edges (vehicle={vehicle})")
        else:
            print(f"\n✗ NO alternative route between the resolved anchors (vehicle={vehicle}).")
            print("  This closure has no diversion on the strategic network (motorway/trunk/")
            print("  primary + links only) — a genuine dead end, not just a bad anchor pick.")
            return

        print("\nRunning full generate_routes_pgr()...")
        routes = await generate_routes_pgr(conn, source_node, target_node, vehicle_type=vehicle, n_routes=3)
        if not routes:
            print("✗ generate_routes_pgr returned no routes (see [routing_pgr] log lines above).")
        else:
            print(f"✓ {len(routes)} route(s) generated:")
            for r in routes:
                print(f"  rank {r['route_rank']}: {r['distance_m']/1000:.1f} km, "
                      f"{r['travel_time_min']:.0f} min, {r['total_edges']} edges")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
