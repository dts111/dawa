# Diversion Planner — Session Changes

## Closure Panel UI

- Removed node ID display from pick buttons
- Buttons now permanently labelled **"Start of closure"** and **"End of closure"** with a ✓ tick when picked
- No node IDs shown anywhere in the UI

---

## Backend: `backend/routers/network.py`

### New endpoint — `GET /network/node/{node_id}`
Returns coordinates for a given road network node ID.

### New helper — `_node_has_impacted_road(conn, node_id)`
Checks whether a node already connects to a slip road or impacted road type
(`motorway_link`, `trunk_link`, `trunk`, `primary`, `primary_link`).
Used to skip extension when the picked node is already at a junction.

### Replaced `_find_junction_node` with `_find_outward_junction(conn, node_id, forward)`
**Root cause of old bug:** spatial buffer search found the nearest junction node by distance,
regardless of carriageway — CW and ACW junction nodes at the same interchange are only ~15–30 m
apart, so the wrong carriageway was frequently returned.

**Fix:** directed graph walk along motorway edges only:
- `forward=False` — walks backward (`target → source`) from `start_node` to find approach junction
- `forward=True` — walks forward (`source → target`) from `end_node` to find departure junction

Since only `road_type = 'motorway'` directed edges are followed, the walk stays on the same
carriageway and cannot cross to the opposing carriageway.

### Extension logic in `preview_closure_line`
- Extension only fires when `_node_has_impacted_road` returns `False` (node is mid-section)
- If the picked node is already at a junction (e.g. nodes 21661, 20073), no extension is added

---

## Backend: `backend/services/routing_engine.py`

### ORS anchor fix — `generate_routes`
**Old behaviour:** called `_find_impacted_road_anchor` from the closure geometry endpoints,
which returned the furthest endpoint of the nearest slip road — often pointing back INTO the
closure, displacing the ORS start/end markers.

**Fix:** use closure geometry's first and last coordinates directly as ORS anchors
(`geom_coords[0]` = `junc_start`, `geom_coords[-1]` = `junc_end`).
These are already the correct outward junction points set by `preview_closure_line`.

---

## Frontend: `frontend/src/components/MapView.tsx`

### Start/End markers snap to preview line endpoints
Previously the markers were placed at the originally-clicked node coordinates
(`pickedStart.lng/lat`), which floated in the middle of the red dashed closure line once the
line extended to the outward junctions.

**Fix:** when `previewLine` is available, markers are placed at:
- `previewLine.coordinates[0]` for the **▶ Start** marker
- `previewLine.coordinates[coordinates.length - 1]` for the **■ End** marker

Both marker `useEffect` hooks now include `previewLine` in their dependency arrays.

---

## Verified with saved test nodes

| Node  | Coords                      | Role                          |
|-------|-----------------------------|-------------------------------|
| 21661 | (-0.5076, 51.3713)          | Start — already at J11 junction (motorway_link 20221 adjacent) |
| 20073 | (-0.5126, 51.3798)          | End — already at J11 junction (motorway_link 41202 adjacent)   |

`/network/preview-closure?start_node=21661&end_node=20073` returns 14 coords,
first = node 21661, last = node 20073 — no spurious extension at either end. ✓
