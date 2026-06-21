"""
Export M25 interchange slip roads and circulatories as static GeoJSON.
Run once:
    docker compose run --rm backend python scripts/export_interchange_links.py
Output saved to /app/scripts/interchange_links.json — copy to frontend/public/.
"""
import asyncio
import json
import os
import asyncpg
from dotenv import load_dotenv

load_dotenv()
DB_URL = os.getenv("DATABASE_URL", "postgresql://planner:planner_dev@db:5432/diversion_planner")
if "+asyncpg" in DB_URL:
    DB_URL = DB_URL.replace("postgresql+asyncpg://", "postgresql://")


async def main():
    conn = await asyncpg.connect(DB_URL)
    try:
        print("Querying M25 interchange links and circulatories...")
        rows = await conn.fetch("""
            WITH m25_geom AS (
                SELECT ST_Union(geom) AS geom FROM road_network
                WHERE road_type = 'motorway' AND name LIKE '%M25%'
            ),
            link_roads AS (
                SELECT rn.id, rn.geom, rn.road_type, rn.name
                FROM road_network rn, m25_geom mg
                WHERE rn.road_type IN ('motorway_link','trunk_link')
                  AND rn.geom IS NOT NULL
                  AND ST_DWithin(rn.geom, mg.geom, 0.008)
            ),
            link_union AS (SELECT ST_Union(geom) AS geom FROM link_roads),
            circs AS (
                SELECT rn.id, rn.geom, rn.road_type, rn.name
                FROM road_network rn, link_union lu
                WHERE rn.road_type IN ('trunk','trunk_link','primary','primary_link')
                  AND rn.geom IS NOT NULL
                  AND ST_DWithin(rn.geom, lu.geom, 0.005)
            ),
            combined AS (
                SELECT id, geom, road_type, name FROM link_roads
                UNION ALL
                SELECT id, geom, road_type, name FROM circs
            )
            SELECT DISTINCT ON (id)
                ST_AsGeoJSON(ST_Simplify(geom, 0.00005)) AS geom,
                road_type, name
            FROM combined
        """)

        features = []
        for row in rows:
            if row["geom"]:
                features.append({
                    "type": "Feature",
                    "geometry": json.loads(row["geom"]),
                    "properties": {"road_type": row["road_type"], "name": row["name"]},
                })

        out = {"type": "FeatureCollection", "features": features}
        out_path = os.path.join(os.path.dirname(__file__), "interchange_links.json")
        with open(out_path, "w") as f:
            json.dump(out, f)
        print(f"Exported {len(features)} features to {out_path}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
