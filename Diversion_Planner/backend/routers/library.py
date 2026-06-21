import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_session
from models import DiversionLibrary, Closure, Diversion
from schemas import LibraryEntry, LibraryApproveRequest

router = APIRouter()


@router.get("", response_model=List[LibraryEntry])
async def list_library(
    status: Optional[str] = Query(None, description="Filter by approval_status"),
    session: AsyncSession = Depends(get_session),
):
    q = select(DiversionLibrary).order_by(DiversionLibrary.created_at.desc())
    if status:
        q = q.where(DiversionLibrary.approval_status == status)
    result = await session.execute(q)
    return result.scalars().all()


@router.get("/suggest")
async def suggest_diversions(
    closure_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
):
    """
    Suggest previously approved diversions that share the same start/end junctions
    as the given closure.
    """
    target = await session.get(Closure, closure_id)
    if not target:
        raise HTTPException(status_code=404, detail="Closure not found")

    result = await session.execute(
        select(Closure, DiversionLibrary, Diversion)
        .join(DiversionLibrary, DiversionLibrary.closure_id == Closure.id)
        .join(Diversion, Diversion.id == DiversionLibrary.diversion_id)
        .where(
            DiversionLibrary.approval_status == "approved",
            Closure.id != closure_id,
            Closure.closure_type == target.closure_type,
        )
        .order_by(DiversionLibrary.approved_at.desc())
        .limit(5)
    )
    rows = result.all()

    suggestions = []
    for closure, lib, div in rows:
        match_reason = []
        if closure.start_junction and closure.start_junction == target.start_junction:
            match_reason.append("matching start junction")
        if closure.end_junction and closure.end_junction == target.end_junction:
            match_reason.append("matching end junction")
        if closure.direction == target.direction:
            match_reason.append("same direction")
        suggestions.append({
            "library_id": str(lib.id),
            "closure_id": str(closure.id),
            "diversion_id": str(div.id),
            "start_junction": closure.start_junction,
            "end_junction": closure.end_junction,
            "direction": closure.direction,
            "score": div.score,
            "distance_km": round((div.distance_m or 0) / 1000, 1),
            "approved_by": lib.approved_by,
            "approved_at": lib.approved_at.isoformat() if lib.approved_at else None,
            "match_reasons": match_reason,
        })
    return suggestions


@router.patch("/{library_id}/approve", response_model=LibraryEntry)
async def approve_diversion(
    library_id: uuid.UUID,
    body: LibraryApproveRequest,
    session: AsyncSession = Depends(get_session),
):
    entry = await session.get(DiversionLibrary, library_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Library entry not found")
    entry.approval_status = "approved"
    entry.approved_by = body.approved_by
    entry.approved_at = datetime.utcnow()
    entry.notes = body.notes
    await session.commit()
    await session.refresh(entry)
    return entry


@router.patch("/{library_id}/reject", response_model=LibraryEntry)
async def reject_diversion(
    library_id: uuid.UUID,
    body: LibraryApproveRequest,
    session: AsyncSession = Depends(get_session),
):
    entry = await session.get(DiversionLibrary, library_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Library entry not found")
    entry.approval_status = "rejected"
    entry.approved_by = body.approved_by
    entry.notes = body.notes
    await session.commit()
    await session.refresh(entry)
    return entry
