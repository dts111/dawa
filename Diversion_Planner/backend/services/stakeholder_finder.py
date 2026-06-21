import json
import asyncpg


async def find_affected_stakeholders(
    conn: asyncpg.Connection,
    diversion_geojson: dict,
    buffer_m: int = 500,
) -> list[dict]:
    """
    Spatial intersect of diversion route (buffered) against stakeholder_regions.
    Returns list of affected stakeholders ordered by category.
    """
    geojson_str = json.dumps(diversion_geojson)

    rows = await conn.fetch("""
        SELECT id, name, category, contact_email, contact_name
        FROM stakeholder_regions
        WHERE ST_Intersects(
            geom,
            ST_Buffer(
                ST_GeomFromGeoJSON($1)::geography,
                $2
            )::geometry
        )
        ORDER BY category, name
    """, geojson_str, buffer_m)

    return [
        {
            "id": r["id"],
            "name": r["name"],
            "category": r["category"],
            "contact_email": r["contact_email"],
            "contact_name": r["contact_name"],
        }
        for r in rows
    ]


CATEGORY_LABELS = {
    "local_authority": "Local Authority",
    "police": "Police",
    "ambulance": "Ambulance Service",
    "fire": "Fire & Rescue",
    "national_highways": "National Highways",
    "bus_freight": "Bus & Freight Operator",
}
