from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, Boolean, Text, DateTime, ForeignKey, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from geoalchemy2 import Geometry
from database import Base
import uuid


class RoadNetwork(Base):
    __tablename__ = "road_network"

    id = Column(Integer, primary_key=True, autoincrement=True)
    osm_id = Column(Integer)
    source = Column(Integer)
    target = Column(Integer)
    cost = Column(Float, nullable=False, default=-1)
    reverse_cost = Column(Float, nullable=False, default=-1)
    length_m = Column(Float)
    name = Column(Text)
    road_type = Column(Text)
    speed_limit = Column(Integer, default=60)
    hierarchy_rank = Column(Integer, default=5)
    hgv_suitable = Column(Boolean, default=True)
    max_height_m = Column(Float)
    max_weight_t = Column(Float)
    max_width_m = Column(Float)
    local_authority = Column(Text)
    emergency_region = Column(Text)
    geom = Column(Geometry("LINESTRING", srid=4326))


class Closure(Base):
    __tablename__ = "closures"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    closure_type = Column(Text, nullable=False)
    direction = Column(Text, default="N/A")
    start_node = Column(Integer)
    end_node = Column(Integer)
    start_chainage = Column(Text)
    end_chainage = Column(Text)
    start_junction = Column(Text)
    end_junction = Column(Text)
    date_from = Column(DateTime(timezone=True))
    date_to = Column(DateTime(timezone=True))
    reason = Column(Text)
    geom = Column(Geometry("LINESTRING", srid=4326))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class Diversion(Base):
    __tablename__ = "diversions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    closure_id = Column(UUID(as_uuid=True), ForeignKey("closures.id", ondelete="CASCADE"))
    route_rank = Column(Integer, nullable=False)
    distance_m = Column(Float)
    travel_time_min = Column(Float)
    entry_node = Column(Integer)
    exit_node = Column(Integer)
    score = Column(Integer)
    score_breakdown = Column(JSONB, default={})
    route_attributes = Column(JSONB, default={})
    path_nodes = Column(ARRAY(Integer))
    path_edges = Column(ARRAY(Integer))
    geom = Column(Geometry("LINESTRING", srid=4326))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class DiversionLibrary(Base):
    __tablename__ = "diversion_library"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    closure_id = Column(UUID(as_uuid=True), ForeignKey("closures.id"))
    diversion_id = Column(UUID(as_uuid=True), ForeignKey("diversions.id"))
    approval_status = Column(Text, default="draft")
    stakeholder_feedback = Column(JSONB, default=[])
    version = Column(Integer, default=1)
    approved_by = Column(Text)
    approved_at = Column(DateTime(timezone=True))
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class StakeholderRegion(Base):
    __tablename__ = "stakeholder_regions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    category = Column(Text, nullable=False)
    geom = Column(Geometry("MULTIPOLYGON", srid=4326))
    contact_email = Column(Text)
    contact_name = Column(Text)
