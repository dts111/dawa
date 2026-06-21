import json
import math
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
import asyncpg
from database import get_raw_conn

router = APIRouter()


async def _node_has_impacted_road(conn: asyncpg.Connection, node_id: int) -> bool:
    """Return True if this node already connects to a slip road or impacted road type."""
    row = await conn.fetchrow("""
        SELECT 1 FROM road_network
        WHERE (source = $1 OR target = $1)
          AND road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
          AND cost > 0
        LIMIT 1
    """, node_id)
    return row is not None


async def _find_outward_junction(
    conn: asyncpg.Connection,
    node_id: int,
    forward: bool,
    max_hops: int = 60,
) -> Optional[list]:
    """
    Walk along directed motorway edges from node_id, staying on the same carriageway.
    forward=False → walk backward (target→source) to find approach junction before start_node
    forward=True  → walk forward  (source→target) to find departure junction after end_node
    Returns [lng, lat] of the first node found that connects to a slip/impacted road.
    """
    if forward:
        walk_sql = """
            WITH RECURSIVE walk(node_id, depth) AS (
                SELECT DISTINCT rn.target, 1
                FROM road_network rn
                WHERE rn.source = $1 AND rn.road_type = 'motorway' AND rn.cost > 0
                UNION ALL
                SELECT DISTINCT rn.target, w.depth + 1
                FROM walk w
                JOIN road_network rn ON rn.source = w.node_id
                WHERE rn.road_type = 'motorway' AND rn.cost > 0 AND w.depth < $2
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
              AND EXISTS (
                SELECT 1 FROM road_network rn
                WHERE (rn.source = w.node_id OR rn.target = w.node_id)
                  AND rn.road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
                  AND rn.cost > 0
              )
            ORDER BY w.depth ASC
            LIMIT 1
        """
    else:
        walk_sql = """
            WITH RECURSIVE walk(node_id, depth) AS (
                SELECT DISTINCT rn.source, 1
                FROM road_network rn
                WHERE rn.target = $1 AND rn.road_type = 'motorway' AND rn.cost > 0
                UNION ALL
                SELECT DISTINCT rn.source, w.depth + 1
                FROM walk w
                JOIN road_network rn ON rn.target = w.node_id
                WHERE rn.road_type = 'motorway' AND rn.cost > 0 AND w.depth < $2
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
              AND EXISTS (
                SELECT 1 FROM road_network rn
                WHERE (rn.source = w.node_id OR rn.target = w.node_id)
                  AND rn.road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
                  AND rn.cost > 0
              )
            ORDER BY w.depth ASC
            LIMIT 1
        """
    row = await conn.fetchrow(walk_sql, node_id, max_hops)
    if row and row["lng"] is not None:
        print(f"[network] outward junction (forward={forward}) → ({row['lng']:.4f},{row['lat']:.4f})")
        return [float(row["lng"]), float(row["lat"])]
    return None


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


@router.get("/preview-closure")
async def preview_closure_line(start_node: int, end_node: int, conn: asyncpg.Connection = Depends(get_raw_conn)):
    """Return the road path between two nodes as GeoJSON LineString, extended at both ends
    to the nearest motorway/slip-road junction node so the full closure extent is visible."""
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
    """, start_node, end_node)
    if not row or not row["geojson"]:
        raise HTTPException(status_code=404, detail="No path found between the two nodes.")

    geojson = json.loads(row["geojson"])

    # Normalise to a flat coordinate list (handles both LineString and MultiLineString)
    if geojson["type"] == "MultiLineString":
        coords = [c for ring in geojson["coordinates"] for c in ring]
    else:
        coords = geojson["coordinates"]

    # Only extend if the endpoint is not already at a junction node.
    # Walk along directed motorway edges (same carriageway only).
    junc_start = None
    if not await _node_has_impacted_road(conn, start_node):
        junc_start = await _find_outward_junction(conn, start_node, forward=False)

    junc_end = None
    if not await _node_has_impacted_road(conn, end_node):
        junc_end = await _find_outward_junction(conn, end_node, forward=True)

    if junc_start:
        coords = [_offset_toward(junc_start, coords[0], 15)] + coords
    if junc_end:
        coords = coords + [_offset_toward(junc_end, coords[-1], 15)]

    return JSONResponse({"type": "LineString", "coordinates": coords})


@router.get("/impacted-roads")
async def get_impacted_roads(start_node: int, end_node: int, conn: asyncpg.Connection = Depends(get_raw_conn)):
    """Return roads that connect to the closure path (slip roads, circulatories, trunk links)."""
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
            SELECT rn.id, rn.osm_id, rn.name, rn.road_type, rn.source, rn.target, rn.geom
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
            (array_agg(source ORDER BY id))[1] AS source_node,
            (array_agg(target ORDER BY id DESC))[1] AS target_node,
            ST_AsGeoJSON(ST_LineMerge(ST_Collect(geom))) AS geojson
        FROM connected
        GROUP BY osm_id
    """, start_node, end_node)

    return [
        {
            "edge_id": r["edge_id"],
            "name": r["name"],
            "road_type": r["road_type"],
            "source_node": r["source_node"],
            "target_node": r["target_node"],
            "geojson": json.loads(r["geojson"]),
        }
        for r in rows if r["geojson"]
    ]


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
