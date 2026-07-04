import json
import math
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
import asyncpg
from database import get_raw_conn

router = APIRouter()


async def _node_has_impacted_road(conn: asyncpg.Connection, node_id: int) -> bool:
    """Return True if this node is a real junction — at least 3 distinct road segments
    meet here (a branch) — and at least one of them is a slip/impacted road type.
    A node with only 2 touching edges is just a pass-through point on a single link
    chain (e.g. a micro-segment of a slip road), even if that edge happens to be
    tagged motorway_link/trunk_link/etc; treating it as an already-resolved junction
    would wrongly skip the outward walk to a real junction with alternate access."""
    row = await conn.fetchrow("""
        WITH touching AS (
            SELECT road_type FROM road_network WHERE source = $1 OR target = $1
        )
        SELECT (SELECT count(*) FROM touching) AS degree,
               EXISTS (
                   SELECT 1 FROM touching
                   WHERE road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
               ) AS has_impacted
    """, node_id)
    return bool(row and row["degree"] >= 3 and row["has_impacted"])


async def _find_outward_junction(
    conn: asyncpg.Connection,
    node_id: int,
    forward: bool,
    closure_bearing: float,
    max_hops: int = 60,
) -> Optional[list]:
    """
    Walk along directed motorway edges from node_id, staying on the same carriageway.
    forward=False → walk backward (target→source) to find approach junction before start_node
    forward=True  → walk forward  (source→target) to find departure junction after end_node
    The "stay on the same carriageway" filter compares each hop's bearing to the
    *previous edge's* bearing (incremental heading), not to the fixed overall
    closure_bearing — only the very first hop is checked against closure_bearing,
    to make sure the walk sets off in the right direction. Interchange loops are
    built from many short segments and often curve well past 60° in aggregate
    while never making a sudden reversal; comparing every hop back to the original
    fixed bearing would incorrectly kill the walk partway around such a curve even
    though each individual turn is smooth. A hop is also let through regardless of
    bearing if it's the only candidate edge available (no fork = no wrong turn to
    guard against).
    Returns (node_id, lng, lat) of the first junction node found.
    """
    if forward:
        walk_sql = """
            WITH RECURSIVE walk(node_id, depth, last_bearing) AS (
                SELECT DISTINCT rn.target, 1, ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom))
                FROM road_network rn
                WHERE rn.source = $1 AND rn.road_type IN ('motorway', 'motorway_link') AND rn.cost > 0
                  AND (
                    cos(ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom)) - RADIANS($3::float8)) > 0.5
                    OR (SELECT count(*) FROM road_network rnf WHERE rnf.source = $1
                        AND rnf.road_type IN ('motorway', 'motorway_link') AND rnf.cost > 0) <= 1
                  )
                UNION ALL
                SELECT DISTINCT rn.target, w.depth + 1, ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom))
                FROM walk w
                JOIN road_network rn ON rn.source = w.node_id
                WHERE rn.road_type IN ('motorway', 'motorway_link') AND rn.cost > 0 AND w.depth < $2
                  AND (
                    cos(ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom)) - w.last_bearing) > 0.5
                    OR (SELECT count(*) FROM road_network rnf WHERE rnf.source = w.node_id
                        AND rnf.road_type IN ('motorway', 'motorway_link') AND rnf.cost > 0) <= 1
                  )
            )
            SELECT w.node_id,
                COALESCE(
                    (SELECT ST_X(ST_StartPoint(geom)) FROM road_network WHERE source = w.node_id AND cost > 0 LIMIT 1),
                    (SELECT ST_X(ST_EndPoint(geom))   FROM road_network WHERE target = w.node_id AND cost > 0 LIMIT 1)
                ) AS lng,
                COALESCE(
                    (SELECT ST_Y(ST_StartPoint(geom)) FROM road_network WHERE source = w.node_id AND cost > 0 LIMIT 1),
                    (SELECT ST_Y(ST_EndPoint(geom))   FROM road_network WHERE target = w.node_id AND cost > 0 LIMIT 1)
                ) AS lat
            FROM walk w
            WHERE w.node_id != $1
              AND (SELECT count(*) FROM road_network rn2 WHERE rn2.source = w.node_id OR rn2.target = w.node_id) >= 3
              AND EXISTS (
                SELECT 1 FROM road_network rn
                WHERE (rn.source = w.node_id OR rn.target = w.node_id)
                  AND rn.road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
              )
            ORDER BY w.depth ASC
            LIMIT 1
        """
    else:
        walk_sql = """
            WITH RECURSIVE walk(node_id, depth, last_bearing) AS (
                SELECT DISTINCT rn.source, 1, ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom))
                FROM road_network rn
                WHERE rn.target = $1 AND rn.road_type IN ('motorway', 'motorway_link') AND rn.cost > 0
                  AND (
                    cos(ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom)) - RADIANS($3::float8)) > 0.5
                    OR (SELECT count(*) FROM road_network rnf WHERE rnf.target = $1
                        AND rnf.road_type IN ('motorway', 'motorway_link') AND rnf.cost > 0) <= 1
                  )
                UNION ALL
                SELECT DISTINCT rn.source, w.depth + 1, ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom))
                FROM walk w
                JOIN road_network rn ON rn.target = w.node_id
                WHERE rn.road_type IN ('motorway', 'motorway_link') AND rn.cost > 0 AND w.depth < $2
                  AND (
                    cos(ST_Azimuth(ST_StartPoint(rn.geom), ST_EndPoint(rn.geom)) - w.last_bearing) > 0.5
                    OR (SELECT count(*) FROM road_network rnf WHERE rnf.target = w.node_id
                        AND rnf.road_type IN ('motorway', 'motorway_link') AND rnf.cost > 0) <= 1
                  )
            )
            SELECT w.node_id,
                COALESCE(
                    (SELECT ST_X(ST_StartPoint(geom)) FROM road_network WHERE source = w.node_id AND cost > 0 LIMIT 1),
                    (SELECT ST_X(ST_EndPoint(geom))   FROM road_network WHERE target = w.node_id AND cost > 0 LIMIT 1)
                ) AS lng,
                COALESCE(
                    (SELECT ST_Y(ST_StartPoint(geom)) FROM road_network WHERE source = w.node_id AND cost > 0 LIMIT 1),
                    (SELECT ST_Y(ST_EndPoint(geom))   FROM road_network WHERE target = w.node_id AND cost > 0 LIMIT 1)
                ) AS lat
            FROM walk w
            WHERE w.node_id != $1
              AND (SELECT count(*) FROM road_network rn2 WHERE rn2.source = w.node_id OR rn2.target = w.node_id) >= 3
              AND EXISTS (
                SELECT 1 FROM road_network rn
                WHERE (rn.source = w.node_id OR rn.target = w.node_id)
                  AND rn.road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
              )
            ORDER BY w.depth ASC
            LIMIT 1
        """
    row = await conn.fetchrow(walk_sql, node_id, max_hops, closure_bearing)
    if row and row["lng"] is not None:
        print(f"[network] outward junction (forward={forward}) node={row['node_id']} → ({row['lng']:.4f},{row['lat']:.4f})")
        return (int(row["node_id"]), float(row["lng"]), float(row["lat"]))
    return None


def _bearing(p1: list, p2: list) -> float:
    """Compass bearing in degrees (0–360) from p1 to p2 ([lng, lat])."""
    lng1, lat1 = p1; lng2, lat2 = p2
    cos_lat = math.cos(math.radians((lat1 + lat2) / 2))
    return math.degrees(math.atan2((lng2 - lng1) * cos_lat, lat2 - lat1)) % 360


def _offset_toward(from_pt: list, toward_pt: list, distance_m: float) -> list:
    """Return a point distance_m metres from from_pt toward toward_pt."""
    lng1, lat1 = from_pt
    lng2, lat2 = toward_pt
    cos_lat = math.cos(math.radians((lat1 + lat2) / 2))
    dx = (lng2 - lng1) * cos_lat * 111_000
    dy = (lat2 - lat1) * 111_000
    dist = math.hypot(dx, dy)
    if dist < 0.1:
        return from_pt
    ux, uy = dx / dist, dy / dist
    return [
        lng1 + (ux * distance_m) / (cos_lat * 111_000),
        lat1 + (uy * distance_m) / 111_000,
    ]


async def _fetch_path_coords(conn: asyncpg.Connection, from_node: int, to_node: int) -> Optional[list]:
    """Directed shortest-path geometry between two nodes as a flat coordinate list, or None."""
    row = await conn.fetchrow("""
        WITH dijkstra AS (
            SELECT path.edge
            FROM pgr_dijkstra(
                'SELECT id, source, target, cost, reverse_cost FROM road_network WHERE cost > 0',
                $1::bigint, $2::bigint, directed := true
            ) path
            WHERE path.edge >= 0
        )
        SELECT ST_AsGeoJSON(ST_LineMerge(ST_Collect(rn.geom))) AS geojson
        FROM dijkstra d
        JOIN road_network rn ON rn.id = d.edge
    """, from_node, to_node)
    if not row or not row["geojson"]:
        return None
    geojson = json.loads(row["geojson"])
    if geojson["type"] == "MultiLineString":
        return [c for ring in geojson["coordinates"] for c in ring]
    return geojson["coordinates"]


async def _node_lnglat(conn: asyncpg.Connection, node_id: int) -> Optional[list]:
    """[lng, lat] for a road_network node, or None."""
    row = await conn.fetchrow("""
        SELECT
            COALESCE(
                (SELECT ST_X(ST_StartPoint(geom)) FROM road_network WHERE source = $1 AND cost > 0 LIMIT 1),
                (SELECT ST_X(ST_EndPoint(geom))   FROM road_network WHERE target = $1 AND cost > 0 LIMIT 1)
            ) AS lng,
            COALESCE(
                (SELECT ST_Y(ST_StartPoint(geom)) FROM road_network WHERE source = $1 AND cost > 0 LIMIT 1),
                (SELECT ST_Y(ST_EndPoint(geom))   FROM road_network WHERE target = $1 AND cost > 0 LIMIT 1)
            ) AS lat
    """, node_id)
    if not row or row["lng"] is None:
        return None
    return [float(row["lng"]), float(row["lat"])]


async def _extend_to_junction(
    conn: asyncpg.Connection, node_id: int, bearing: float, forward: bool
) -> Optional[list]:
    """If node_id isn't already a real junction, walk outward and return the connecting
    path's coordinates, tip-trimmed 15m so it visually joins onto an existing line.
    forward=True → path runs node_id -> junction (append to the end of a line).
    forward=False → path runs junction -> node_id (prepend to the start of a line).
    Returns None if node_id is already a junction or none is found."""
    if await _node_has_impacted_road(conn, node_id):
        return None
    result = await _find_outward_junction(conn, node_id, forward=forward, closure_bearing=bearing)
    if not result:
        return None
    junc_id = result[0]
    ext_coords = await _fetch_path_coords(conn, node_id, junc_id) if forward else await _fetch_path_coords(conn, junc_id, node_id)
    if not ext_coords or len(ext_coords) < 2:
        return None
    if forward:
        ext_coords[-1] = _offset_toward(ext_coords[-1], ext_coords[-2], 15)
    else:
        ext_coords[0] = _offset_toward(ext_coords[0], ext_coords[1], 15)
    return ext_coords


@router.get("/preview-closure")
async def preview_closure_line(start_node: int, end_node: int, conn: asyncpg.Connection = Depends(get_raw_conn)):
    """Return the road path between two nodes as GeoJSON LineString, extended at both ends
    to the nearest motorway/slip-road junction node so the full closure extent is visible."""
    coords = await _fetch_path_coords(conn, start_node, end_node)
    if not coords:
        raise HTTPException(status_code=404, detail="No path found between the two nodes.")

    # Bearing of the closure (degrees, 0-360). Used to filter the junction walk
    # to same-carriageway edges only — cross-carriageway connectors tagged
    # highway=motorway are ~90-180° off and will be excluded by cos(diff) > 0.5.
    closure_bearing = _bearing(coords[0], coords[-1])

    start_ext = await _extend_to_junction(conn, start_node, closure_bearing, forward=False)
    if start_ext:
        coords = start_ext + coords

    end_ext = await _extend_to_junction(conn, end_node, closure_bearing, forward=True)
    if end_ext:
        coords = coords + end_ext

    return JSONResponse({"type": "LineString", "coordinates": coords})


@router.get("/impacted-roads")
async def get_impacted_roads(start_node: int, end_node: int, conn: asyncpg.Connection = Depends(get_raw_conn)):
    """Return roads that connect to the closure path (slip roads, circulatories, trunk links),
    each extended past its far end out to the nearest real junction — same principle as
    preview_closure_line — so an impacted road reads as a full connector, not the single
    short micro-edge that happens to touch the closure."""
    rows = await conn.fetch("""
        WITH closure_edges AS (
            SELECT path.edge
            FROM pgr_dijkstra(
                'SELECT id, source, target, cost, reverse_cost FROM road_network WHERE cost > 0',
                $1::bigint, $2::bigint, directed := true
            ) path
            WHERE path.edge >= 0
        ),
        closure_nodes AS (
            SELECT DISTINCT unnest(ARRAY[rn.source, rn.target]) AS node_id
            FROM closure_edges ce
            JOIN road_network rn ON rn.id = ce.edge
        ),
        closure_edge_ids AS (SELECT edge FROM closure_edges),
        connected AS (
            SELECT rn.id, rn.osm_id, rn.name, rn.road_type, rn.geom,
                CASE WHEN rn.source IN (SELECT node_id FROM closure_nodes) THEN rn.source ELSE rn.target END AS near_node,
                CASE WHEN rn.source IN (SELECT node_id FROM closure_nodes) THEN rn.target ELSE rn.source END AS far_node
            FROM road_network rn
            JOIN closure_nodes cn ON (rn.source = cn.node_id OR rn.target = cn.node_id)
            WHERE rn.id NOT IN (SELECT edge FROM closure_edge_ids)
              AND rn.road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
              AND rn.cost > 0
        )
        SELECT
            MIN(id) AS edge_id,
            osm_id,
            MAX(COALESCE(name, road_type)) AS name,
            MAX(road_type) AS road_type,
            (array_agg(near_node ORDER BY id))[1] AS near_node,
            (array_agg(far_node ORDER BY id DESC))[1] AS far_node,
            ST_AsGeoJSON(ST_LineMerge(ST_Collect(geom))) AS geojson
        FROM connected
        GROUP BY osm_id
    """, start_node, end_node)

    results = []
    for r in rows:
        if not r["geojson"]:
            continue
        geojson = json.loads(r["geojson"])
        coords = [c for ring in geojson["coordinates"] for c in ring] if geojson["type"] == "MultiLineString" else geojson["coordinates"]

        far_node = r["far_node"]
        far_point = await _node_lnglat(conn, far_node)
        if far_point and len(coords) >= 2:
            d_first = math.hypot(coords[0][0] - far_point[0], coords[0][1] - far_point[1])
            d_last = math.hypot(coords[-1][0] - far_point[0], coords[-1][1] - far_point[1])
            far_is_last = d_last <= d_first
            near_point = coords[0] if far_is_last else coords[-1]
            road_bearing = _bearing(near_point, far_point)
            ext = await _extend_to_junction(conn, far_node, road_bearing, forward=far_is_last)
            if ext:
                coords = (coords + ext) if far_is_last else (ext + coords)

        results.append({
            "edge_id": r["edge_id"],
            "name": r["name"],
            "road_type": r["road_type"],
            "source_node": r["near_node"],
            "target_node": far_node,
            "geojson": {"type": "LineString", "coordinates": coords},
        })
    return results


@router.get("/node/{node_id}")
async def get_node_by_id(node_id: int, conn: asyncpg.Connection = Depends(get_raw_conn)):
    """Return coordinates for a given road network node ID."""
    row = await conn.fetchrow("""
        SELECT
            COALESCE(
                (SELECT ST_X(ST_StartPoint(geom)) FROM road_network WHERE source = $1 AND cost > 0 LIMIT 1),
                (SELECT ST_X(ST_EndPoint(geom))   FROM road_network WHERE target = $1 AND cost > 0 LIMIT 1)
            ) AS lng,
            COALESCE(
                (SELECT ST_Y(ST_StartPoint(geom)) FROM road_network WHERE source = $1 AND cost > 0 LIMIT 1),
                (SELECT ST_Y(ST_EndPoint(geom))   FROM road_network WHERE target = $1 AND cost > 0 LIMIT 1)
            ) AS lat
    """, node_id)
    if not row or row["lng"] is None:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found in road network")
    return {"node_id": node_id, "lng": float(row["lng"]), "lat": float(row["lat"])}


@router.get("/interchange-links")
async def get_interchange_links(conn: asyncpg.Connection = Depends(get_raw_conn)):
    """Return motorway_link and trunk_link segments for interchange gap-fill."""
    rows = await conn.fetch("""
        WITH m25_geom AS (
            SELECT ST_Union(geom) AS geom
            FROM road_network
            WHERE road_type = 'motorway'
              AND name LIKE '%M25%'
        ),
        link_roads AS (
            SELECT rn.id, rn.geom, rn.road_type, rn.name
            FROM road_network rn, m25_geom mg
            WHERE rn.road_type IN ('motorway_link', 'trunk_link')
              AND rn.geom IS NOT NULL
              AND ST_DWithin(rn.geom, mg.geom, 0.008)
        ),
        link_union AS (
            SELECT ST_Union(geom) AS geom FROM link_roads
        ),
        circulatory_roads AS (
            SELECT rn.id, rn.geom, rn.road_type, rn.name
            FROM road_network rn, link_union lu
            WHERE rn.road_type IN ('trunk', 'trunk_link', 'primary', 'primary_link')
              AND rn.geom IS NOT NULL
              AND ST_DWithin(rn.geom, lu.geom, 0.005)
        )
        SELECT DISTINCT ON (id)
            ST_AsGeoJSON(ST_Simplify(geom, 0.00005)) AS geom,
            road_type,
            name
        FROM (
            SELECT id, geom, road_type, name FROM link_roads
            UNION ALL
            SELECT id, geom, road_type, name FROM circulatory_roads
        ) combined
    """)

    features = [
        {
            "type": "Feature",
            "geometry": json.loads(row["geom"]),
            "properties": {"road_type": row["road_type"], "name": row["name"]},
        }
        for row in rows
        if row["geom"]
    ]

    return JSONResponse({"type": "FeatureCollection", "features": features})
