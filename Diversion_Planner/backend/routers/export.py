import json
import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_session, get_raw_conn
from models import Closure, Diversion
from services.report_generator import generate_consultation_pdf
from services.stakeholder_finder import find_affected_stakeholders

router = APIRouter()


@router.get("/{closure_id}/pdf")
async def export_pdf(
    closure_id: uuid.UUID,
    ttro_ref: str = "TTRO/DRAFT",
    session: AsyncSession = Depends(get_session),
    conn=Depends(get_raw_conn),
):
    closure, routes, stakeholders = await _load_data(closure_id, session, conn)

    closure_dict = {
        "closure_type": closure.closure_type,
        "direction": closure.direction,
        "start_junction": closure.start_junction,
        "end_junction": closure.end_junction,
        "start_chainage": closure.start_chainage,
        "end_chainage": closure.end_chainage,
        "date_from": closure.date_from,
        "date_to": closure.date_to,
        "reason": closure.reason,
    }
    routes_dicts = []
    for d in routes:
        geojson = _geom_to_geojson(d)
        routes_dicts.append({
            "route_rank": d.route_rank,
            "distance_m": d.distance_m,
            "travel_time_min": d.travel_time_min,
            "score": d.score,
            "score_breakdown": d.score_breakdown or {},
        })

    pdf_bytes = generate_consultation_pdf(closure_dict, routes_dicts, stakeholders, ttro_ref)

    safe_ref = ttro_ref.replace("/", "-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="consultation_{safe_ref}.pdf"'},
    )


@router.get("/{closure_id}/geojson")
async def export_geojson(
    closure_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    conn=Depends(get_raw_conn),
):
    closure, routes, stakeholders = await _load_data(closure_id, session, conn)

    features = []

    # Closure geometry
    if closure.geom is not None:
        geojson = _geom_to_geojson(closure)
        if geojson:
            features.append({
                "type": "Feature",
                "geometry": geojson,
                "properties": {
                    "type": "closure",
                    "closure_type": closure.closure_type,
                    "direction": closure.direction,
                    "start_junction": closure.start_junction,
                    "end_junction": closure.end_junction,
                    "reason": closure.reason,
                },
            })

    # Diversion routes
    rank_labels = {1: "primary", 2: "alt_1", 3: "alt_2"}
    for d in routes:
        geojson = _geom_to_geojson(d)
        if geojson:
            features.append({
                "type": "Feature",
                "geometry": geojson,
                "properties": {
                    "type": "diversion",
                    "route_rank": d.route_rank,
                    "route_label": rank_labels.get(d.route_rank, f"route_{d.route_rank}"),
                    "distance_m": d.distance_m,
                    "travel_time_min": d.travel_time_min,
                    "score": d.score,
                },
            })

    package = {"type": "FeatureCollection", "features": features}

    return Response(
        content=json.dumps(package, indent=2),
        media_type="application/geo+json",
        headers={"Content-Disposition": f'attachment; filename="diversion_{closure_id}.geojson"'},
    )


async def _load_data(closure_id: uuid.UUID, session: AsyncSession, conn):
    closure = await session.get(Closure, closure_id)
    if not closure:
        raise HTTPException(status_code=404, detail="Closure not found")

    result = await session.execute(
        select(Diversion).where(Diversion.closure_id == closure_id).order_by(Diversion.route_rank)
    )
    routes = result.scalars().all()

    stakeholders = []
    if routes and routes[0].geom is not None:
        geojson = _geom_to_geojson(routes[0])
        if geojson:
            stakeholders = await find_affected_stakeholders(conn, geojson)

    return closure, routes, stakeholders


def _geom_to_geojson(obj) -> dict | None:
    if obj.geom is None:
        return None
    try:
        from geoalchemy2.shape import to_shape
        shape = to_shape(obj.geom)
        coords = list(shape.coords)
        return {"type": "LineString", "coordinates": [[c[0], c[1]] for c in coords]}
    except Exception:
        return None
