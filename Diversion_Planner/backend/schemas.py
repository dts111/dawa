from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, ConfigDict, Field
import uuid


class ClosureCreate(BaseModel):
    closure_type: str  # mainline|slip_entry|slip_exit|interchange
    direction: str = "N/A"  # CW|ACW|N/A
    start_node: Optional[int] = None
    end_node: Optional[int] = None
    start_chainage: Optional[str] = None
    end_chainage: Optional[str] = None
    start_junction: Optional[str] = None
    end_junction: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    reason: Optional[str] = None
    # GeoJSON LineString geometry of the closed section
    geom_geojson: Optional[dict] = None


class ClosureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    closure_type: str
    direction: str
    start_node: Optional[int]
    end_node: Optional[int]
    start_chainage: Optional[str]
    end_chainage: Optional[str]
    start_junction: Optional[str]
    end_junction: Optional[str]
    date_from: Optional[datetime]
    date_to: Optional[datetime]
    reason: Optional[str]
    created_at: datetime
    geom_geojson: Optional[dict] = None


class ScoreBreakdown(BaseModel):
    distance_efficiency: float
    travel_time_impact: float
    hgv_suitability: float
    emergency_access: float
    local_authority_impact: float
    network_resilience: float


class DiversionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    closure_id: uuid.UUID
    route_rank: int
    distance_m: Optional[float]
    travel_time_min: Optional[float]
    entry_node: Optional[int]
    exit_node: Optional[int]
    score: Optional[int]
    score_breakdown: Optional[dict]
    route_attributes: Optional[dict] = None
    geom_geojson: Optional[dict] = None
    created_at: datetime


class RouteGenerateRequest(BaseModel):
    closure_id: uuid.UUID
    vehicle_type: str = "car"  # car|hgv
    n_alternatives: int = Field(3, ge=1, le=3)
    engine: str = "ors"  # ors (OpenRouteService) | pgr (pgRouting on DBFO network)


class LibraryEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    closure_id: Optional[uuid.UUID]
    diversion_id: Optional[uuid.UUID]
    approval_status: str
    stakeholder_feedback: Optional[list]
    version: int
    approved_by: Optional[str]
    approved_at: Optional[datetime]
    notes: Optional[str]
    created_at: datetime


class LibraryApproveRequest(BaseModel):
    approved_by: str
    notes: Optional[str] = None


class StakeholderResponse(BaseModel):
    id: int
    name: str
    category: str
    contact_email: Optional[str]
    contact_name: Optional[str]


class NearestNodeResponse(BaseModel):
    node_id: int
    lng: float
    lat: float
    distance_m: float
    road_name: Optional[str] = None
    road_type: Optional[str] = None
    is_junction: bool = False
