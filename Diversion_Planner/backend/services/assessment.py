import math
import asyncpg


async def score_route(
    conn: asyncpg.Connection,
    route: dict,
    closure_geojson: dict | None,
    all_routes: list[dict],
) -> tuple[int, dict]:
    """
    Score a diversion route 0-100 across 6 weighted dimensions.
    Returns (overall_score, breakdown_dict).
    """
    breakdown = {}

    # 1. Distance efficiency (20%) — ratio of diversion to straight-line closure length
    straight_m = _straight_line_m(closure_geojson) if closure_geojson else route["distance_m"]
    ratio = route["distance_m"] / max(straight_m, 1)
    # Target ≤1.5x. Perfect=1.0x, worst we care about=4x
    dist_score = max(0.0, min(1.0, (4.0 - ratio) / (4.0 - 1.0)))
    breakdown["distance_efficiency"] = round(dist_score * 100)

    # 2. Travel time impact (25%) — travel time vs ideal (distance/national speed)
    ideal_time = route["distance_m"] / 1000 / 70 * 60  # 70 km/h in minutes
    time_ratio = route["travel_time_min"] / max(ideal_time, 0.1)
    time_score = max(0.0, min(1.0, (3.0 - time_ratio) / (3.0 - 1.0)))
    breakdown["travel_time_impact"] = round(time_score * 100)

    # 3. HGV suitability (20%) — fraction of edges that are HGV-suitable
    hgv_fraction = 1.0 - (route["non_hgv_edges"] / max(route["total_edges"], 1))
    breakdown["hgv_suitability"] = round(hgv_fraction * 100)

    # 4. Emergency access (15%) — check if route passes through emergency exclusion zones
    emergency_score = await _emergency_access_score(conn, route.get("geojson"))
    breakdown["emergency_access"] = round(emergency_score * 100)

    # 5. Local authority impact (10%) — count of LAs intersected
    la_count = await _count_local_authorities(conn, route.get("geojson"))
    # ≤2 LAs = 100, 5+ LAs = 0
    la_score = max(0.0, min(1.0, (5 - la_count) / 3.0))
    breakdown["local_authority_impact"] = round(la_score * 100)

    # 6. Network resilience (10%) — overlap with other routes
    resilience_score = _resilience_score(route, all_routes)
    breakdown["network_resilience"] = round(resilience_score * 100)

    weights = {
        "distance_efficiency": 0.20,
        "travel_time_impact": 0.25,
        "hgv_suitability": 0.20,
        "emergency_access": 0.15,
        "local_authority_impact": 0.10,
        "network_resilience": 0.10,
    }

    overall = sum(breakdown[k] * weights[k] for k in weights)
    return round(overall), breakdown


def _straight_line_m(geojson: dict) -> float:
    """Haversine distance between first and last coordinate of a LineString."""
    coords = geojson.get("coordinates", [])
    if len(coords) < 2:
        return 0
    lng1, lat1 = coords[0]
    lng2, lat2 = coords[-1]
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _emergency_access_score(conn: asyncpg.Connection, geojson: dict | None) -> float:
    if not geojson:
        return 0.8
    import json
    row = await conn.fetchrow("""
        SELECT COUNT(*) AS cnt
        FROM stakeholder_regions
        WHERE category IN ('ambulance', 'fire')
          AND ST_Intersects(
              geom,
              ST_Buffer(ST_GeomFromGeoJSON($1)::geography, 500)::geometry
          )
    """, json.dumps(geojson))
    cnt = row["cnt"] if row else 0
    return min(1.0, cnt / 3.0)


async def _count_local_authorities(conn: asyncpg.Connection, geojson: dict | None) -> int:
    if not geojson:
        return 2
    import json
    row = await conn.fetchrow("""
        SELECT COUNT(*) AS cnt
        FROM stakeholder_regions
        WHERE category = 'local_authority'
          AND ST_Intersects(geom, ST_GeomFromGeoJSON($1))
    """, json.dumps(geojson))
    return row["cnt"] if row else 2


def _resilience_score(route: dict, all_routes: list[dict]) -> float:
    """Lower coordinate overlap with other routes = higher resilience score."""
    if len(all_routes) <= 1:
        return 1.0

    def coord_set(r: dict) -> set:
        geojson = r.get("geojson") or {}
        return {(round(c[0], 4), round(c[1], 4)) for c in geojson.get("coordinates", [])}

    this_coords = coord_set(route)
    if not this_coords:
        return 0.5

    overlap_fractions = []
    for other in all_routes:
        if other is route:
            continue
        other_coords = coord_set(other)
        if not other_coords:
            continue
        overlap_fractions.append(len(this_coords & other_coords) / len(this_coords))

    if not overlap_fractions:
        return 1.0
    return 1.0 - sum(overlap_fractions) / len(overlap_fractions)
