"""
Network connectivity check — prerequisite for pgRouting-based diversion routing.

Reports:
  1. Edge/vertex counts per road class
  2. Strongly-connected components of the directed graph (pgr_strongComponents)
     — the diversion engine needs start and end junctions in the SAME component
  3. A pgr_dijkstra smoke test between two far-apart M25 nodes, with timing
     (pgr_KSP is deliberately NOT used — Yen's algorithm is intractable on this
      micro-edge network; the routing engine uses penalty Dijkstra instead.)

Run:
    docker compose exec backend python scripts/check_connectivity.py
"""
import asyncio
import os
import time

import asyncpg
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("DATABASE_URL", "postgresql://planner:planner_dev@localhost:5432/diversion_planner")
if "+asyncpg" in DB_URL:
    DB_URL = DB_URL.replace("postgresql+asyncpg://", "postgresql://")

EDGES_SQL = "SELECT id, source, target, cost, reverse_cost FROM road_network WHERE cost > 0"


async def main():
    conn = await asyncpg.connect(DB_URL)
    try:
        # 1. Basic counts
        print("=== 1. Network size ===")
        rows = await conn.fetch("""
            SELECT road_type, COUNT(*) AS edges, ROUND(SUM(length_m)::numeric / 1000, 1) AS km
            FROM road_network WHERE cost > 0
            GROUP BY road_type ORDER BY edges DESC
        """)
        total = 0
        for r in rows:
            total += r["edges"]
            print(f"  {r['road_type']:<16} {r['edges']:>8} edges  {r['km']:>9} km")
        n_vertices = await conn.fetchval(
            "SELECT COUNT(DISTINCT v) FROM (SELECT source AS v FROM road_network WHERE cost > 0 "
            "UNION SELECT target FROM road_network WHERE cost > 0) s"
        )
        print(f"  {'TOTAL':<16} {total:>8} edges  ({n_vertices} vertices)\n")

        # 2. Strongly connected components (directed)
        print("=== 2. Strong components (directed graph) ===")
        t0 = time.time()
        comps = await conn.fetch(f"""
            SELECT component, COUNT(*) AS n_nodes
            FROM pgr_strongComponents('{EDGES_SQL}')
            GROUP BY component ORDER BY n_nodes DESC LIMIT 10
        """)
        n_comps = await conn.fetchval(f"""
            SELECT COUNT(DISTINCT component) FROM pgr_strongComponents('{EDGES_SQL}')
        """)
        elapsed = time.time() - t0
        largest = comps[0]["n_nodes"] if comps else 0
        pct = 100.0 * largest / max(n_vertices, 1)
        print(f"  components: {n_comps}   largest: {largest} nodes ({pct:.1f}% of network)   [{elapsed:.1f}s]")
        for c in comps[:5]:
            print(f"    component {c['component']:>10}: {c['n_nodes']} nodes")
        if pct >= 95:
            print("  ✓ Network is well connected — routing is viable.\n")
        else:
            print("  ✗ WARNING: large disconnected fraction — routing may fail between some junctions.")
            print("    Consider re-running import or investigating pgr_createTopology tolerance.\n")

        # 3. Dijkstra smoke test between two far-apart M25 nodes
        print("=== 3. pgr_dijkstra smoke test (directed) ===")
        endpoints = await conn.fetchrow("""
            WITH m25 AS (
                SELECT source, ST_X(ST_StartPoint(geom)) AS lng
                FROM road_network
                WHERE road_type = 'motorway' AND name LIKE '%M25%' AND cost > 0
            )
            SELECT (SELECT source FROM m25 ORDER BY lng ASC  LIMIT 1) AS node_w,
                   (SELECT source FROM m25 ORDER BY lng DESC LIMIT 1) AS node_e
        """)
        if not endpoints or endpoints["node_w"] is None:
            print("  ✗ No M25 motorway edges found — check the OSM import.")
            return
        a, b = endpoints["node_w"], endpoints["node_e"]
        print(f"  west node {a} → east node {b}")
        t0 = time.time()
        path = await conn.fetchrow(f"""
            SELECT MAX(agg_cost) AS cost_min, COUNT(*) FILTER (WHERE edge >= 0) AS n_edges
            FROM pgr_dijkstra('{EDGES_SQL}', $1::bigint, $2::bigint, directed := true)
        """, a, b)
        elapsed = time.time() - t0
        if not path or not path["n_edges"]:
            print(f"  ✗ No path found [{elapsed:.1f}s] — nodes may be in different components.")
        else:
            print(f"  ✓ Path found [{elapsed:.1f}s]: {path['n_edges']} edges, {path['cost_min']:.1f} min")
            if elapsed > 20:
                print("  NOTE: slow — the routing engine restricts the graph to a bbox around the")
                print("  closure, so production queries will be faster than this whole-network test.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
