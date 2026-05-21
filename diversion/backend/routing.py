import math
import os
import re
import httpx

ORS_BASE = "https://api.openrouteservice.org/v2"


def _headers() -> dict:
    return {
        "Authorization": os.getenv("ORS_API_KEY", ""),
        "Content-Type": "application/json",
        "Accept": "application/geo+json",
    }


def _distance_m(start: list[float], end: list[float]) -> float:
    """Approximate distance in metres between two [lat, lon] points."""
    lat1, lon1 = start
    lat2, lon2 = end
    dlat = (lat2 - lat1) * 111320
    dlon = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.sqrt(dlat ** 2 + dlon ** 2)



def _extract_road_names(feature: dict) -> list[str]:
    names: list[str] = []
    for seg in feature.get("properties", {}).get("segments", []):
        for step in seg.get("steps", []):
            name = step.get("name", "").strip()
            if name and name != "-" and name not in names:
                names.append(name)
    return names


def _parse_routes(data: dict) -> list[dict]:
    routes = []
    for i, feat in enumerate(data.get("features", [])):
        summary = feat.get("properties", {}).get("summary", {})
        road_names = _extract_road_names(feat)
        # Skip motorway designations (M25, M3 etc.) — show the first A/B-road
        label_road = next(
            (n for n in road_names if not re.match(r'^M\d+$', n.strip())),
            road_names[0] if road_names else None,
        )
        label = f"Via {label_road}" if label_road else f"Option {i + 1}"
        routes.append({
            "index": i,
            "geometry": feat["geometry"],
            "distance_km": round(summary.get("distance", 0), 1),
            "duration_min": round(summary.get("duration", 0) / 60),
            "road_names": road_names[:15],
            "label": label,
        })
    return routes


async def _call_ors(payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{ORS_BASE}/directions/driving-car/geojson",
            json=payload,
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.json()


async def get_direct_route(start: list[float], end: list[float]) -> dict | None:
    """Route directly between two points (represents the M25 closed section)."""
    payload = {
        "coordinates": [[start[1], start[0]], [end[1], end[0]]],
        "radiuses": [-1, -1],
        "instructions": False,
        "units": "km",
    }
    try:
        data = await _call_ors(payload)
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"ORS error {e.response.status_code}: {e.response.text}") from e

    features = data.get("features", [])
    if not features:
        return None
    feat = features[0]
    summary = feat.get("properties", {}).get("summary", {})
    return {
        "geometry": feat["geometry"],
        "distance_km": round(summary.get("distance", 0), 1),
        "duration_min": round(summary.get("duration", 0) / 60),
    }


def _build_path_corridor(path: list[list[float]], buffer_m: float) -> dict:
    """MultiPolygon corridor following a sequence of [lat, lon] waypoints."""
    segments = []
    for i in range(len(path) - 1):
        seg = _build_corridor_raw(path[i], path[i + 1], buffer_m)
        ring = seg.get("coordinates", [[]])[0]
        if ring:
            segments.append(ring)
    if not segments:
        return {"type": "Polygon", "coordinates": [[]]}
    if len(segments) == 1:
        return {"type": "Polygon", "coordinates": segments}
    return {"type": "MultiPolygon", "coordinates": [[s] for s in segments]}


async def get_diversion_routes(
    start: list[float], end: list[float],
    closure_path: list[list[float]] | None = None,
) -> list[dict]:
    """
    Find alternative diversion routes.
    Primary: avoid_features=highways (guaranteed no motorway use).
    Fallback 1: path-following polygon corridor.
    Fallback 2: no constraints.
    """
    coords = [[start[1], start[0]], [end[1], end[0]]]

    try:
        data = await _call_ors({
            "coordinates": coords, "radiuses": [-1, -1],
            "alternative_routes": {"share_factor": 0.6, "target_count": 3, "weight_factor": 1.6},
            "options": {"avoid_features": ["highways"]},
            "instructions": True, "units": "km",
        })
        routes = _parse_routes(data)
        if routes:
            return routes
    except httpx.HTTPStatusError as e:
        print(f"[ORS] avoid-highways attempt failed: {e.response.status_code} — {e.response.text[:300]}")

    if closure_path and len(closure_path) >= 2:
        corridor = _build_path_corridor(closure_path, max(200, min(1000, _distance_m(start, end) * 0.20)))
        try:
            data = await _call_ors({
                "coordinates": coords, "radiuses": [-1, -1],
                "alternative_routes": {"share_factor": 0.5, "target_count": 3, "weight_factor": 2.0},
                "options": {"avoid_polygons": corridor},
                "instructions": True, "units": "km",
            })
            routes = _parse_routes(data)
            if routes:
                return routes
        except httpx.HTTPStatusError as e:
            print(f"[ORS] corridor attempt failed: {e.response.status_code} — {e.response.text[:300]}")

    try:
        data = await _call_ors({
            "coordinates": coords, "radiuses": [-1, -1],
            "alternative_routes": {"share_factor": 0.5, "target_count": 3, "weight_factor": 2.0},
            "instructions": True, "units": "km",
        })
        return _parse_routes(data)
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"ORS error {e.response.status_code}: {e.response.text}") from e


def _build_corridor_raw(start: list[float], end: list[float], buffer_m: float) -> dict:
    lat1, lon1 = start
    lat2, lon2 = end
    avg_lat = (lat1 + lat2) / 2
    buf_lat = buffer_m / 111320
    buf_lon = buffer_m / (111320 * math.cos(math.radians(avg_lat)))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    length = math.sqrt(dlat ** 2 + dlon ** 2)
    if length < 1e-9:
        return {"type": "Polygon", "coordinates": [[]]}
    perp_lat = -dlon / length * buf_lat
    perp_lon =  dlat / length * buf_lon
    # No endpoint extension: polygon ends exactly at junction coords so slip roads stay accessible
    p1 = [lon1 - perp_lon, lat1 - perp_lat]
    p2 = [lon1 + perp_lon, lat1 + perp_lat]
    p3 = [lon2 + perp_lon, lat2 + perp_lat]
    p4 = [lon2 - perp_lon, lat2 - perp_lat]
    return {"type": "Polygon", "coordinates": [[p1, p2, p3, p4, p1]]}
