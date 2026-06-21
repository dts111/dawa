CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Road network edges table (pgRouting-ready)
CREATE TABLE IF NOT EXISTS road_network (
    id BIGSERIAL PRIMARY KEY,
    osm_id BIGINT,
    source INTEGER,
    target INTEGER,
    cost FLOAT NOT NULL DEFAULT -1,          -- forward travel time minutes (-1 = blocked)
    reverse_cost FLOAT NOT NULL DEFAULT -1,  -- backward travel time (-1 = one-way)
    length_m FLOAT,
    name TEXT,
    road_type TEXT,           -- motorway|trunk|primary|secondary|tertiary|unclassified
    speed_limit INTEGER DEFAULT 60,
    hierarchy_rank INTEGER DEFAULT 5,        -- 1=motorway 2=trunk 3=primary 4=secondary 5=other
    hgv_suitable BOOLEAN DEFAULT TRUE,
    max_height_m FLOAT,
    max_weight_t FLOAT,
    max_width_m FLOAT,
    local_authority TEXT,
    emergency_region TEXT,
    geom GEOMETRY(LINESTRING, 4326)
);

CREATE INDEX IF NOT EXISTS road_network_geom_idx ON road_network USING GIST (geom);
CREATE INDEX IF NOT EXISTS road_network_source_idx ON road_network (source);
CREATE INDEX IF NOT EXISTS road_network_target_idx ON road_network (target);

-- Closure definitions
CREATE TABLE IF NOT EXISTS closures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    closure_type TEXT NOT NULL,   -- mainline|slip_entry|slip_exit|interchange
    direction TEXT DEFAULT 'N/A', -- CW|ACW|N/A
    start_node INTEGER,
    end_node INTEGER,
    start_chainage TEXT,
    end_chainage TEXT,
    start_junction TEXT,
    end_junction TEXT,
    date_from TIMESTAMPTZ,
    date_to TIMESTAMPTZ,
    reason TEXT,
    geom GEOMETRY(LINESTRING, 4326),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS closures_geom_idx ON closures USING GIST (geom);

-- Generated diversion routes
CREATE TABLE IF NOT EXISTS diversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    closure_id UUID REFERENCES closures(id) ON DELETE CASCADE,
    route_rank INTEGER NOT NULL,          -- 1=primary 2=alt1 3=alt2
    distance_m FLOAT,
    travel_time_min FLOAT,
    entry_node INTEGER,
    exit_node INTEGER,
    score INTEGER,                        -- 0-100 overall score
    score_breakdown JSONB DEFAULT '{}',
    route_attributes JSONB DEFAULT '{}',
    path_nodes INTEGER[],
    path_edges INTEGER[],
    geom GEOMETRY(LINESTRING, 4326),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diversions_closure_idx ON diversions (closure_id);
CREATE INDEX IF NOT EXISTS diversions_geom_idx ON diversions USING GIST (geom);

-- Approved diversion library with version history
CREATE TABLE IF NOT EXISTS diversion_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    closure_id UUID REFERENCES closures(id),
    diversion_id UUID REFERENCES diversions(id),
    approval_status TEXT DEFAULT 'draft',  -- draft|approved|rejected
    stakeholder_feedback JSONB DEFAULT '[]',
    version INTEGER DEFAULT 1,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Stakeholder regions (loaded by seed_stakeholders.py)
CREATE TABLE IF NOT EXISTS stakeholder_regions (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,  -- local_authority|police|ambulance|fire|national_highways
    geom GEOMETRY(MULTIPOLYGON, 4326),
    contact_email TEXT,
    contact_name TEXT
);

CREATE INDEX IF NOT EXISTS stakeholder_regions_geom_idx ON stakeholder_regions USING GIST (geom);
