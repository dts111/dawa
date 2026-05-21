import math

# Junctions listed in CLOCKWISE order (index 0 = J1a Dartford, ascending clockwise)
JUNCTIONS = [
    {"id": "J1a",  "name": "Dartford (Bluewater)",  "lat": 51.4477, "lon":  0.2692},
    {"id": "J2",   "name": "A2 Dartford",            "lat": 51.4201, "lon":  0.2107},
    {"id": "J3",   "name": "A20 Swanley",            "lat": 51.3835, "lon":  0.1492},
    {"id": "J4",   "name": "A21 Orpington",          "lat": 51.3648, "lon":  0.0729},
    {"id": "J5",   "name": "A21 Sevenoaks",          "lat": 51.3114, "lon":  0.0091},
    {"id": "J6",   "name": "M26 Sevenoaks",          "lat": 51.2868, "lon":  0.0015},
    {"id": "J7",   "name": "A23 Redhill",            "lat": 51.2880, "lon": -0.1324},
    {"id": "J8",   "name": "A217 Reigate",           "lat": 51.2584, "lon": -0.2198},
    {"id": "J9",   "name": "A243 Leatherhead",       "lat": 51.3041, "lon": -0.3254},
    {"id": "J10",  "name": "A3 Wisley",              "lat": 51.3024, "lon": -0.4437},
    {"id": "J11",  "name": "A320 Chertsey",          "lat": 51.3741, "lon": -0.5130},
    {"id": "J12",  "name": "M3",                     "lat": 51.3694, "lon": -0.5700},
    {"id": "J13",  "name": "A30 Staines",            "lat": 51.4329, "lon": -0.5527},
    {"id": "J14",  "name": "A3113 Heathrow",         "lat": 51.4773, "lon": -0.4700},
    {"id": "J15",  "name": "M4",                     "lat": 51.5001, "lon": -0.4983},
    {"id": "J16",  "name": "M40 Uxbridge",           "lat": 51.5544, "lon": -0.4876},
    {"id": "J17",  "name": "A412 Maple Cross",       "lat": 51.6135, "lon": -0.4980},
    {"id": "J18",  "name": "A404 Chorleywood",       "lat": 51.6594, "lon": -0.5308},
    {"id": "J19",  "name": "A41 Watford",            "lat": 51.6977, "lon": -0.4263},
    {"id": "J20",  "name": "A41 Kings Langley",      "lat": 51.7211, "lon": -0.4086},
    {"id": "J21",  "name": "M1",                     "lat": 51.7269, "lon": -0.3969},
    {"id": "J21a", "name": "A405 St Albans",         "lat": 51.7303, "lon": -0.3493},
    {"id": "J22",  "name": "A1081 London Colney",    "lat": 51.7286, "lon": -0.2963},
    {"id": "J23",  "name": "A1(M) South Mimms",     "lat": 51.7189, "lon": -0.2355},
    {"id": "J24",  "name": "A111 Potters Bar",       "lat": 51.6990, "lon": -0.1978},
    {"id": "J25",  "name": "A10 Waltham Cross",      "lat": 51.6757, "lon": -0.0350},
    {"id": "J26",  "name": "A121 Waltham Abbey",     "lat": 51.6720, "lon":  0.0063},
    {"id": "J27",  "name": "M11 Epping",             "lat": 51.6828, "lon":  0.0982},
    {"id": "J28",  "name": "A12 Brook Street",       "lat": 51.6133, "lon":  0.2330},
    {"id": "J29",  "name": "A127 Romford",           "lat": 51.5476, "lon":  0.2633},
    {"id": "J30",  "name": "A13 Thurrock",           "lat": 51.4932, "lon":  0.2726},
    {"id": "J31",  "name": "A1306 Lakeside",         "lat": 51.4876, "lon":  0.2725},
]

N = len(JUNCTIONS)


def _dist_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat = (lat2 - lat1) * 111320
    dlon = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.sqrt(dlat ** 2 + dlon ** 2)


def _nearest_two_indices(lat: float, lon: float) -> tuple[int, int]:
    """Return the indices of the two closest junctions."""
    dists = [_dist_m(lat, lon, j["lat"], j["lon"]) for j in JUNCTIONS]
    sorted_idx = sorted(range(N), key=lambda i: dists[i])
    return sorted_idx[0], sorted_idx[1]


def _clockwise_before(i: int, k: int) -> int:
    """
    Given two junction indices i and k, return the index that comes
    FIRST in the clockwise direction (i.e. the smaller clockwise step).
    """
    # Clockwise distance from i to k
    cw_i_to_k = (k - i) % N
    # Clockwise distance from k to i
    cw_k_to_i = (i - k) % N
    # i comes before k if going clockwise from i to k is shorter
    return i if cw_i_to_k <= cw_k_to_i else k


def _clockwise_after(i: int, k: int) -> int:
    """Return whichever of i, k comes LATER in the clockwise direction."""
    before = _clockwise_before(i, k)
    return k if before == i else i


def get_closure_junctions(
    start_lat: float, start_lon: float,
    end_lat:   float, end_lon:   float,
    direction: str = "clockwise",
) -> tuple[dict, dict]:
    """
    Find the exit and entry junctions for a closure.

    Clockwise:
      exit  = last junction BEFORE the works start (where traffic diverts off)
      entry = first junction AFTER the works end   (where traffic rejoins)

    Anticlockwise: reversed — exit is the junction just past the works start
    (in clockwise terms, which is just before it anticlockwise).
    """
    si1, si2 = _nearest_two_indices(start_lat, start_lon)
    ei1, ei2 = _nearest_two_indices(end_lat,   end_lon)

    if direction == "clockwise":
        # Exit = the junction that comes FIRST (earlier clockwise) near start
        exit_idx  = _clockwise_before(si1, si2)
        # Entry = the junction that comes LAST (later clockwise) near end
        entry_idx = _clockwise_after(ei1, ei2)
    else:
        # Anticlockwise: exit is the later-clockwise junction near start
        exit_idx  = _clockwise_after(si1, si2)
        # Entry is the earlier-clockwise junction near end
        entry_idx = _clockwise_before(ei1, ei2)

    # If they resolve to the same junction, extend by one in travel direction
    if exit_idx == entry_idx:
        if direction == "clockwise":
            entry_idx = (entry_idx + 1) % N
        else:
            exit_idx = (exit_idx + 1) % N

    return JUNCTIONS[exit_idx], JUNCTIONS[entry_idx]


def _junction_diversion_endpoints(idx: int, direction: str = "clockwise") -> tuple[list[float], list[float]]:
    """Return [lat,lon] ORS start/end points 300m before and after a junction."""
    jct = JUNCTIONS[idx]
    prev_idx = (idx - 1) % N if direction == "clockwise" else (idx + 1) % N
    next_idx = (idx + 1) % N if direction == "clockwise" else (idx - 1) % N
    prev_jct = JUNCTIONS[prev_idx]
    next_jct = JUNCTIONS[next_idx]
    OFFSET = 300 / 111320
    dlat_in  = jct["lat"] - prev_jct["lat"];  dlon_in  = jct["lon"] - prev_jct["lon"]
    dlat_out = next_jct["lat"] - jct["lat"];  dlon_out = next_jct["lon"] - jct["lon"]
    len_in  = math.sqrt(dlat_in**2  + dlon_in**2)  or 1
    len_out = math.sqrt(dlat_out**2 + dlon_out**2) or 1
    start = [jct["lat"] - dlat_in  / len_in  * OFFSET, jct["lon"] - dlon_in  / len_in  * OFFSET]
    end   = [jct["lat"] + dlat_out / len_out * OFFSET, jct["lon"] + dlon_out / len_out * OFFSET]
    return start, end


def get_closure_info(
    start_lat: float, start_lon: float,
    end_lat:   float, end_lon:   float,
    direction: str = "clockwise",
) -> dict:
    """
    Detects whether works are at a junction or on the mainline and returns all
    closure/diversion coordinates needed by main.py.
    """
    AT_JUNCTION_M = 300
    si1, _ = _nearest_two_indices(start_lat, start_lon)
    ei1, _ = _nearest_two_indices(end_lat,   end_lon)
    dist_s = _dist_m(start_lat, start_lon, JUNCTIONS[si1]["lat"], JUNCTIONS[si1]["lon"])
    dist_e = _dist_m(end_lat,   end_lon,   JUNCTIONS[ei1]["lat"], JUNCTIONS[ei1]["lon"])

    if si1 == ei1 and dist_s < AT_JUNCTION_M and dist_e < AT_JUNCTION_M:
        jct = JUNCTIONS[si1]
        div_start, div_end = _junction_diversion_endpoints(si1, direction)
        closure = {
            "type": "LineString",
            "coordinates": [
                [div_start[1], div_start[0]],
                [jct["lon"], jct["lat"]],
                [div_end[1],   div_end[0]],
            ],
        }
        return {
            "exit_jct": jct, "entry_jct": jct,
            "diversion_start": div_start, "diversion_end": div_end,
            "closure": closure, "at_junction": True,
        }

    exit_jct, entry_jct = get_closure_junctions(start_lat, start_lon, end_lat, end_lon, direction)
    return {
        "exit_jct": exit_jct, "entry_jct": entry_jct,
        "diversion_start": [exit_jct["lat"], exit_jct["lon"]],
        "diversion_end":   [entry_jct["lat"], entry_jct["lon"]],
        "closure": get_closure_path(exit_jct, entry_jct, direction),
        "at_junction": False,
    }


def get_closure_path(exit_jct: dict, entry_jct: dict, direction: str = "clockwise") -> dict:
    """Return GeoJSON LineString of the M25 between exit and entry junctions."""
    exit_idx  = next(i for i, j in enumerate(JUNCTIONS) if j["id"] == exit_jct["id"])
    entry_idx = next(i for i, j in enumerate(JUNCTIONS) if j["id"] == entry_jct["id"])
    if direction == "clockwise":
        if exit_idx <= entry_idx:
            path = JUNCTIONS[exit_idx : entry_idx + 1]
        else:
            path = JUNCTIONS[exit_idx:] + JUNCTIONS[: entry_idx + 1]
    else:
        if entry_idx <= exit_idx:
            path = list(reversed(JUNCTIONS[entry_idx : exit_idx + 1]))
        else:
            path = list(reversed(JUNCTIONS[entry_idx:] + JUNCTIONS[: exit_idx + 1]))
    return {"type": "LineString", "coordinates": [[j["lon"], j["lat"]] for j in path]}
