# Diversion Planner — Algorithm Reference

## 1. Closure Red Line — Complete Pipeline

**Status:** ✅ Confirmed working

**Files involved:**
- `frontend/src/components/MapView.tsx` — map click, marker placement
- `frontend/src/App.tsx` — state, API orchestration
- `backend/routers/network.py` — `preview_closure_line`, `_node_has_impacted_road`, `_find_outward_junction`

### Purpose
Draw a red dashed line on the map showing the full extent of the closed section — from the user's click point, routed along the motorway, extended outward to the nearest junction approach at both ends.

### End-to-end flow

```
User clicks on map
       ↓
MapView fires e.lngLat [lng, lat]
       ↓
App.tsx handleMapClick
  → findNearestNode(lng, lat)          ← API: GET /api/closures/nearest-node/find
  → stores { node_id, lng: clickLng, lat: clickLat }
  → marker placed at EXACT click position (not node position)
       ↓
Both start + end nodes picked?
  → previewClosureLine(start_node, end_node)   ← API: GET /api/network/preview-closure
  → getImpactedRoads(start_node, end_node)     ← API: GET /api/network/impacted-roads
       ↓
previewLine (GeoJSON LineString) stored in App state
       ↓
MapView renders red dashed line on 'preview-closure' source
```

### Node snapping — `GET /api/closures/nearest-node/find`
Searches all `source` and `target` node endpoints in `road_network WHERE cost > 0`. Returns the node closest (in Web Mercator metres) to the click. The click coordinates (not the node coordinates) are stored as the visual marker position, so the marker appears exactly where the user clicked.

### Path computation — `GET /api/network/preview-closure`
`pgr_dijkstra('SELECT id, source, target, cost, reverse_cost FROM road_network WHERE cost > 0', start_node, end_node, directed := true)` finds the shortest directed path. The geometries of all edges on the path are merged with `ST_LineMerge(ST_Collect(geom))` into a single LineString. If the result is a MultiLineString (disconnected segments), coordinates are flattened into a single list.

### Extension algorithm — see Section 2 below for full detail
Each endpoint is checked and potentially extended outward to the nearest junction node. The final endpoint is then offset 15 m back from that junction node toward the closure body (`_offset_toward`), leaving a gap before the slip road branch point. The extended LineString is returned as GeoJSON.

### Impacted roads — `GET /api/network/impacted-roads`
Runs simultaneously with preview-closure. Finds all edges adjacent to any node on the closure path that are NOT on the closure path itself, filtered to `motorway_link`, `trunk_link`, `trunk`, `primary`, `primary_link`. These are the slip roads and circulatories shown as orange dashed lines and listed in the Impacted Roads checklist.

### Map rendering
The previewLine is fed into a MapLibre GeoJSON source (`preview-closure`). Two layers render it:
- `preview-casing` — white background, 8 px width, 0.8 opacity
- `preview-line` — red (`#ef4444`), 4 px, dashed `[6, 3]`

Start marker: green "▶ Start" badge at click position.
End marker: red "■ End" badge at click position.

### On Generate Diversion
`previewLine` is passed as `geom_geojson` to `POST /api/closures` → stored as WKT geometry in the database. The red line switches from dashed preview to solid (`closure-line`, 10 px red, no dash) once the closure is saved.

---

## 2. Closure Line Extension (Detail)

**Status:** ✅ Confirmed working

**File:** `backend/routers/network.py` — `preview_closure_line` endpoint, `_find_outward_junction`, `_node_has_impacted_road`

### Purpose
When the user picks two nodes on the M25, the red closure line is drawn between them. It is then automatically extended outward at both ends so the line reaches the nearest motorway junction approach on each side — making the full closed section visible.

### Step-by-step

#### Step 1 — Route between picked nodes
`pgr_dijkstra` finds the shortest directed path between `start_node` and `end_node` through the road network (`cost > 0` edges only). The geometry of all edges on that path is merged into a single LineString.

#### Step 2 — Check if endpoint is already at a junction
`_node_has_impacted_road(conn, node_id)` runs:
```sql
SELECT 1 FROM road_network
WHERE (source = $1 OR target = $1)
  AND road_type IN ('motorway_link', 'trunk_link', 'trunk', 'primary', 'primary_link')
  AND cost > 0
LIMIT 1
```
If a row is found → the node already connects to a slip road or impacted road → **it is the junction node** → no extension needed.

#### Step 3 — Directed graph walk (if extension needed)
`_find_outward_junction(conn, node_id, forward, max_hops=60)` walks along `road_type = 'motorway'` directed edges, staying on the same physical carriageway:

| Parameter | Direction | Walk logic | Purpose |
|-----------|-----------|------------|---------|
| `forward=False` | Backward | `rn.target = current` → hop to `rn.source` | Find approach junction BEFORE start_node |
| `forward=True` | Forward | `rn.source = current` → hop to `rn.target` | Find departure junction AFTER end_node |

Uses a PostgreSQL recursive CTE (`WITH RECURSIVE walk`). Only `road_type = 'motorway'` edges are followed — the walk physically cannot cross to the opposing carriageway.

#### Step 4 — Stop condition
The walk terminates at the **first node** encountered that has an adjacent edge of type `motorway_link`, `trunk_link`, `trunk`, `primary`, or `primary_link`. This is the junction approach node where the slip road branches off.

#### Step 5 — 15 m inset offset
The junction node coordinate is NOT used directly. Instead, `_offset_toward(junc, coords[0/−1], 15)` moves the endpoint 15 m back from the junction node toward the closure body:

```python
def _offset_toward(from_pt: list, toward_pt: list, distance_m: float) -> list:
    lng1, lat1 = from_pt
    lng2, lat2 = toward_pt
    cos_lat = math.cos(math.radians((lat1 + lat2) / 2))
    dx = (lng2 - lng1) * cos_lat * 111_000   # metres E-W
    dy = (lat2 - lat1) * 111_000             # metres N-S
    dist = math.hypot(dx, dy)
    if dist < 0.1:
        return from_pt                        # points are coincident
    ux, uy = dx / dist, dy / dist            # unit vector toward toward_pt
    return [
        lng1 + (ux * distance_m) / (cos_lat * 111_000),
        lat1 + (uy * distance_m) / 111_000,
    ]
```

The result is a point 15 m inside the junction, leaving a visible gap between the red line endpoint and the physical slip-road branch point.

#### Step 6 — Prepend / append
- Offset start coordinate → **prepended** to the coordinate array
- Offset end coordinate → **appended** to the coordinate array

The result is stored as `previewLine` in the frontend and sent to the backend as `geom_geojson` when the closure is saved.

### Key constraint
The directed walk only follows motorway edges in their traffic direction. This ensures the extension stays on the **same carriageway** as the picked nodes (CW stays CW, ACW stays ACW) — critical for dual-carriageway networks where CW and ACW junction nodes are only ~15–30 m apart.

---

## 3. Primary Diversion Routing (Green Line)

**File:** `backend/services/routing_engine.py` — `generate_routes`, `_node_has_impacted_road`, `_find_outward_junction`

### Purpose
Generate the green diversion route that traffic should follow when the closure is active. The route starts at the motorway junction node at the closure start and ends at the junction node at the closure end — ORS then naturally exits/enters via the slip road (motorway_link), including the slip road segment in the green line.

### Anchor resolution

`generate_routes` receives `source_node` and `target_node` (originally picked motorway nodes). It uses `_node_has_impacted_road` and `_find_outward_junction` — identical to the functions in `routers/network.py`, duplicated here to avoid a circular import — to find the exact junction node at each closure end:

```python
ors_start: list = list(start)
ors_end:   list = list(end)

if await _node_has_impacted_road(conn, source_node):
    ors_start = list(start)               # already at a junction
else:
    j = await _find_outward_junction(conn, source_node, forward=False)
    if j:
        ors_start = [j[1], j[2]]          # j = (node_id, lng, lat)

if await _node_has_impacted_road(conn, target_node):
    ors_end = list(end)
else:
    j = await _find_outward_junction(conn, target_node, forward=True)
    if j:
        ors_end = [j[1], j[2]]
```

This is the **same junction-finding logic** as the red line extension in `routers/network.py` — both the red line termination points and the ORS anchors are derived from the same directed graph walk, so they are always consistent.

### Why junction node — not the A-road slip end

ORS `avoid_features: ["highways"]` maps to `highway=motorway` (motorway mainline edges) only. It does **not** block `highway=motorway_link` (slip roads). Placing the ORS anchor at the junction node means:

- The only non-motorway exit available to ORS is the slip road (motorway_link)
- ORS is forced through the slip road → then routes via A-roads → returns via entry slip
- The green line includes the complete slip road segment
- Purple ORS markers sit at the junction node — visually aligned with the red line termination

### Build avoidance polygon
`_avoid_polygon(closure_geojson, buffer_m=50)` buffers the closure LineString into a polygon that ORS will avoid. A latitude-corrected buffer (at ~51°N a naive degree buffer is ~30% too narrow E-W) ensures the polygon covers the full dual carriageway width.

### Call OpenRouteService
ORS is called with:
- `coordinates`: `[ors_start, ors_end]` — the motorway junction node coordinates
- `options.avoid_features`: `["highways"]` — blocks motorway mainline; slip roads remain open
- `options.avoid_polygons`: the closure avoidance polygon (belt-and-braces)
- `alternative_routes`: up to 3 alternatives (share_factor 0.6, weight_factor 1.6)
- Profile: `driving-hgv` or `driving-car` depending on vehicle type

### Parse and return
Routes are ranked 1–3 (green, blue, yellow on the map). Each route carries:
- `travel_time_min`, `distance_m`
- `geojson` — the route geometry (includes slip roads at each end)
- `route_attributes.ors_origin` / `ors_destination` — the junction node coordinates (purple ORS markers)
- `route_attributes.named_roads` — road names from ORS step instructions

---

## Summary of Key Design Decisions

| Decision | Reason |
|----------|--------|
| Directed graph walk for red line extension | Spatial buffer search picked the wrong carriageway (CW/ACW junction nodes are ~15–30 m apart) |
| `_node_has_impacted_road` gate | Prevents double-extension when the picked node is already the junction node |
| 15 m inset before junction node | Red line should stop just short of the physical slip road branch point, not land exactly on it |
| Marker placed at click position, not node | Node can be 50–200 m from the click; user expects the marker where they clicked |
| Junction node as ORS anchor (not A-road slip end) | `avoid_features:["highways"]` blocks only motorway mainline — slip roads (motorway_link) remain open, so ORS exits/enters via the slip road naturally. The green line includes the slip road segment and purple markers align with the red line termination. |
| `_node_has_impacted_road`/`_find_outward_junction` duplicated in routing_engine | Copying avoids a services→routers circular import; SQL is identical |
| `avoid_features: ["highways"]` on all ORS calls | Forces the entire diversion route onto surface roads regardless of anchor position |
| 50 m avoidance buffer with lat correction | Covers the full M25 dual carriageway; uncorrected buffer was ~30% too narrow E-W at 51°N |
| Auto-hide network layers on Generate | Reduces clutter when diversion routes appear — junction markers kept visible for orientation |
