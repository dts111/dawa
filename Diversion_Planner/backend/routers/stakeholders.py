import uuid
import json
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_session, get_raw_conn
from models import Diversion
from schemas import StakeholderResponse
from services.stakeholder_finder import find_affected_stakeholders

router = APIRouter()


@router.get("/{closure_id}", response_model=List[StakeholderResponse])
async def get_stakeholders_for_closure(
    closure_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    conn=Depends(get_raw_conn),
):
    # Use primary diversion route geometry for stakeholder lookup
    result = await session.execute(
        select(Diversion)
        .where(Diversion.closure_id == closure_id)
        .order_by(Diversion.route_rank)
        .limit(1)
    )
    primary = result.scalar_one_or_none()
    if not primary:
        raise HTTPException(status_code=404, detail="No diversion routes found for this closure. Generate routes first.")
    if primary.geom is None:
        raise HTTPException(status_code=422, detail="Primary diversion has no geometry")

    try:
        from geoalchemy2.shape import to_shape
        shape = to_shape(primary.geom)
        coords = list(shape.coords)
        geojson = {"type": "LineString", "coordinates": [[c[0], c[1]] for c in coords]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Geometry conversion failed: {e}")

    stakeholders = await find_affected_stakeholders(conn, geojson)
    return stakeholders
