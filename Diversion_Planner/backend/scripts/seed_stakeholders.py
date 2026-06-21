"""
Seed stakeholder_regions table with approximate boundary polygons for agencies
relevant to the M25 DBFO corridor.

Polygons are approximate WGS84 bounding boxes — replace with actual boundary data
from ONS / OS Boundary Line for production use.

Run after import_osm.py:
    docker compose exec backend python scripts/seed_stakeholders.py
"""
import asyncio
import os
import asyncpg
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("DATABASE_URL", "postgresql://planner:planner_dev@localhost:5432/diversion_planner")
if "+asyncpg" in DB_URL:
    DB_URL = DB_URL.replace("postgresql+asyncpg://", "postgresql://")


def poly(coords: list[tuple]) -> str:
    """Build MULTIPOLYGON WKT from a list of (lng, lat) exterior ring coords."""
    pts = ", ".join(f"{lng} {lat}" for lng, lat in coords)
    return f"SRID=4326;MULTIPOLYGON((({pts})))"


STAKEHOLDERS = [
    # Local Authorities
    {
        "name": "Surrey County Council",
        "category": "local_authority",
        "contact_email": "highways@surreycc.gov.uk",
        "contact_name": "Highway Liaison Officer",
        "wkt": poly([(-0.75, 51.05), (0.0, 51.05), (0.0, 51.40), (-0.75, 51.40), (-0.75, 51.05)]),
    },
    {
        "name": "Kent County Council",
        "category": "local_authority",
        "contact_email": "highways@kent.gov.uk",
        "contact_name": "Highway Liaison Officer",
        "wkt": poly([(0.0, 51.05), (1.0, 51.05), (1.0, 51.45), (0.0, 51.45), (0.0, 51.05)]),
    },
    {
        "name": "Essex County Council",
        "category": "local_authority",
        "contact_email": "highways@essex.gov.uk",
        "contact_name": "Highway Liaison Officer",
        "wkt": poly([(0.0, 51.45), (1.0, 51.45), (1.0, 51.90), (0.0, 51.90), (0.0, 51.45)]),
    },
    {
        "name": "Hertfordshire County Council",
        "category": "local_authority",
        "contact_email": "highways@hertfordshire.gov.uk",
        "contact_name": "Highway Liaison Officer",
        "wkt": poly([(-0.60, 51.55), (0.10, 51.55), (0.10, 51.90), (-0.60, 51.90), (-0.60, 51.55)]),
    },
    {
        "name": "Transport for London",
        "category": "local_authority",
        "contact_email": "network.management@tfl.gov.uk",
        "contact_name": "TfL Network Management",
        "wkt": poly([(-0.55, 51.35), (0.30, 51.35), (0.30, 51.70), (-0.55, 51.70), (-0.55, 51.35)]),
    },
    # Police
    {
        "name": "Surrey Police",
        "category": "police",
        "contact_email": "sectionorders@surrey.pnn.police.uk",
        "contact_name": "Roads Policing Unit",
        "wkt": poly([(-0.75, 51.05), (0.0, 51.05), (0.0, 51.40), (-0.75, 51.40), (-0.75, 51.05)]),
    },
    {
        "name": "Kent Police",
        "category": "police",
        "contact_email": "sectionorders@kent.pnn.police.uk",
        "contact_name": "Roads Policing Unit",
        "wkt": poly([(0.0, 51.05), (1.0, 51.05), (1.0, 51.45), (0.0, 51.45), (0.0, 51.05)]),
    },
    {
        "name": "Essex Police",
        "category": "police",
        "contact_email": "sectionorders@essex.pnn.police.uk",
        "contact_name": "Roads Policing Unit",
        "wkt": poly([(0.0, 51.45), (1.0, 51.45), (1.0, 51.90), (0.0, 51.90), (0.0, 51.45)]),
    },
    {
        "name": "Hertfordshire Constabulary",
        "category": "police",
        "contact_email": "sectionorders@herts.pnn.police.uk",
        "contact_name": "Roads Policing Unit",
        "wkt": poly([(-0.60, 51.55), (0.10, 51.55), (0.10, 51.90), (-0.60, 51.90), (-0.60, 51.55)]),
    },
    {
        "name": "Metropolitan Police Service",
        "category": "police",
        "contact_email": "tmu@met.police.uk",
        "contact_name": "Traffic Management Unit",
        "wkt": poly([(-0.55, 51.35), (0.30, 51.35), (0.30, 51.70), (-0.55, 51.70), (-0.55, 51.35)]),
    },
    # Ambulance
    {
        "name": "South East Coast Ambulance Service",
        "category": "ambulance",
        "contact_email": "ops.centre@secamb.nhs.uk",
        "contact_name": "Operations Centre",
        "wkt": poly([(-0.75, 51.05), (1.0, 51.05), (1.0, 51.45), (-0.75, 51.45), (-0.75, 51.05)]),
    },
    {
        "name": "London Ambulance Service",
        "category": "ambulance",
        "contact_email": "operations@lond-amb.nhs.uk",
        "contact_name": "Operations Manager",
        "wkt": poly([(-0.55, 51.35), (0.30, 51.35), (0.30, 51.70), (-0.55, 51.70), (-0.55, 51.35)]),
    },
    {
        "name": "East of England Ambulance Service",
        "category": "ambulance",
        "contact_email": "operations@eastamb.nhs.uk",
        "contact_name": "Operations Manager",
        "wkt": poly([(-0.10, 51.55), (1.0, 51.55), (1.0, 51.90), (-0.10, 51.90), (-0.10, 51.55)]),
    },
    # Fire & Rescue
    {
        "name": "Surrey & Sussex Fire and Rescue",
        "category": "fire",
        "contact_email": "ops@surreyandsussexfire.gov.uk",
        "contact_name": "Operations Planning",
        "wkt": poly([(-0.75, 51.05), (0.20, 51.05), (0.20, 51.40), (-0.75, 51.40), (-0.75, 51.05)]),
    },
    {
        "name": "Kent Fire and Rescue Service",
        "category": "fire",
        "contact_email": "ops@kent.fire-uk.org",
        "contact_name": "Operations Planning",
        "wkt": poly([(0.0, 51.05), (1.0, 51.05), (1.0, 51.45), (0.0, 51.45), (0.0, 51.05)]),
    },
    {
        "name": "Essex County Fire and Rescue",
        "category": "fire",
        "contact_email": "ops@essex-fire.gov.uk",
        "contact_name": "Operations Planning",
        "wkt": poly([(0.0, 51.45), (1.0, 51.45), (1.0, 51.90), (0.0, 51.90), (0.0, 51.45)]),
    },
    {
        "name": "Hertfordshire Fire and Rescue",
        "category": "fire",
        "contact_email": "ops@hertfordshirefire.gov.uk",
        "contact_name": "Operations Planning",
        "wkt": poly([(-0.60, 51.55), (0.10, 51.55), (0.10, 51.90), (-0.60, 51.90), (-0.60, 51.55)]),
    },
    {
        "name": "London Fire Brigade",
        "category": "fire",
        "contact_email": "operations@london-fire.gov.uk",
        "contact_name": "Strategic Operations",
        "wkt": poly([(-0.55, 51.35), (0.30, 51.35), (0.30, 51.70), (-0.55, 51.70), (-0.55, 51.35)]),
    },
    # National Highways
    {
        "name": "National Highways — South East",
        "category": "national_highways",
        "contact_email": "southeast@nationalhighways.co.uk",
        "contact_name": "Network Management",
        "wkt": poly([(-0.75, 51.05), (0.50, 51.05), (0.50, 51.55), (-0.75, 51.55), (-0.75, 51.05)]),
    },
    {
        "name": "National Highways — East",
        "category": "national_highways",
        "contact_email": "east@nationalhighways.co.uk",
        "contact_name": "Network Management",
        "wkt": poly([(-0.10, 51.55), (1.0, 51.55), (1.0, 51.90), (-0.10, 51.90), (-0.10, 51.55)]),
    },
]


async def main():
    conn = await asyncpg.connect(DB_URL)
    try:
        await conn.execute("TRUNCATE stakeholder_regions RESTART IDENTITY")
        for s in STAKEHOLDERS:
            await conn.execute("""
                INSERT INTO stakeholder_regions (name, category, geom, contact_email, contact_name)
                VALUES ($1, $2, ST_GeomFromEWKT($3), $4, $5)
            """, s["name"], s["category"], s["wkt"], s["contact_email"], s["contact_name"])
        count = await conn.fetchval("SELECT COUNT(*) FROM stakeholder_regions")
        print(f"Seeded {count} stakeholder regions.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
