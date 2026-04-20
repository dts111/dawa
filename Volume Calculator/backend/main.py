"""
LandXML Surface Volume Calculator — FastAPI Backend
"""

import uuid
import json as _json
from typing import Optional, List
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from landxml_parser import parse_landxml_bytes
from volume_calculator import calculate_volumes, surface_to_mesh, compute_section
from report_generator import generate_pdf, generate_excel

app = FastAPI(
    title="LandXML Volume Calculator API",
    version="1.0.0",
)

# ── CORS — allow the Netlify frontend (and local dev) ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to your Netlify domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory session store ──
# Each session holds a LIST of surfaces accumulated from one or more uploaded files.
# Structure: { session_key: { "surfaces": [TINSurface, ...], "files": ["a.xml", ...] } }
_sessions: dict = {}


# ────────────────────────────────────────────────────────────────────────────
# Health
# ────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ────────────────────────────────────────────────────────────────────────────
# Upload & Parse LandXML
# ────────────────────────────────────────────────────────────────────────────

@app.post("/api/parse")
async def parse_landxml(
    file: UploadFile = File(...),
    session_key: Optional[str] = Form(None),   # pass existing key to ADD surfaces
):
    """
    Upload a LandXML file.
    - First upload: creates a new session and returns a session_key.
    - Subsequent uploads: pass the existing session_key to accumulate surfaces
      from multiple files into the same session.
    Duplicate surface names across files are suffixed with the filename to avoid
    collisions.
    """
    if not file.filename.lower().endswith((".xml", ".landxml")):
        raise HTTPException(
            status_code=400,
            detail="Only .xml or .landxml files are accepted."
        )

    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit.")

    try:
        new_surfaces = parse_landxml_bytes(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # ── Resolve or create session ──
    if session_key and session_key in _sessions:
        session = _sessions[session_key]
    else:
        session_key = str(uuid.uuid4())
        session = {"surfaces": [], "files": []}
        _sessions[session_key] = session

    # ── De-duplicate surface names ──
    existing_names = {s.name for s in session["surfaces"]}
    for surf in new_surfaces:
        if surf.name in existing_names:
            # Append short filename stem to make the name unique
            stem = file.filename.rsplit(".", 1)[0][-20:]   # last 20 chars
            surf.name = f"{surf.name} [{stem}]"
        existing_names.add(surf.name)
        session["surfaces"].append(surf)

    session["files"].append(file.filename)
    all_surfaces = session["surfaces"]

    return {
        "session_key": session_key,
        "filename": file.filename,
        "files_loaded": session["files"],
        "surface_count": len(all_surfaces),
        "surfaces": [s.to_dict() for s in all_surfaces],
    }


# ────────────────────────────────────────────────────────────────────────────
# Volume Calculation
# ────────────────────────────────────────────────────────────────────────────

@app.post("/api/calculate")
async def calculate(
    session_key: str = Form(...),
    surface1_name: str = Form(...),
    surface2_name: str = Form(...),
    grid_resolution: Optional[float] = Form(None),
):
    """
    Calculate cut/fill volumes between two named surfaces.
    """
    surfaces = (_sessions.get(session_key) or {}).get("surfaces")
    if not surfaces:
        raise HTTPException(
            status_code=404,
            detail="Session not found. Please re-upload the LandXML file."
        )

    surf_map = {s.name: s for s in surfaces}
    if surface1_name not in surf_map:
        raise HTTPException(status_code=404, detail=f"Surface '{surface1_name}' not found.")
    if surface2_name not in surf_map:
        raise HTTPException(status_code=404, detail=f"Surface '{surface2_name}' not found.")
    if surface1_name == surface2_name:
        raise HTTPException(status_code=400, detail="Both surfaces are identical.")

    try:
        result = calculate_volumes(
            surf_map[surface1_name],
            surf_map[surface2_name],
            grid_resolution=grid_resolution,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "summary": result.summary(),
        "grid": {
            "x": result.grid_x,
            "y": result.grid_y,
            "dz": result.dz_grid,
            "mask": result.mask_grid,
            "resolution": result.grid_resolution,
        },
    }


# ────────────────────────────────────────────────────────────────────────────
# 3-D Mesh Export
# ────────────────────────────────────────────────────────────────────────────

@app.post("/api/mesh")
async def get_mesh(
    session_key: str = Form(...),
    surface_name: str = Form(...),
):
    """Return a Three.js-ready mesh for one surface."""
    surfaces = (_sessions.get(session_key) or {}).get("surfaces")
    if not surfaces:
        raise HTTPException(status_code=404, detail="Session not found.")
    surf_map = {s.name: s for s in surfaces}
    if surface_name not in surf_map:
        raise HTTPException(status_code=404, detail=f"Surface '{surface_name}' not found.")

    mesh = surface_to_mesh(surf_map[surface_name])
    return mesh


# ────────────────────────────────────────────────────────────────────────────
# Section / Profile
# ────────────────────────────────────────────────────────────────────────────

@app.post("/api/section")
async def get_section(
    session_key: str = Form(...),
    surface_names: str = Form(...),   # JSON array, e.g. '["EG","FG","DTM"]'
    x1: float = Form(...),
    y1: float = Form(...),
    x2: float = Form(...),
    y2: float = Form(...),
    num_samples: int = Form(400),
):
    """
    Compute elevation profiles for one or more surfaces along a section line.
    If surface_names is '[]' or '*', all surfaces in the session are included.
    """
    all_surfs = (_sessions.get(session_key) or {}).get("surfaces")
    if not all_surfs:
        raise HTTPException(status_code=404, detail="Session not found.")

    try:
        names = _json.loads(surface_names)
    except Exception:
        raise HTTPException(status_code=400, detail="surface_names must be a JSON array string.")

    surf_map = {s.name: s for s in all_surfs}

    # Empty list or "*" → use all surfaces
    if not names or names == ["*"]:
        selected = all_surfs
    else:
        missing = [n for n in names if n not in surf_map]
        if missing:
            raise HTTPException(status_code=404, detail=f"Surfaces not found: {missing}")
        selected = [surf_map[n] for n in names]

    if x1 == x2 and y1 == y2:
        raise HTTPException(status_code=400, detail="Section line start and end points are identical.")

    result = compute_section(selected, x1, y1, x2, y2, num_samples)
    return result


# ────────────────────────────────────────────────────────────────────────────
# Report Generation
# ────────────────────────────────────────────────────────────────────────────

@app.post("/api/report/pdf")
async def report_pdf(
    session_key: str = Form(...),
    surface1_name: str = Form(...),
    surface2_name: str = Form(...),
    project_name: str = Form("Earthworks Project"),
    grid_resolution: Optional[float] = Form(None),
):
    surfaces = (_sessions.get(session_key) or {}).get("surfaces")
    if not surfaces:
        raise HTTPException(status_code=404, detail="Session not found.")

    surf_map = {s.name: s for s in surfaces}
    for n in (surface1_name, surface2_name):
        if n not in surf_map:
            raise HTTPException(status_code=404, detail=f"Surface '{n}' not found.")

    result = calculate_volumes(
        surf_map[surface1_name], surf_map[surface2_name], grid_resolution
    )
    pdf_bytes = generate_pdf([result], project_name=project_name)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="volume_report.pdf"'},
    )


@app.post("/api/report/excel")
async def report_excel(
    session_key: str = Form(...),
    surface1_name: str = Form(...),
    surface2_name: str = Form(...),
    project_name: str = Form("Earthworks Project"),
    grid_resolution: Optional[float] = Form(None),
):
    surfaces = (_sessions.get(session_key) or {}).get("surfaces")
    if not surfaces:
        raise HTTPException(status_code=404, detail="Session not found.")

    surf_map = {s.name: s for s in surfaces}
    for n in (surface1_name, surface2_name):
        if n not in surf_map:
            raise HTTPException(status_code=404, detail=f"Surface '{n}' not found.")

    result = calculate_volumes(
        surf_map[surface1_name], surf_map[surface2_name], grid_resolution
    )
    xlsx_bytes = generate_excel([result], project_name=project_name)

    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="volume_report.xlsx"'},
    )
