import asyncio
import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_HEADERS = {"User-Agent": "M25DiversionPlanner/1.0"}

# UK county/area → consultation bodies
SERVICES: dict[str, dict[str, str]] = {
    "kent": {
        "council": "Kent County Council",
        "police": "Kent Police",
        "ambulance": "South East Coast Ambulance Service NHS FT (SECAmb)",
        "fire": "Kent Fire and Rescue Service",
    },
    "surrey": {
        "council": "Surrey County Council",
        "police": "Surrey Police",
        "ambulance": "South East Coast Ambulance Service NHS FT (SECAmb)",
        "fire": "Surrey Fire and Rescue Service",
    },
    "essex": {
        "council": "Essex County Council",
        "police": "Essex Police",
        "ambulance": "East of England Ambulance Service NHS Trust (EEAST)",
        "fire": "Essex County Fire and Rescue Service",
    },
    "hertfordshire": {
        "council": "Hertfordshire County Council",
        "police": "Hertfordshire Constabulary",
        "ambulance": "East of England Ambulance Service NHS Trust (EEAST)",
        "fire": "Hertfordshire Fire and Rescue Service",
    },
    "buckinghamshire": {
        "council": "Buckinghamshire Council",
        "police": "Thames Valley Police",
        "ambulance": "South Central Ambulance Service NHS FT (SCAS)",
        "fire": "Buckinghamshire Fire and Rescue Service",
    },
    "berkshire": {
        "council": "Various Berkshire district councils",
        "police": "Thames Valley Police",
        "ambulance": "South Central Ambulance Service NHS FT (SCAS)",
        "fire": "Royal Berkshire Fire and Rescue Service",
    },
    "greater london": {
        "council": "Greater London Authority / relevant London Borough",
        "police": "Metropolitan Police Service",
        "ambulance": "London Ambulance Service NHS Trust",
        "fire": "London Fire Brigade",
    },
    "london": {
        "council": "Greater London Authority / relevant London Borough",
        "police": "Metropolitan Police Service",
        "ambulance": "London Ambulance Service NHS Trust",
        "fire": "London Fire Brigade",
    },
    "east sussex": {
        "council": "East Sussex County Council",
        "police": "Sussex Police",
        "ambulance": "South East Coast Ambulance Service NHS FT (SECAmb)",
        "fire": "East Sussex Fire & Rescue Service",
    },
    "west sussex": {
        "council": "West Sussex County Council",
        "police": "Sussex Police",
        "ambulance": "South East Coast Ambulance Service NHS FT (SECAmb)",
        "fire": "West Sussex Fire & Rescue Service",
    },
    "sussex": {
        "council": "East/West Sussex County Council",
        "police": "Sussex Police",
        "ambulance": "South East Coast Ambulance Service NHS FT (SECAmb)",
        "fire": "East/West Sussex Fire & Rescue Service",
    },
}


async def _reverse_geocode(lat: float, lon: float) -> dict:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                NOMINATIM_URL,
                params={"lat": lat, "lon": lon, "format": "json", "zoom": 8, "addressdetails": 1},
                headers=NOMINATIM_HEADERS,
            )
            if resp.status_code == 200:
                return resp.json().get("address", {})
    except Exception:
        pass
    return {}


def _area_key(address: dict) -> str:
    for key in ("county", "state_district", "city", "state"):
        val = address.get(key, "")
        if val:
            return val.lower().strip()
    return ""


async def identify_stakeholders(coordinates: list[list[float]]) -> dict:
    """
    Sample points along the diversion route, reverse-geocode each,
    and return the consultation bodies whose areas the route passes through.
    """
    if not coordinates or len(coordinates) < 2:
        return {"councils": [], "police": [], "ambulance": [], "fire": [], "areas": []}

    # Sample up to 8 evenly-spaced points (Nominatim: 1 req/sec rate limit)
    step = max(1, len(coordinates) // 8)
    sample = coordinates[::step][:8]

    areas_seen: set[str] = set()
    for coord in sample:
        lon, lat = coord[0], coord[1]
        address = await _reverse_geocode(lat, lon)
        key = _area_key(address)
        if key:
            areas_seen.add(key)
        await asyncio.sleep(1.1)

    councils: set[str] = set()
    police: set[str] = set()
    ambulance: set[str] = set()
    fire: set[str] = set()
    display_areas: list[str] = []

    for area in areas_seen:
        svc = SERVICES.get(area)
        if svc:
            councils.add(svc["council"])
            police.add(svc["police"])
            ambulance.add(svc["ambulance"])
            fire.add(svc["fire"])
            display_areas.append(area.title())
        else:
            display_areas.append(f"{area.title()} (verify manually)")

    return {
        "councils": sorted(councils),
        "police": sorted(police),
        "ambulance": sorted(ambulance),
        "fire": sorted(fire),
        "areas": sorted(display_areas),
    }
