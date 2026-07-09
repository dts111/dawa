"""
LandXML Surface Volume Calculator — FastAPI Backend
"""

import csv as _csv
import io as _io
import uuid
import json as _json
from typing import Optional, List, Tuple
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from landxml_parser import parse_landxml_bytes, retrim_surface
from geometry_utils import breakline_envelope, chain_breaklines
from volume_calculator import calculate_volumes, surface_to_mesh, compute_section
from report_generator import generate_pdf, generate_excel
from excavation_profile import (
    ExcavationConfig, parse_batter_angle, generate_stations,
    detect_batter_requirement, compute_excavation_profile,
)
from landxml_writer import write_landxml_surface

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
    max_edge_length: Optional[float] = Form(None),   # explicit bridge-triangle-trim threshold (m); omit = no trimming
    clip_to_boundary: bool = Form(False),   # geometric clip to the main boundary polygon; requires max_edge_length
    min_angle_deg: Optional[float] = Form(None),   # explicit sliver-triangle-trim threshold (deg); omit = no trimming
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
        new_surfaces = parse_landxml_bytes(
            data, max_edge_length=max_edge_length, clip_to_boundary=clip_to_boundary,
            min_angle_deg=min_angle_deg,
        )
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


@app.post("/api/retrim")
async def retrim(
    session_key: str = Form(...),
    max_edge_length: Optional[float] = Form(None),
    clip_to_boundary: bool = Form(False),
    min_angle_deg: Optional[float] = Form(None),
):
    """
    Re-apply Max Triangle Edge / Clip to Boundary / Min Triangle Angle to every
    surface in the session, using each surface's already-parsed raw faces
    (TINSurface.raw_faces) — no file re-upload needed. Updates the session in
    place, so /api/mesh, /api/boundary, /api/breaklines etc. immediately reflect
    the new state. Powers the "dynamic" Advanced Options behaviour in the UI:
    adjusting the value live re-trims already-loaded surfaces instead of only
    affecting files added afterwards.
    """
    session = _sessions.get(session_key)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    try:
        session["surfaces"] = [
            retrim_surface(
                s, max_edge_length=max_edge_length, clip_to_boundary=clip_to_boundary,
                min_angle_deg=min_angle_deg,
            )
            for s in session["surfaces"]
        ]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "surface_count": len(session["surfaces"]),
        "surfaces": [s.to_dict() for s in session["surfaces"]],
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
# Boundary & Breaklines
# ────────────────────────────────────────────────────────────────────────────

@app.post("/api/boundary")
async def get_boundary(
    session_key: str = Form(...),
    surface_name: str = Form(...),
):
    """
    Return the outer boundary/hole loops of a surface's (already bridge-triangle-
    filtered) triangulation. The largest loop by point count is the true outer
    perimeter; smaller loops are usually isolated fragments or interior holes.

    Boundary loops are always computed at import time (see TINSurface.boundary_loops
    in landxml_parser.py) — this endpoint just resolves the cached point indices
    to coordinates, it doesn't recompute anything.
    """
    surfaces = (_sessions.get(session_key) or {}).get("surfaces")
    if not surfaces:
        raise HTTPException(status_code=404, detail="Session not found.")
    surf_map = {s.name: s for s in surfaces}
    if surface_name not in surf_map:
        raise HTTPException(status_code=404, detail=f"Surface '{surface_name}' not found.")

    surface = surf_map[surface_name]
    loops_sorted = sorted(surface.boundary_loops, key=len, reverse=True)

    return {
        "loops": [
            {
                "points": surface.points[loop].tolist(),
                "point_count": len(loop),
            }
            for loop in loops_sorted
        ],
    }


@app.post("/api/breaklines")
async def get_breaklines(
    session_key: str = Form(...),
    surface_name: str = Form(...),
):
    """Return the surface's source breaklines (3D polylines), if the LandXML file had any."""
    surfaces = (_sessions.get(session_key) or {}).get("surfaces")
    if not surfaces:
        raise HTTPException(status_code=404, detail="Session not found.")
    surf_map = {s.name: s for s in surfaces}
    if surface_name not in surf_map:
        raise HTTPException(status_code=404, detail=f"Surface '{surface_name}' not found.")

    surface = surf_map[surface_name]
    return {"breaklines": [bl.to_dict() for bl in surface.breaklines]}


@app.post("/api/breakline-envelope")
async def get_breakline_envelope(
    session_key: str = Form(...),
    surface_name: str = Form(...),
):
    """
    Return the convex-hull envelope of all the surface's source breakline points —
    the outer extent of the real surveyed data (kerblines, carriageway edges,
    centrelines, etc.), as a single closed line. Distinct from `boundary_loops`
    (which traces the *triangulation's* outer edge): this traces the *source data's*
    outer edge, useful for spotting triangulation that extends beyond real survey
    coverage (e.g. Delaunay "bridge" triangles).
    """
    surfaces = (_sessions.get(session_key) or {}).get("surfaces")
    if not surfaces:
        raise HTTPException(status_code=404, detail="Session not found.")
    surf_map = {s.name: s for s in surfaces}
    if surface_name not in surf_map:
        raise HTTPException(status_code=404, detail=f"Surface '{surface_name}' not found.")

    surface = surf_map[surface_name]
    hull = breakline_envelope(surface.breaklines)
    if hull is None:
        return {"envelope": None}
    return {"envelope": {"points": hull.tolist(), "point_count": len(hull)}}


@app.post("/api/breakline-chain")
async def get_breakline_chain(
    session_key: str = Form(...),
    surface_name: str = Form(...),
):
    """
    Attempt to join the surface's source breaklines end-to-end into continuous
    polylines (see geometry_utils.chain_breaklines) — closed loops separate from
    open (gapped) chains, plus every dead-end and ambiguous-branch point found.
    A best-effort stitch, not a guess: real breakline networks are often a mix of
    feature types that don't trace one clean perimeter, so this reports exactly
    where automatic chaining succeeds and where it breaks down, rather than
    silently producing a wrong or self-intersecting polygon.
    """
    surfaces = (_sessions.get(session_key) or {}).get("surfaces")
    if not surfaces:
        raise HTTPException(status_code=404, detail="Session not found.")
    surf_map = {s.name: s for s in surfaces}
    if surface_name not in surf_map:
        raise HTTPException(status_code=404, detail=f"Surface '{surface_name}' not found.")

    surface = surf_map[surface_name]
    result = chain_breaklines(surface.breaklines)
    return {
        "loops": [{"points": loop.tolist(), "point_count": len(loop)} for loop in result["loops"]],
        "open_chains": [
            {"points": chain.tolist(), "point_count": len(chain)} for chain in result["open_chains"]
        ],
        "gap_points": [p.tolist() for p in result["gap_points"]],
        "branch_points": [p.tolist() for p in result["branch_points"]],
    }


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


# ────────────────────────────────────────────────────────────────────────────
# Maximum Excavation Profile
# ────────────────────────────────────────────────────────────────────────────

def _resolve_excavation_surfaces(session_key: str, hbxc_name: str, eg_name: str, intermediate_names_json: str):
    surfaces = (_sessions.get(session_key) or {}).get("surfaces")
    if not surfaces:
        raise HTTPException(status_code=404, detail="Session not found. Please re-upload the LandXML file.")

    surf_map = {s.name: s for s in surfaces}
    if hbxc_name not in surf_map:
        raise HTTPException(status_code=404, detail=f"Surface '{hbxc_name}' not found.")
    if eg_name not in surf_map:
        raise HTTPException(status_code=404, detail=f"Surface '{eg_name}' not found.")

    try:
        intermediate_names = _json.loads(intermediate_names_json)
    except Exception:
        raise HTTPException(status_code=400, detail="intermediate_names must be a JSON array string.")

    missing = [n for n in intermediate_names if n not in surf_map]
    if missing:
        raise HTTPException(status_code=404, detail=f"Surfaces not found: {missing}")

    intermediates = [surf_map[n] for n in intermediate_names]
    return surf_map[hbxc_name], surf_map[eg_name], intermediates


def _parse_polyline(polyline_json: str) -> List[Tuple[float, float]]:
    try:
        raw = _json.loads(polyline_json)
    except Exception:
        raise HTTPException(status_code=400, detail="polyline must be a JSON array string.")
    if not isinstance(raw, list) or len(raw) < 2:
        raise HTTPException(status_code=400, detail="polyline must be a JSON array of at least 2 {x,y} points.")
    try:
        return [(float(p["x"]), float(p["y"])) for p in raw]
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Each polyline vertex must be an object with numeric x and y.")


def _get_cached_excavation_result(session_key: str):
    session = _sessions.get(session_key)
    result = session.get("excavation_result") if session else None
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="No excavation result cached for this session. Run /api/excavation/compute first.",
        )
    return result


@app.post("/api/excavation/batter-check")
async def excavation_batter_check(
    session_key: str = Form(...),
    hbxc_name: str = Form(...),
    eg_name: str = Form(...),
    intermediate_names: str = Form("[]"),
    polyline: str = Form(...),
    chainage_interval: float = Form(10.0),
    max_search_distance: float = Form(50.0),
    sample_step: float = Form(0.25),
    tolerance_mm: float = Form(1.0),
):
    """
    Determine whether ANY station/side along the corridor will need a batter
    angle, without requiring one to be supplied. Lets the frontend only prompt
    for a batter angle/ratio when at least one segment actually needs it.
    """
    hbxc, eg, intermediates = _resolve_excavation_surfaces(session_key, hbxc_name, eg_name, intermediate_names)
    poly = _parse_polyline(polyline)

    cfg = ExcavationConfig(
        chainage_interval=chainage_interval, max_search_distance=max_search_distance,
        sample_step=sample_step, tolerance_m=tolerance_mm / 1000.0,
    )
    try:
        stations = generate_stations(poly, chainage_interval)
        check = detect_batter_requirement(hbxc, eg, intermediates, stations, cfg)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return check.to_dict()


@app.post("/api/excavation/compute")
async def excavation_compute(
    session_key: str = Form(...),
    hbxc_name: str = Form(...),
    eg_name: str = Form(...),
    intermediate_names: str = Form("[]"),
    polyline: str = Form(...),
    chainage_interval: float = Form(10.0),
    max_search_distance: float = Form(50.0),
    sample_step: float = Form(0.25),
    tolerance_mm: float = Form(1.0),
    batter_input: Optional[str] = Form(None),
):
    """
    Runs the full excavation profile pipeline: cross-section tracing, batter
    projection where needed, tie-in checking, chainage-range reporting, and
    rebuilding the excavation surface. Caches the result in the session for
    the export/station-profile endpoints to reuse.
    """
    hbxc, eg, intermediates = _resolve_excavation_surfaces(session_key, hbxc_name, eg_name, intermediate_names)
    poly = _parse_polyline(polyline)

    batter = None
    if batter_input:
        try:
            batter = parse_batter_angle(batter_input)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    cfg = ExcavationConfig(
        chainage_interval=chainage_interval, max_search_distance=max_search_distance,
        sample_step=sample_step, tolerance_m=tolerance_mm / 1000.0, batter=batter,
    )

    try:
        result = compute_excavation_profile(hbxc, eg, intermediates, poly, cfg)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    _sessions[session_key]["excavation_result"] = result

    return {
        "config": result.config.to_dict(),
        "stations": [r.to_dict(include_path=False) for r in result.station_results],
        "ranges": [r.to_dict() for r in result.ranges],
        "report_text": result.report_text(),
        "summary": result.summary(),
    }


@app.post("/api/excavation/station-profile")
async def excavation_station_profile(
    session_key: str = Form(...),
    chainage: float = Form(...),
    side: str = Form(...),
):
    """Full traced path for one station/side, for on-demand charting."""
    result = _get_cached_excavation_result(session_key)
    side = side.upper()
    match = next(
        (r for r in result.station_results if r.side == side and abs(r.chainage - chainage) < 1e-6),
        None,
    )
    if match is None:
        raise HTTPException(status_code=404, detail=f"No station found at chainage {chainage}, side {side}.")
    return match.to_dict(include_path=True)


@app.post("/api/excavation/export/landxml")
async def excavation_export_landxml(session_key: str = Form(...)):
    """Download the rebuilt excavation surface as a LandXML TIN surface."""
    result = _get_cached_excavation_result(session_key)
    xml_bytes = write_landxml_surface(result.surface, project_name="Excavation Profile Export")
    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={"Content-Disposition": 'attachment; filename="excavation_profile.xml"'},
    )


@app.post("/api/excavation/export/csv")
async def excavation_export_csv(session_key: str = Form(...)):
    """Download the chainage-range report as CSV."""
    result = _get_cached_excavation_result(session_key)

    buf = _io.StringIO()
    writer = _csv.writer(buf)
    writer.writerow(["side", "chainage_start", "chainage_end", "max_variation_mm", "avg_variation_mm", "station_count"])
    for r in result.ranges:
        d = r.to_dict()
        writer.writerow([d["side"], d["chainage_start"], d["chainage_end"],
                          d["max_variation_mm"], d["avg_variation_mm"], d["station_count"]])
    csv_bytes = buf.getvalue().encode("utf-8")

    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="excavation_report.csv"'},
    )
