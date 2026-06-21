import json
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from database import get_session, get_raw_conn
from models import Closure
from schemas import ClosureCreate, ClosureResponse, NearestNodeResponse
from services.routing_engine import find_nearest_node

router = APIRouter()


@router.post("", response_model=ClosureResponse, status_code=201)
async def create_closure(body: ClosureCreate, session: AsyncSession = Depends(get_session)):
    geom_wkt = None
    if body.geom_geojson:
        geom_wkt = f"SRID=4326;{_geojson_to_wkt(body.geom_geojson)}"

    closure = Closure(
        closure_type=body.closure_type,
        direction=body.direction,
        start_node=body.start_node,
        end_node=body.end_node,
        start_chainage=body.start_chainage,
        end_chainage=body.end_chainage,
        start_junction=body.start_junction,
        end_junction=body.end_junction,
        date_from=body.date_from,
        date_to=body.date_to,
        reason=body.reason,
        geom=geom_wkt,
    )
    session.add(closure)
    await session.commit()
    await session.refresh(closure)
    return _to_response(closure)


@router.get("", response_model=List[ClosureResponse])
async def list_closures(session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Closure).order_by(Closure.created_at.desc())
    )
    closures = result.scalars().all()
    return [_to_response(c) for c in closures]


@router.get("/nearest-node/find", response_model=NearestNodeResponse)
async def nearest_node(lng: float, lat: float, conn=Depends(get_raw_conn)):
    node = await find_nearest_node(conn, lng, lat)
    if not node:
        raise HTTPException(status_code=404, detail="No road network nodes found. Import OSM data first.")
    return node


@router.get("/{closure_id}", response_model=ClosureResponse)
async def get_closure(closure_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    closure = await session.get(Closure, closure_id)
    if not closure:
        raise HTTPException(status_code=404, detail="Closure not found")
    return _to_response(closure)


@router.delete("/{closure_id}", status_code=204)
async def delete_closure(closure_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    closure = await session.get(Closure, closure_id)
    if not closure:
        raise HTTPException(status_code=404, detail="Closure not found")
    await session.delete(closure)
    await session.commit()


def _to_response(c: Closure) -> ClosureResponse:
    geom_geojson = None
    if c.geom is not None:
        try:
            from geoalchemy2.shape import to_shape
            import json as _json
            shape = to_shape(c.geom)
            coords = list(shape.coords)
            geom_geojson = {"type": "LineString", "coordinates": [[c2[0], c2[1]] for c2 in coords]}
        except Exception:
            pass
    return ClosureResponse(
        id=c.id,
        closure_type=c.closure_type,
        direction=c.direction or "N/A",
        start_node=c.start_node,
        end_node=c.end_node,
        start_chainage=c.start_chainage,
        end_chainage=c.end_chainage,
        start_junction=c.start_junction,
        end_junction=c.end_junction,
        date_from=c.date_from,
        date_to=c.date_to,
        reason=c.reason,
        created_at=c.created_at,
        geom_geojson=geom_geojson,
    )


def _geojson_to_wkt(geojson: dict) -> str:
    geom_type = geojson.get("type", "LineString")
    if geom_type == "MultiLineString":
        # Flatten all rings into one LineString (LINESTRING column constraint)
        all_coords = [c for ring in geojson.get("coordinates", []) for c in ring]
        pts = ", ".join(f"{lng} {lat}" for lng, lat in all_coords)
        return f"LINESTRING({pts})"
    coords = geojson.get("coordinates", [])
    pts = ", ".join(f"{lng} {lat}" for lng, lat in coords)
    return f"LINESTRING({pts})"
