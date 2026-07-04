---
name: test-route
description: Diagnose why a Diversion Planner closure does or doesn't produce a diversion route — checks node degree, junction anchor resolution, and whether an alternative path exists on the strategic road network. Use when route generation returns a 422 "No routes found" error, or to sanity-check a closure before generating.
---

# Test Route — closure routing diagnostics

Diagnoses closure routing failures (422 "No routes found" from `POST /api/routes/generate`) by walking through the same anchor-resolution logic the app uses, one step at a time, so you can see exactly where and why it fails instead of guessing from the generic error message.

Backed by `backend/scripts/test_route.py`, which imports the real functions from `services/routing_engine.py` and `services/routing_pgr.py` — it always reflects current production routing behavior, not a frozen copy.

## When to use

- A closure's "Generate Diversion" button returns a 422 error.
- Before generating routes for a closure near a slip road / interchange, to check whether the picked start/end nodes will resolve to a real junction.
- Verifying a routing-engine change hasn't broken a previously-working closure (regression check).

## How to run

From the project root (`Diversion_Planner/`), with the Docker stack up:

```bash
# By closure id (looks up start_node/end_node from the closures table)
docker compose exec backend python scripts/test_route.py --closure <closure_id>

# By raw node ids
docker compose exec backend python scripts/test_route.py <start_node> <end_node> [car|hgv]
```

## Reading the output

1. **`degree=N`** for each node — how many road segments physically meet there. `degree=2` means it's just a pass-through point on a single link chain (e.g. a slip road micro-segment), not a real junction — even if it's tagged `motorway_link`.
2. **`is start/end already a resolved junction?`** — `True` only if degree ≥ 3 *and* the node touches a slip/impacted road type. If `False`, the app walks outward to find the nearest real junction.
3. **`resolved anchors`** — the actual node ids routing will use, after any outward walk. If these differ a lot from the picked start/end, the picked points were on a slip/link, not the mainline.
4. **`excluded closure edges`** — the edge count of the closed section between the resolved anchors.
5. **`✓/✗ alternative route exists`** — if `✗`, there is genuinely no other path on the strategic network (motorway/trunk/primary + links only) between the resolved anchors — a real dead end for this closure, not a bug. If this is unexpected, it usually means the picked points need to be moved further from the closure, or the OSM import is missing a road that should connect there.
6. Final section runs the actual `generate_routes_pgr()` used by the app, so you see the same route count/geometry the API would return.

## Background

Originally written to diagnose a specific bug: closures picked exactly on a slip-road/interchange loop (all `motorway_link`, degree-2 nodes) were wrongly treated as "already resolved junctions" by `_node_has_impacted_road()`, and `_find_outward_junction()` couldn't walk past them because it only followed edges tagged strictly `motorway`. Both were fixed to use node degree (≥3 = real branch) instead of road-type labels, and to let the walk traverse `motorway_link` too. This script is the reusable version of the manual diagnosis used to find and validate that fix.
