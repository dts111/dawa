import json
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_session, get_raw_conn
from models import Closure, Diversion, DiversionLibrary
from schemas import RouteGenerateRequest, DiversionResponse
from services.routing_engine import generate_routes
from services.assessment import score_route

router = APIRouter()


@router.post("/generate", response_model=List[DiversionResponse])
async def generate_diversion_routes(
    body: RouteGenerateRequest,
    session: AsyncSession = Depends(get_session),
    conn=Depends(get_raw_conn),
):
    closure = await session.get(Closure, body.closure_id)
    if not closure:
        raise HTTPException(status_code=404, detail="Closure not found")
    if not closure.start_node or not closure.end_node:
        raise HTTPException(status_code=400, detail="Closure must have start_node and end_node set")

    # Extract closure geometry before routing (used both for avoidance and assessment)
    closure_geojson = None
    if closure.geom is not None:
        try:
            from geoalchemy2.shape import to_shape as geom_to_shape
            closure_shape = geom_to_shape(closure.geom)
            coords = list(closure_shape.coords)
            closure_geojson = {"type": "LineString", "coordinates": [[c[0], c[1]] for c in coords]}
        except Exception:
            pass

    raw_routes = await generate_routes(
        conn,
        closure.start_node,
        closure.end_node,
        body.vehicle_type,
        body.n_alternatives,
        closure_geojson=closure_geojson,
    )
    if not raw_routes:
        raise HTTPException(status_code=422, detail="No routes found. Check that road network is loaded and nodes are connected.")

    # Delete existing library entries first (FK references diversions), then diversions
    # Use raw conn to avoid SQLAlchemy autoflush ordering issues
    # Delete existing diversions; library rows cascade automatically via ON DELETE CASCADE
    existing_divs_result = await session.execute(
        select(Diversion).where(Diversion.closure_id == body.closure_id)
    )
    for div_row in existing_divs_result.scalars().all():
        await session.delete(div_row)
    await session.flush()

    saved = []
    for rdata in raw_routes:
        score, breakdown = await score_route(conn, rdata, closure_geojson, raw_routes)

        geom_wkt = None
        if rdata["geojson"]:
            geom_type = rdata["geojson"].get("type", "LineString")
            if geom_type == "MultiLineString":
                # Flatten all rings into one sequence of points
                all_coords = [c for ring in rdata["geojson"].get("coordinates", []) for c in ring]
            else:
                all_coords = rdata["geojson"].get("coordinates", [])
            if all_coords:
                pts = ", ".join(f"{c[0]} {c[1]}" for c in all_coords)
                geom_wkt = f"SRID=4326;LINESTRING({pts})"

        div = Diversion(
            closure_id=body.closure_id,
            route_rank=rdata["route_rank"],
            distance_m=rdata["distance_m"],
            travel_time_min=rdata["travel_time_min"],
            entry_node=closure.start_node,
            exit_node=closure.end_node,
            score=score,
            score_breakdown=breakdown,
            route_attributes=rdata.get("route_attributes", {}),
            path_nodes=rdata["node_ids"],
            path_edges=rdata["edge_ids"],
            geom=geom_wkt,
        )
        session.add(div)
        await session.flush()

        # Add to library as draft
        lib = DiversionLibrary(closure_id=body.closure_id, diversion_id=div.id)
        session.add(lib)

        saved.append((div, rdata["geojson"]))

    await session.commit()

    return [_to_response(d, geojson) for d, geojson in saved]


@router.get("/preview")
async def preview_diversion_routes(
    start_node: int,
    end_node: int,
    vehicle_type: str = "car",
    conn=Depends(get_raw_conn),
):
    raw_routes = await generate_routes(conn, start_node, end_node, vehicle_type, n_routes=3)
    return [
        {
            "route_rank": r["route_rank"],
            "geom_geojson": r["geojson"],
            "distance_m": r["distance_m"],
            "travel_time_min": r["travel_time_min"],
        }
        for r in raw_routes
    ]


@router.get("/{closure_id}", response_model=List[DiversionResponse])
async def get_routes_for_closure(closure_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Diversion)
        .where(Diversion.closure_id == closure_id)
        .order_by(Diversion.route_rank)
    )
    divs = result.scalars().all()
    return [_to_response(d) for d in divs]


@router.get("/diversion/{diversion_id}", response_model=DiversionResponse)
async def get_diversion(diversion_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    div = await session.get(Diversion, diversion_id)
    if not div:
        raise HTTPException(status_code=404, detail="Diversion not found")
    return _to_response(div)


def _to_response(d: Diversion, geojson: dict | None = None) -> DiversionResponse:
    if geojson is None and d.geom is not None:
        try:
            from geoalchemy2.shape import to_shape
            import json
            shape = to_shape(d.geom)
            coords = list(shape.coords)
            geojson = {"type": "LineString", "coordinates": [[c[0], c[1]] for c in coords]}
        except Exception:
            pass

    return DiversionResponse(
        id=d.id,
        closure_id=d.closure_id,
        route_rank=d.route_rank,
        distance_m=d.distance_m,
        travel_time_min=d.travel_time_min,
        entry_node=d.entry_node,
        exit_node=d.exit_node,
        score=d.score,
        score_breakdown=d.score_breakdown,
        route_attributes=d.route_attributes,
        geom_geojson=geojson,
        created_at=d.created_at,
    )
