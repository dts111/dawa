"""
Standalone test of the pgRouting diversion engine — no UI needed.

Usage (inside the backend container):
    docker compose exec backend python scripts/test_pgr_route.py <start_node> <end_node> [car|hgv]

Or let it auto-pick two M25 mainline nodes ~10 km apart:
    docker compose exec backend python scripts/test_pgr_route.py
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


async def main():
    from services.routing_pgr import generate_routes_pgr

    conn = await asyncpg.connect(DB_URL)
    try:
        if len(sys.argv) >= 3:
            a, b = int(sys.argv[1]), int(sys.argv[2])
        else:
            row = await conn.fetchrow("""
                WITH m25 AS (
                    SELECT source, geom FROM road_network
                    WHERE road_type = 'motorway' AND name LIKE '%M25%' AND cost > 0
                ),
                pick AS (SELECT source, geom FROM m25 ORDER BY source LIMIT 1)
                SELECT p.source AS a,
                       (SELECT m.source FROM m25 m
                        WHERE ST_Distance(m.geom::geography, p.geom::geography) BETWEEN 8000 AND 12000
                        LIMIT 1) AS b
                FROM pick p
            """)
            if not row or row["b"] is None:
                print("Could not auto-pick test nodes — pass two node ids explicitly.")
                return
            a, b = row["a"], row["b"]
        vehicle = sys.argv[3] if len(sys.argv) >= 4 else "car"

        print(f"Routing {a} → {b} (vehicle={vehicle})...\n")
        routes = await generate_routes_pgr(conn, a, b, vehicle_type=vehicle, n_routes=3)

        if not routes:
            print("\n✗ NO ROUTES RETURNED — check the [routing_pgr] log lines above.")
            return
        print(f"\n✓ {len(routes)} route(s):")
        for r in routes:
            g = r["geojson"]["coordinates"]
            print(f"  rank {r['route_rank']}: {r['distance_m']/1000:.1f} km, "
                  f"{r['travel_time_min']:.0f} min, {r['total_edges']} edges, "
                  f"{len(g)} geometry points, non-HGV edges: {r['non_hgv_edges']}")
            print(f"    roads: {', '.join(r['route_attributes']['named_roads'][:8])}")
            print(f"    first coord {g[0]}, last coord {g[-1]}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
