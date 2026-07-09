"""
Geometry Utilities
Generic computational geometry helpers with no excavation-specific knowledge:
a uniform-grid spatial index over triangle faces, true 3D nearest-point-on-mesh
queries, mesh boundary-loop extraction, boundary-polygon clipping, and a 2D
convex hull (for the breakline envelope). No scipy / KD-tree dependency,
matching the rest of the app (volume_calculator.py uses matplotlib.tri; this
module also uses matplotlib.path for polygon containment).
"""

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import numpy as np
from matplotlib.path import Path as MplPath

from landxml_parser import Breakline, TINSurface


@dataclass
class FaceGridIndex:
    surface: TINSurface
    cell_size: float
    x_min: float
    y_min: float
    grid: Dict[Tuple[int, int], List[int]] = field(default_factory=dict)


def build_face_grid_index(surface: TINSurface, target_cells_per_axis: int = 60) -> FaceGridIndex:
    """
    Build a uniform-grid bucket index over a surface's triangle faces, keyed by
    each face's planar (x,y) bounding-box footprint. Cell size scales with the
    surface's extent (same span-based sizing pattern as volume_calculator.py's
    _auto_resolution). Build once per surface per run — queries are cheap,
    construction is O(faces).
    """
    x_span = surface.x_max - surface.x_min
    y_span = surface.y_max - surface.y_min
    span = max(x_span, y_span)
    cell_size = max(span / target_cells_per_axis, 1e-6) if span > 0 else 1.0

    index = FaceGridIndex(surface=surface, cell_size=cell_size, x_min=surface.x_min, y_min=surface.y_min)

    pts = surface.points
    for face_idx, face in enumerate(surface.faces):
        a, b, c = int(face[0]), int(face[1]), int(face[2])
        xs = pts[[a, b, c], 0]
        ys = pts[[a, b, c], 1]
        gi0 = int((xs.min() - index.x_min) // cell_size)
        gi1 = int((xs.max() - index.x_min) // cell_size)
        gj0 = int((ys.min() - index.y_min) // cell_size)
        gj1 = int((ys.max() - index.y_min) // cell_size)
        for gi in range(gi0, gi1 + 1):
            for gj in range(gj0, gj1 + 1):
                index.grid.setdefault((gi, gj), []).append(face_idx)

    return index


def _closest_point_on_triangle(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """
    Closest point on triangle (a,b,c) to point p, in 3D.
    Ericson, "Real-Time Collision Detection", section 5.1.5 (region-test method).
    """
    ab = b - a
    ac = c - a
    ap = p - a

    d1 = np.dot(ab, ap)
    d2 = np.dot(ac, ap)
    if d1 <= 0.0 and d2 <= 0.0:
        return a.copy()

    bp = p - b
    d3 = np.dot(ab, bp)
    d4 = np.dot(ac, bp)
    if d3 >= 0.0 and d4 <= d3:
        return b.copy()

    vc = d1 * d4 - d3 * d2
    if vc <= 0.0 and d1 >= 0.0 and d3 <= 0.0:
        v = d1 / (d1 - d3)
        return a + v * ab

    cp = p - c
    d5 = np.dot(ab, cp)
    d6 = np.dot(ac, cp)
    if d6 >= 0.0 and d5 <= d6:
        return c.copy()

    vb = d5 * d2 - d1 * d6
    if vb <= 0.0 and d2 >= 0.0 and d6 <= 0.0:
        w = d2 / (d2 - d6)
        return a + w * ac

    va = d3 * d6 - d5 * d4
    if va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        return b + w * (c - b)

    denom = 1.0 / (va + vb + vc)
    v = vb * denom
    w = vc * denom
    return a + ab * v + ac * w


def _ring_cells(gi0: int, gj0: int, ring: int) -> List[Tuple[int, int]]:
    """Cells forming the square ring at Chebyshev distance `ring` from (gi0,gj0). ring=0 -> just the home cell."""
    if ring == 0:
        return [(gi0, gj0)]
    cells = []
    for di in range(-ring, ring + 1):
        cells.append((gi0 + di, gj0 - ring))
        cells.append((gi0 + di, gj0 + ring))
    for dj in range(-ring + 1, ring):
        cells.append((gi0 - ring, gj0 + dj))
        cells.append((gi0 + ring, gj0 + dj))
    return cells


def nearest_point_on_surface(index: FaceGridIndex, point: np.ndarray) -> Tuple[np.ndarray, float]:
    """
    True 3D nearest point on a triangulated surface to an arbitrary 3D point,
    via expanding-ring search over the grid index.

    Termination is correctness-guaranteed, not a heuristic cutoff: after fully
    processing ring r, every point outside the (2r+1)x(2r+1) cell block is at
    least r*cell_size away from the query point (since the query point lies
    somewhere inside its home cell, at most cell_size from that cell's edge in
    every direction). So once best_dist < r*cell_size, no further ring can hold
    a closer point.
    """
    surface = index.surface
    pts = surface.points
    cs = index.cell_size

    gi0 = int((point[0] - index.x_min) // cs)
    gj0 = int((point[1] - index.y_min) // cs)

    # Generous, correctness-oriented upper bound on rings needed: distance from
    # the query point to the surface's bbox centre, plus half the bbox diagonal.
    diag = float(np.hypot(surface.x_max - surface.x_min, surface.y_max - surface.y_min))
    cx, cy = (surface.x_min + surface.x_max) / 2, (surface.y_min + surface.y_max) / 2
    dist_to_centre = float(np.hypot(point[0] - cx, point[1] - cy))
    max_ring = int((diag / 2 + dist_to_centre) / cs) + 3

    best_point = None
    best_dist = float("inf")
    seen_faces = set()

    ring = 0
    while ring <= max_ring:
        for cell in _ring_cells(gi0, gj0, ring):
            face_ids = index.grid.get(cell)
            if not face_ids:
                continue
            for fidx in face_ids:
                if fidx in seen_faces:
                    continue
                seen_faces.add(fidx)
                a, b, c = surface.faces[fidx]
                cp = _closest_point_on_triangle(point, pts[a], pts[b], pts[c])
                d = float(np.linalg.norm(cp - point))
                if d < best_dist:
                    best_dist = d
                    best_point = cp

        if best_point is not None and ring * cs > best_dist:
            break
        ring += 1

    if best_point is None:
        raise ValueError("Surface has no faces to search — cannot compute nearest point.")

    return best_point, best_dist


def extract_boundary_loops(points: np.ndarray, faces: np.ndarray) -> List[List[int]]:
    """
    Trace the boundary(ies) of a triangulated mesh as closed loops of point
    indices. An edge belongs to the boundary iff it appears in exactly one
    triangle (interior edges are shared by two, since each interior edge
    borders two triangles in a manifold mesh).

    The largest loop by vertex count is typically the true outer perimeter;
    smaller loops are usually isolated mesh fragments or interior holes — the
    caller decides how to present them.
    """
    edge_count: Dict[Tuple[int, int], int] = defaultdict(int)
    for f in faces:
        for i in range(3):
            a, b = int(f[i]), int(f[(i + 1) % 3])
            edge_count[(a, b) if a < b else (b, a)] += 1

    boundary_edges = [e for e, c in edge_count.items() if c == 1]
    if not boundary_edges:
        return []

    adj: Dict[int, List[int]] = defaultdict(list)
    for a, b in boundary_edges:
        adj[a].append(b)
        adj[b].append(a)

    def edge_key(a: int, b: int) -> Tuple[int, int]:
        return (a, b) if a < b else (b, a)

    visited_edges = set()
    loops: List[List[int]] = []

    for start_a, start_b in boundary_edges:
        if edge_key(start_a, start_b) in visited_edges:
            continue
        loop = [start_a]
        prev, current = start_a, start_b
        visited_edges.add(edge_key(start_a, start_b))
        while current != start_a:
            loop.append(current)
            candidates = [n for n in adj[current] if edge_key(current, n) not in visited_edges]
            if not candidates:
                break   # dead end — non-manifold junction or open boundary; stop cleanly
            # Prefer a neighbour other than where we came from, to avoid backtracking
            # when a vertex happens to have more than 2 boundary-edge connections.
            nxt = next((n for n in candidates if n != prev), candidates[0])
            visited_edges.add(edge_key(current, nxt))
            prev, current = current, nxt
        loops.append(loop)

    return loops


def clip_faces_to_boundary(
    points: np.ndarray, faces: np.ndarray, boundary_loop: List[int],
) -> Tuple[np.ndarray, int]:
    """
    Keep only faces whose planar centroid falls inside the polygon defined by
    boundary_loop (a closed loop of point indices — typically the largest loop
    from extract_boundary_loops, i.e. the main outer perimeter).

    This is a GEOMETRIC clip, not a topological one, and behaves differently
    from a connected-component filter in one specific case: a disconnected
    fragment whose centroid happens to sit geometrically *inside* the main
    boundary's footprint (e.g. a small isolated patch surrounded by, but not
    triangulated into, the main surface) is KEPT here, whereas a pure
    connected-component filter would remove it purely for being a separate
    component. Fragments genuinely outside the main footprint are removed by
    both approaches. (A triangle directly attached to the main mesh via a
    shared edge but pointing far outward is a genuinely ambiguous case for any
    method — extract_boundary_loops naturally traces around such a spike as
    part of the outline itself, so it reads as "inside" its own boundary.)

    Centroid-based containment (rather than requiring all 3 vertices strictly
    inside) avoids edge-case ambiguity for triangles that legitimately touch
    the boundary line itself.

    Returns (kept_faces, removed_count).
    """
    if len(faces) == 0 or len(boundary_loop) < 3:
        return faces, 0

    polygon_xy = points[boundary_loop, :2]
    path = MplPath(polygon_xy)

    centroids_xy = points[faces].mean(axis=1)[:, :2]
    inside = path.contains_points(centroids_xy)
    removed = int((~inside).sum())
    return faces[inside], removed


def _convex_hull_indices(xy: np.ndarray) -> np.ndarray:
    """
    Andrew's monotone chain convex hull. Returns indices into xy forming the
    hull, in counter-clockwise order, starting from the lowest-leftmost point.
    Handles duplicate/collinear points cleanly (the `<= 0` cross-product test
    drops them). len(xy) must be >= 3.
    """
    order = np.lexsort((xy[:, 1], xy[:, 0]))

    def cross(o: int, a: int, b: int) -> float:
        return (xy[a, 0] - xy[o, 0]) * (xy[b, 1] - xy[o, 1]) - (xy[a, 1] - xy[o, 1]) * (xy[b, 0] - xy[o, 0])

    lower: List[int] = []
    for i in order:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], i) <= 0:
            lower.pop()
        lower.append(i)

    upper: List[int] = []
    for i in order[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], i) <= 0:
            upper.pop()
        upper.append(i)

    return np.array(lower[:-1] + upper[:-1], dtype=int)


def breakline_envelope(breaklines: List[Breakline]) -> Optional[np.ndarray]:
    """
    Convex hull (in plan/XY) of every breakline's points combined, returned as
    real (x, y, z) breakline points — the hull is built from actual survey
    points, nothing synthesized. This traces the outer extent of the SOURCE
    DATA that fed the triangulation, which is a different thing from
    extract_boundary_loops (which traces the *triangulation's* outer edge) —
    comparing the two is useful for spotting triangulation that extends beyond
    real survey coverage (e.g. Delaunay "bridge" triangles).

    Returns None if there are no breaklines, or fewer than 3 points total.
    """
    if not breaklines:
        return None
    all_points = np.concatenate([bl.points for bl in breaklines], axis=0)
    if len(all_points) < 3:
        return None
    hull_idx = _convex_hull_indices(all_points[:, :2])
    return all_points[hull_idx]


def chain_breaklines(breaklines: List[Breakline], tol: float = 0.05) -> dict:
    """
    Attempt to join breaklines end-to-end (within `tol` of a shared endpoint) into
    continuous polylines, for use as a precise (non-convex-hull) clip boundary.

    Real LandXML breakline networks are often a mix of feature types (kerblines,
    centrelines, intersections, etc.) that don't necessarily trace one clean
    perimeter — several may run nearly parallel along the same physical feature
    rather than continuing from each other. This is a best-effort stitch, not a
    guess: each breakline connects only at its two extreme endpoints (never
    mid-segment), and endpoints are clustered into junctions by proximity:
      - exactly 2 breakline-ends at a junction -> a clean pass-through, chain
        continues automatically.
      - exactly 1 -> a genuine dead end (gap) — reported, not bridged.
      - 3+ -> an ambiguous branch point — chaining stops in every direction
        there rather than guessing which way to continue; reported.

    Returns {
        "loops": [np.ndarray (P,3), ...],        # closed chains (start == end)
        "open_chains": [np.ndarray (P,3), ...],  # chains that hit a gap/branch
        "gap_points": [np.ndarray (3,), ...],     # one entry per distinct dead end
        "branch_points": [np.ndarray (3,), ...],  # one entry per distinct 3+-way junction
    }
    """
    empty = {"loops": [], "open_chains": [], "gap_points": [], "branch_points": []}
    valid = [bl for bl in breaklines if len(bl.points) >= 2]
    if not valid:
        return empty

    # Each breakline (local index li) contributes two endpoints: 2*li (start), 2*li+1 (end).
    n = len(valid)
    coords_xy = np.zeros((2 * n, 2))
    for li, bl in enumerate(valid):
        coords_xy[2 * li] = bl.points[0][:2]
        coords_xy[2 * li + 1] = bl.points[-1][:2]

    m = 2 * n
    parent = list(range(m))

    def find(x: int) -> int:
        r = x
        while parent[r] != r:
            r = parent[r]
        while parent[x] != r:
            parent[x], x = r, parent[x]
        return r

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for a in range(m):
        for b in range(a + 1, m):
            if np.linalg.norm(coords_xy[a] - coords_xy[b]) <= tol:
                union(a, b)

    cluster_members: Dict[int, List[int]] = defaultdict(list)
    for idx in range(m):
        cluster_members[find(idx)].append(idx)
    cluster_coord = {
        root: coords_xy[np.array(members)].mean(axis=0) for root, members in cluster_members.items()
    }
    end_cluster = [find(idx) for idx in range(m)]

    def bl_of(end_idx: int) -> int:
        return end_idx // 2

    def which_of(end_idx: int) -> int:
        return end_idx % 2   # 0 = start, 1 = end

    used_bl = set()
    loops: List[np.ndarray] = []
    open_chains: List[np.ndarray] = []
    gap_roots = set()
    branch_roots = set()

    for li, bl in enumerate(valid):
        if li in used_bl:
            continue
        used_bl.add(li)

        chain_points = list(bl.points)
        front_end, back_end = 2 * li + 1, 2 * li
        is_loop = False

        cur_end = front_end
        while True:
            root = end_cluster[cur_end]
            members = cluster_members[root]
            if len(members) == 1:
                gap_roots.add(root)
                break
            if len(members) >= 3:
                branch_roots.add(root)
                break
            other = members[0] if members[1] == cur_end else members[1]
            next_li = bl_of(other)
            if next_li == li and other == back_end:
                is_loop = True
                break
            if next_li in used_bl:
                gap_roots.add(root)
                break
            used_bl.add(next_li)
            next_bl = valid[next_li]
            next_which = which_of(other)
            if next_which == 0:
                chain_points.extend(next_bl.points[1:])
                cur_end = 2 * next_li + 1
            else:
                chain_points.extend(next_bl.points[::-1][1:])
                cur_end = 2 * next_li

        if is_loop:
            loops.append(np.array(chain_points))
            continue

        cur_end = back_end
        while True:
            root = end_cluster[cur_end]
            members = cluster_members[root]
            if len(members) == 1:
                gap_roots.add(root)
                break
            if len(members) >= 3:
                branch_roots.add(root)
                break
            other = members[0] if members[1] == cur_end else members[1]
            next_li = bl_of(other)
            if next_li in used_bl:
                gap_roots.add(root)
                break
            used_bl.add(next_li)
            next_bl = valid[next_li]
            next_which = which_of(other)
            if next_which == 1:
                chain_points = list(next_bl.points[:-1]) + chain_points
                cur_end = 2 * next_li
            else:
                chain_points = list(next_bl.points[::-1][:-1]) + chain_points
                cur_end = 2 * next_li + 1

        open_chains.append(np.array(chain_points))

    return {
        "loops": loops,
        "open_chains": open_chains,
        "gap_points": [cluster_coord[r] for r in gap_roots],
        "branch_points": [cluster_coord[r] for r in branch_roots],
    }
