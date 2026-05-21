import asyncio
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException

load_dotenv(Path(__file__).parent / ".env")

from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from routing import get_direct_route, get_diversion_routes
from stakeholders import identify_stakeholders
from m25_junctions import get_closure_info

app = FastAPI(title="M25 Diversion Planner API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RouteRequest(BaseModel):
    start: list[float]                              # [lat, lon] — works start location
    end: list[float]                                # [lat, lon] — works end location
    direction: Literal["clockwise", "anticlockwise"] = "clockwise"


class StakeholderRequest(BaseModel):
    coordinates: list[list[float]]                  # [[lon, lat], ...]


class DrawRouteRequest(BaseModel):
    a: list[float]   # [lat, lon] — route start (A pin)
    b: list[float]   # [lat, lon] — route end (B pin)
    closure: dict    # GeoJSON LineString {"type":"LineString","coordinates":[[lon,lat],...]}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/check-ors")
async def check_ors():
    """Diagnostic: ping ORS with a simple London→Reading request to verify the API key."""
    import httpx
    key = os.getenv("ORS_API_KEY", "")
    if not key:
        return {"ok": False, "reason": "ORS_API_KEY not set in .env"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
                json={"coordinates": [[-0.1278, 51.5074], [-1.0873, 51.4554]]},
                headers={"Authorization": key, "Content-Type": "application/json"},
            )
        if resp.status_code == 200:
            return {"ok": True, "status": 200}
        return {"ok": False, "status": resp.status_code, "body": resp.text[:500]}
    except Exception as e:
        return {"ok": False, "reason": str(e)}


@app.post("/api/route")
async def calculate_route(req: RouteRequest):
    if not os.getenv("ORS_API_KEY"):
        raise HTTPException(status_code=500, detail="ORS_API_KEY not set in .env")

    info = get_closure_info(
        req.start[0], req.start[1],
        req.end[0],   req.end[1],
        req.direction,
    )
    exit_jct        = info["exit_jct"]
    entry_jct       = info["entry_jct"]
    diversion_start = info["diversion_start"]
    diversion_end   = info["diversion_end"]
    closure         = info["closure"]
    closure_path    = [[c[1], c[0]] for c in closure["coordinates"]]

    try:
        direct, alternatives = await asyncio.gather(
            get_direct_route(diversion_start, diversion_end),
            get_diversion_routes(diversion_start, diversion_end, closure_path),
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not alternatives:
        raise HTTPException(
            status_code=404,
            detail="No diversion route found. The junctions may be too close — try placing markers further apart.",
        )

    # Anchor every diversion route to the exact closure start/end junction coords
    exit_coord  = [exit_jct["lon"], exit_jct["lat"]]   # GeoJSON is [lon, lat]
    entry_coord = [entry_jct["lon"], entry_jct["lat"]]
    for alt in alternatives:
        coords = alt["geometry"]["coordinates"]
        if coords and coords[0] != exit_coord:
            coords.insert(0, exit_coord)
        if coords and coords[-1] != entry_coord:
            coords.append(entry_coord)

    return {
        "direct": direct,
        "alternatives": alternatives,
        "closure": closure,
        "exit_junction":  exit_jct,
        "entry_junction": entry_jct,
        "direction": req.direction,
    }


@app.post("/api/closure")
async def get_closure(req: RouteRequest):
    info = get_closure_info(
        req.start[0], req.start[1],
        req.end[0],   req.end[1],
        req.direction,
    )
    return {
        "closure":        info["closure"],
        "exit_junction":  info["exit_jct"],
        "entry_junction": info["entry_jct"],
    }


@app.post("/api/route-draw")
async def calculate_draw_route(req: DrawRouteRequest):
    if not os.getenv("ORS_API_KEY"):
        raise HTTPException(status_code=500, detail="ORS_API_KEY not set in .env")

    # GeoJSON coords are [lon, lat]; convert to [lat, lon] for routing helpers
    closure_path = [[c[1], c[0]] for c in req.closure.get("coordinates", [])]

    try:
        alternatives = await get_diversion_routes(req.a, req.b, closure_path)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not alternatives:
        raise HTTPException(
            status_code=404,
            detail="No diversion route found. Try moving A/B pins further from the closure line.",
        )

    return {"alternatives": alternatives, "closure": req.closure}


@app.post("/api/stakeholders")
async def get_stakeholders(req: StakeholderRequest):
    try:
        result = await identify_stakeholders(req.coordinates)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return result
