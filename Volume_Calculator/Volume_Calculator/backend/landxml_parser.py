"""
LandXML Parser
Extracts TIN surface data from LandXML files (v1.1 and v1.2).
"""

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import numpy as np
from lxml import etree


# LandXML namespace URIs
LANDXML_NAMESPACES = [
    "http://www.landxml.org/schema/LandXML-1.2",
    "http://www.landxml.org/schema/LandXML-1.1",
    "http://www.landxml.org/schema/LandXML-2.0",
    "",  # no namespace fallback
]


@dataclass
class Breakline:
    """A 3D line feature from a surface's <SourceData><Breaklines> (e.g. kerblines,
    chainage lines, centrelines) — informational source geometry that fed into
    building the TIN, not part of the triangulation itself."""
    desc: str
    brk_type: str
    points: np.ndarray   # shape (N, 3) — columns: X, Y, Z

    def to_dict(self, include_points: bool = True) -> dict:
        d = {
            "desc": self.desc,
            "brk_type": self.brk_type,
            "point_count": len(self.points),
        }
        if include_points:
            d["points"] = self.points.tolist()
        return d


@dataclass
class TINSurface:
    name: str
    desc: str
    points: np.ndarray   # shape (N, 3) — columns: X, Y, Z
    faces: np.ndarray    # shape (M, 3) — zero-based indices into points
    x_min: float = field(init=False)
    x_max: float = field(init=False)
    y_min: float = field(init=False)
    y_max: float = field(init=False)
    z_min: float = field(init=False)
    z_max: float = field(init=False)
    # Diagnostics from the max-edge-length "bridge triangle" filter applied at
    # parse time (see _filter_long_edge_faces) — 0 / None if not applicable
    # (e.g. surfaces built directly in code rather than parsed from a file).
    faces_filtered_count: int = 0
    max_edge_length_used: Optional[float] = None
    # Diagnostics from the "clip to boundary" geometric filter (see
    # geometry_utils.clip_faces_to_boundary) — requires max_edge_length to also
    # be set (see parse_landxml_bytes docstring for why).
    fragment_faces_removed: int = 0
    boundary_filter_applied: bool = False
    # Boundary/hole loops (point-index lists), always extracted at parse time
    # from the FINAL faces (after any edge-length trim / boundary clip above)
    # — see geometry_utils.extract_boundary_loops. Empty for surfaces built
    # directly in code without going through _parse_surfaces.
    boundary_loops: List[List[int]] = field(default_factory=list)
    # Source breaklines parsed from <SourceData>, if present — empty for
    # surfaces built directly in code or files without source breaklines.
    breaklines: List[Breakline] = field(default_factory=list)
    # A suggested Max Triangle Edge value, computed once from the RAW (pre-trim)
    # faces via statistical outlier detection (see suggest_max_edge_length) —
    # always populated regardless of whether max_edge_length was actually passed
    # in. None if there's nothing worth suggesting (no outlier edges found, or
    # too few faces to compute quartiles meaningfully). Purely informational —
    # never applied automatically.
    suggested_max_edge_length: Optional[float] = None
    # Diagnostics from the min-interior-angle "sliver triangle" filter (see
    # _filter_sliver_faces) — 0 / None if not applicable. Independent of the
    # edge-length filter above: catches thin/degenerate triangle SHAPE regardless
    # of edge length.
    sliver_faces_removed: int = 0
    min_angle_used: Optional[float] = None
    # The clamped-but-untrimmed faces, as originally parsed — retained so
    # retrim_surface() can re-apply a different max_edge_length/clip_to_boundary/
    # min_angle_deg later without re-reading the source file. Defaults to `faces`
    # (i.e. "no trim has ever been applied") for surfaces built directly in code
    # without going through _parse_surfaces. Internal only — excluded from to_dict().
    raw_faces: Optional[np.ndarray] = None

    def __post_init__(self):
        if self.raw_faces is None:
            self.raw_faces = self.faces
        self.x_min = float(self.points[:, 0].min())
        self.x_max = float(self.points[:, 0].max())
        self.y_min = float(self.points[:, 1].min())
        self.y_max = float(self.points[:, 1].max())
        self.z_min = float(self.points[:, 2].min())
        self.z_max = float(self.points[:, 2].max())

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "desc": self.desc,
            "point_count": len(self.points),
            "face_count": len(self.faces),
            "x_min": round(self.x_min, 4),
            "x_max": round(self.x_max, 4),
            "y_min": round(self.y_min, 4),
            "y_max": round(self.y_max, 4),
            "z_min": round(self.z_min, 4),
            "z_max": round(self.z_max, 4),
            "faces_filtered_count": self.faces_filtered_count,
            "max_edge_length_used": (
                round(self.max_edge_length_used, 3) if self.max_edge_length_used is not None else None
            ),
            "fragment_faces_removed": self.fragment_faces_removed,
            "boundary_filter_applied": self.boundary_filter_applied,
            "boundary_loop_count": len(self.boundary_loops),
            "boundary_main_loop_points": max((len(loop) for loop in self.boundary_loops), default=0),
            "breakline_count": len(self.breaklines),
            "suggested_max_edge_length": (
                round(self.suggested_max_edge_length, 3) if self.suggested_max_edge_length is not None else None
            ),
            "sliver_faces_removed": self.sliver_faces_removed,
            "min_angle_used": (
                round(self.min_angle_used, 3) if self.min_angle_used is not None else None
            ),
        }


def _detect_namespace(root: etree._Element) -> Optional[str]:
    """Detect the LandXML namespace from the root element."""
    tag = root.tag
    m = re.match(r'\{(.+?)\}', tag)
    if m:
        return m.group(1)
    return ""


def _ns(tag: str, namespace: str) -> str:
    """Wrap tag with namespace."""
    if namespace:
        return f"{{{namespace}}}{tag}"
    return tag


def _parse_point_text(text: str) -> Tuple[float, float, float]:
    """
    Parse a LandXML <P> text node.
    LandXML spec: northing easting elevation (Y X Z).
    Returns (X, Y, Z).
    """
    parts = text.strip().split()
    if len(parts) < 3:
        raise ValueError(f"Point has fewer than 3 coordinates: '{text}'")
    # LandXML order: northing (Y), easting (X), elevation (Z)
    y, x, z = float(parts[0]), float(parts[1]), float(parts[2])
    return x, y, z


def _filter_long_edge_faces(
    points: np.ndarray,
    faces: np.ndarray,
    max_edge_length: float,
) -> Tuple[np.ndarray, int]:
    """
    Drop triangles whose longest planar (x,y) edge exceeds max_edge_length.

    Real-world LandXML TIN exports commonly include Delaunay "bridge" triangles
    connecting disconnected islands of survey/design data (e.g. separate
    carriageways, gaps in data collection) — these are present in the file's own
    <Faces> list but aren't real surface geometry, and would otherwise render as
    the surface extending past its true imported boundary.

    max_edge_length is always explicit — there is no auto-computed default.
    Callers only invoke this when the user has actually supplied a value; use
    the "Boundary" overlay (geometry_utils.extract_boundary_loops, exposed via
    /api/boundary) to visually judge what threshold makes sense first.

    Returns (filtered_faces, removed_count).
    """
    if len(faces) == 0:
        return faces, 0

    a = points[faces[:, 0], :2]
    b = points[faces[:, 1], :2]
    c = points[faces[:, 2], :2]
    ab = np.linalg.norm(a - b, axis=1)
    bc = np.linalg.norm(b - c, axis=1)
    ca = np.linalg.norm(c - a, axis=1)

    longest = np.maximum(np.maximum(ab, bc), ca)
    keep = longest <= max_edge_length
    removed = int((~keep).sum())
    return faces[keep], removed


def _min_interior_angles_deg(points: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """
    Planar (x,y) minimum interior angle per face, in degrees — same law-of-cosines
    convention as the frontend's minTriangleAngleDeg() in CutFillMap3D.jsx (used
    there for the "Angle Quality" heatmap; this is the server-side counterpart used
    for actually trimming). Degenerate faces with a zero-length edge (duplicate
    points) are reported as angle 0 (the worst case), not NaN.
    """
    a = points[faces[:, 0], :2]
    b = points[faces[:, 1], :2]
    c = points[faces[:, 2], :2]
    ab = np.linalg.norm(a - b, axis=1)
    bc = np.linalg.norm(b - c, axis=1)
    ca = np.linalg.norm(c - a, axis=1)

    def angle_opposite(opp: np.ndarray, s1: np.ndarray, s2: np.ndarray) -> np.ndarray:
        denom = 2 * s1 * s2
        with np.errstate(divide="ignore", invalid="ignore"):
            cosv = np.where(denom > 0, (s1 ** 2 + s2 ** 2 - opp ** 2) / denom, 1.0)
        cosv = np.clip(cosv, -1.0, 1.0)
        return np.degrees(np.arccos(cosv))

    angle_a = angle_opposite(bc, ab, ca)
    angle_b = angle_opposite(ca, ab, bc)
    angle_c = angle_opposite(ab, bc, ca)
    return np.minimum(np.minimum(angle_a, angle_b), angle_c)


def _filter_sliver_faces(
    points: np.ndarray,
    faces: np.ndarray,
    min_angle_deg: float,
) -> Tuple[np.ndarray, int]:
    """
    Drop triangles whose minimum planar (x,y) interior angle is below min_angle_deg —
    thin/degenerate "sliver" triangles. Unlike _filter_long_edge_faces (which only
    catches abnormally LONG edges), a sliver can have perfectly normal-length edges
    and still be a near-degenerate triangle shape, so this is an independent filter,
    not a replacement.

    min_angle_deg is always explicit — there is no auto-computed default, same
    convention as max_edge_length. Use the "Angle Quality" overlay in the 3D viewer
    to visually judge a sensible threshold first.

    Returns (filtered_faces, removed_count).
    """
    if len(faces) == 0:
        return faces, 0

    min_angle = _min_interior_angles_deg(points, faces)
    keep = min_angle >= min_angle_deg
    removed = int((~keep).sum())
    return faces[keep], removed


def _breakline_vertex_mask(
    points: np.ndarray, breaklines: List["Breakline"], tol: float = 1e-6,
) -> np.ndarray:
    """
    Boolean mask over `points` — True for any surface point that coincides with a
    source breakline point (kerbline, carriageway edge, chainage line, etc.).
    Breakline points are, in practice, exact coordinate copies of surface points
    (they constrain the triangulation), so a rounded-coordinate set lookup is used
    instead of an O(N x M) brute-force distance search.
    """
    if not breaklines or len(points) == 0:
        return np.zeros(len(points), dtype=bool)

    decimals = max(0, int(round(-np.log10(tol))))
    bl_points = np.concatenate([bl.points for bl in breaklines], axis=0)
    bl_set = {tuple(p) for p in np.round(bl_points, decimals)}
    rounded_points = np.round(points, decimals)
    return np.array([tuple(p) in bl_set for p in rounded_points], dtype=bool)


def _filter_sliver_faces_from_boundary(
    points: np.ndarray,
    faces: np.ndarray,
    min_angle_deg: float,
    protected_vertex_mask: np.ndarray,
) -> Tuple[np.ndarray, int]:
    """
    Like _filter_sliver_faces, but only removes sliver triangles reachable by
    eroding inward from the mesh's CURRENT boundary (outer perimeter, any interior
    holes, and disconnected fragments alike — any exposed edge is a valid erosion
    front) one layer at a time, stopping as soon as erosion would reach a triangle
    with a vertex on a real feature line (protected_vertex_mask). A featureline is
    deliberate, real geometry (kerbline, carriageway edge, etc.), so anything
    bounded by one is legitimate data, not a Delaunay artifact — regardless of how
    thin it looks. This avoids stripping real interior triangles between closely-
    spaced breaklines, which a blanket "remove anywhere" filter cannot distinguish
    from genuine outer-edge slivers.

    Returns (filtered_faces, removed_count).
    """
    if len(faces) == 0:
        return faces, 0

    min_angle = _min_interior_angles_deg(points, faces)
    is_sliver = min_angle < min_angle_deg
    alive = np.ones(len(faces), dtype=bool)

    while True:
        alive_idx = np.nonzero(alive)[0]
        if len(alive_idx) == 0:
            break

        edge_count: Dict[Tuple[int, int], int] = defaultdict(int)
        for gi in alive_idx:
            f = faces[gi]
            for i in range(3):
                a, b = int(f[i]), int(f[(i + 1) % 3])
                edge_count[(a, b) if a < b else (b, a)] += 1
        boundary_edges = {e for e, c in edge_count.items() if c == 1}

        removed_this_round = False
        for gi in alive_idx:
            f = faces[gi]
            has_boundary_edge = False
            for i in range(3):
                a, b = int(f[i]), int(f[(i + 1) % 3])
                if ((a, b) if a < b else (b, a)) in boundary_edges:
                    has_boundary_edge = True
                    break
            if not has_boundary_edge:
                continue
            if protected_vertex_mask[f[0]] or protected_vertex_mask[f[1]] or protected_vertex_mask[f[2]]:
                continue   # touches a featureline -- erosion stops here, don't remove
            if is_sliver[gi]:
                alive[gi] = False
                removed_this_round = True

        if not removed_this_round:
            break

    removed = int((~alive).sum())
    return faces[alive], removed


def suggest_max_edge_length(points: np.ndarray, faces: np.ndarray) -> Optional[float]:
    """
    Suggest a Max Triangle Edge trim threshold by detecting statistical outliers in
    the mesh's longest-planar-edge-per-face distribution (the same measure
    _filter_long_edge_faces uses). Real Delaunay "bridge" triangles are typically
    drastically longer than the surrounding mesh's normal edges, so they show up as
    extreme outliers under the standard IQR method: outlier if
    longest_edge > Q3 + 3 * IQR — the conservative "extreme outlier" multiplier
    (vs. the common 1.5x "mild outlier" one), chosen to avoid flagging edges that
    are legitimately a bit longer (e.g. along a curve or the mesh's own boundary)
    rather than genuine bridges.

    This is a SUGGESTION only — it never filters anything itself. Always computed
    from the RAW, untrimmed faces so it reflects what's actually in the file.

    Returns None if there are too few faces to compute quartiles meaningfully, all
    edges are identical (IQR == 0), or nothing qualifies as an outlier.
    """
    if len(faces) < 4:
        return None

    a = points[faces[:, 0], :2]
    b = points[faces[:, 1], :2]
    c = points[faces[:, 2], :2]
    ab = np.linalg.norm(a - b, axis=1)
    bc = np.linalg.norm(b - c, axis=1)
    ca = np.linalg.norm(c - a, axis=1)
    longest = np.maximum(np.maximum(ab, bc), ca)

    q1, q3 = np.percentile(longest, [25, 75])
    iqr = q3 - q1
    if iqr > 0:
        threshold = q3 + 3.0 * iqr
    else:
        # Degenerate case: near-zero spread in the bulk of edges (e.g. a
        # perfectly uniform grid, where IQR alone can't define "outlier"). Fall
        # back to a multiple of the median so an obvious bridge triangle still
        # gets flagged instead of silently returning nothing.
        median = float(np.median(longest))
        if median <= 0:
            return None
        threshold = median * 5.0

    if longest.max() <= threshold:
        return None

    return round(float(threshold), 2)


def _parse_breaklines(surface_el: etree._Element, ns: str) -> List[Breakline]:
    """
    Reads <Surface><SourceData><Breaklines><Breakline> elements, if present.
    Each <Breakline> holds a <PntList3D> — a flat whitespace-separated list of
    (northing easting elevation) triples, same ordering convention as <P>.
    """
    breaklines: List[Breakline] = []

    source_data_el = surface_el.find(_ns("SourceData", ns))
    if source_data_el is None:
        return breaklines

    breaklines_el = source_data_el.find(_ns("Breaklines", ns))
    if breaklines_el is None:
        return breaklines

    for bl_el in breaklines_el.findall(_ns("Breakline", ns)):
        desc = bl_el.get("desc", "")
        brk_type = bl_el.get("brkType", "")

        pntlist_el = bl_el.find(_ns("PntList3D", ns))
        if pntlist_el is None:
            continue
        text = (pntlist_el.text or "").strip()
        if not text:
            continue

        try:
            nums = [float(v) for v in text.split()]
        except ValueError:
            continue
        if len(nums) < 3 or len(nums) % 3 != 0:
            continue

        arr = np.array(nums, dtype=np.float64).reshape(-1, 3)
        # LandXML order per point is northing(Y) easting(X) elevation(Z) — reorder to X Y Z
        xyz = arr[:, [1, 0, 2]]
        breaklines.append(Breakline(desc=desc, brk_type=brk_type, points=xyz))

    return breaklines


def _apply_trim_pipeline(
    points: np.ndarray,
    raw_faces: np.ndarray,
    max_edge_length: Optional[float],
    clip_to_boundary: bool,
    min_angle_deg: Optional[float] = None,
    surface_name: str = "",
    breaklines: Optional[List["Breakline"]] = None,
) -> dict:
    """
    The trim/clip/boundary pipeline shared by initial parsing (_parse_surfaces) and
    live re-trimming (retrim_surface) — always runs against the ORIGINAL raw faces,
    never against an already-trimmed result, so loosening any of the trim params
    correctly brings previously-trimmed faces back rather than compounding trims.

    Order: optional edge-length trim -> optional sliver (min-angle) erosion trim ->
    boundary extraction -> optional geometric clip to that boundary -> re-extraction
    (so the boundary reported reflects the FINAL faces, not an intermediate state).

    The sliver trim erodes inward from the current boundary rather than removing
    slivers anywhere in the mesh — see _filter_sliver_faces_from_boundary — so it
    needs `breaklines` to know which vertices are protected featureline points.

    Returns {faces, faces_filtered_count, max_edge_length_used, sliver_faces_removed,
    min_angle_used, fragment_faces_removed, boundary_filter_applied, boundary_loops}.
    """
    if clip_to_boundary and max_edge_length is None:
        raise ValueError(
            "clip_to_boundary requires max_edge_length to be set first. The boundary of a "
            "surface's raw, untrimmed triangulation is typically deceptively simple (Delaunay "
            "'bridge' triangles paper over the real gaps in the data), so clipping against it "
            "wouldn't remove anything meaningful. Set Max Triangle Edge first to expose the "
            "true structure, then Clip to Boundary."
        )

    if max_edge_length is not None:
        faces_arr, filtered_count = _filter_long_edge_faces(
            points, raw_faces, max_edge_length=max_edge_length,
        )
        edge_length_used = max_edge_length
    else:
        faces_arr, filtered_count, edge_length_used = raw_faces, 0, None

    if min_angle_deg is not None:
        protected_mask = _breakline_vertex_mask(points, breaklines or [])
        faces_arr, sliver_count = _filter_sliver_faces_from_boundary(
            points, faces_arr, min_angle_deg, protected_mask,
        )
        angle_used = min_angle_deg
    else:
        sliver_count, angle_used = 0, None

    # Local import — geometry_utils imports TINSurface from this module at module
    # level, so a module-level import here would be circular.
    from geometry_utils import extract_boundary_loops, clip_faces_to_boundary

    # Boundary is always extracted, from the current faces (after any edge-length /
    # sliver trim above, but before the boundary clip below).
    boundary_loops = extract_boundary_loops(points, faces_arr)

    if clip_to_boundary:
        if not boundary_loops:
            raise ValueError(
                f"Surface '{surface_name}' has no boundary to clip against (max_edge_length may "
                "be too small, leaving no faces after trimming)."
            )
        main_loop = max(boundary_loops, key=len)
        faces_arr, fragment_count = clip_faces_to_boundary(points, faces_arr, main_loop)
        # Re-extract so the boundary reported to callers reflects what's actually
        # left after clipping, not the pre-clip shape.
        boundary_loops = extract_boundary_loops(points, faces_arr)
    else:
        fragment_count = 0

    return {
        "faces": faces_arr,
        "faces_filtered_count": filtered_count,
        "max_edge_length_used": edge_length_used,
        "sliver_faces_removed": sliver_count,
        "min_angle_used": angle_used,
        "fragment_faces_removed": fragment_count,
        "boundary_filter_applied": clip_to_boundary,
        "boundary_loops": boundary_loops,
    }


def retrim_surface(
    surface: TINSurface,
    max_edge_length: Optional[float] = None,
    clip_to_boundary: bool = False,
    min_angle_deg: Optional[float] = None,
) -> TINSurface:
    """
    Re-apply the trim/clip/boundary pipeline to a surface's stored raw_faces —
    used for live Advanced-Options adjustments in the UI (/api/retrim) without
    needing to re-read the original file. `points`, `raw_faces`, `name`, `desc`,
    `breaklines`, and `suggested_max_edge_length` all carry over unchanged; only
    the trim-dependent fields are recomputed.
    """
    result = _apply_trim_pipeline(
        surface.points, surface.raw_faces, max_edge_length, clip_to_boundary,
        min_angle_deg, surface.name, surface.breaklines,
    )
    return TINSurface(
        name=surface.name,
        desc=surface.desc,
        points=surface.points,
        faces=result["faces"],
        faces_filtered_count=result["faces_filtered_count"],
        max_edge_length_used=result["max_edge_length_used"],
        sliver_faces_removed=result["sliver_faces_removed"],
        min_angle_used=result["min_angle_used"],
        fragment_faces_removed=result["fragment_faces_removed"],
        boundary_filter_applied=result["boundary_filter_applied"],
        boundary_loops=result["boundary_loops"],
        breaklines=surface.breaklines,
        suggested_max_edge_length=surface.suggested_max_edge_length,
        raw_faces=surface.raw_faces,
    )


def _parse_surfaces(
    root: etree._Element, ns: str,
    max_edge_length: Optional[float] = None,
    clip_to_boundary: bool = False,
    min_angle_deg: Optional[float] = None,
) -> List[TINSurface]:
    if clip_to_boundary and max_edge_length is None:
        raise ValueError(
            "clip_to_boundary requires max_edge_length to be set first. The boundary of a "
            "surface's raw, untrimmed triangulation is typically deceptively simple (Delaunay "
            "'bridge' triangles paper over the real gaps in the data), so clipping against it "
            "wouldn't remove anything meaningful. Set Max Triangle Edge first to expose the "
            "true structure, then Clip to Boundary."
        )
    surfaces = []

    surfaces_el = root.find(_ns("Surfaces", ns))
    if surfaces_el is None:
        # Try nested under a project or other element
        surfaces_el = root.find(f".//{_ns('Surfaces', ns)}")

    if surfaces_el is None:
        return surfaces

    for surface_el in surfaces_el.findall(_ns("Surface", ns)):
        name = surface_el.get("name", "Unnamed")
        desc = surface_el.get("desc", "")

        definition_el = surface_el.find(_ns("Definition", ns))
        if definition_el is None:
            continue

        surf_type = definition_el.get("surfType", "TIN").upper()
        if surf_type != "TIN":
            # Grid surfaces: convert to TIN or skip
            continue

        # ---- Parse Points ----
        pnts_el = definition_el.find(_ns("Pnts", ns))
        if pnts_el is None:
            continue

        # Build id -> index mapping
        id_to_idx: dict[str, int] = {}
        point_list: List[Tuple[float, float, float]] = []

        for p_el in pnts_el.findall(_ns("P", ns)):
            pid = p_el.get("id")
            text = (p_el.text or "").strip()
            if not text:
                continue
            try:
                x, y, z = _parse_point_text(text)
            except ValueError:
                continue
            idx = len(point_list)
            point_list.append((x, y, z))
            if pid is not None:
                id_to_idx[pid] = idx

        if not point_list:
            continue

        points_arr = np.array(point_list, dtype=np.float64)

        # ---- Parse Faces ----
        faces_el = definition_el.find(_ns("Faces", ns))
        if faces_el is None:
            continue

        face_list: List[Tuple[int, int, int]] = []
        for f_el in faces_el.findall(_ns("F", ns)):
            text = (f_el.text or "").strip()
            parts = text.split()
            if len(parts) < 3:
                continue
            try:
                # LandXML face indices are 1-based point IDs
                a_id, b_id, c_id = parts[0], parts[1], parts[2]
                a = id_to_idx.get(a_id, int(a_id) - 1)
                b = id_to_idx.get(b_id, int(b_id) - 1)
                c = id_to_idx.get(c_id, int(c_id) - 1)
                face_list.append((a, b, c))
            except (ValueError, KeyError):
                continue

        if not face_list:
            continue

        faces_arr = np.array(face_list, dtype=np.int32)

        # Clamp indices to valid range
        n = len(point_list)
        faces_arr = faces_arr[(faces_arr[:, 0] < n) &
                              (faces_arr[:, 1] < n) &
                              (faces_arr[:, 2] < n)]
        faces_arr = np.clip(faces_arr, 0, n - 1)
        raw_faces_arr = faces_arr   # kept on the surface for later live re-trimming

        # Always computed from the raw, untrimmed faces — a suggestion for the
        # user, never applied automatically (see suggest_max_edge_length docstring).
        suggested_edge_length = suggest_max_edge_length(points_arr, raw_faces_arr)

        breaklines = _parse_breaklines(surface_el, ns)

        pipeline_result = _apply_trim_pipeline(
            points_arr, raw_faces_arr, max_edge_length, clip_to_boundary, min_angle_deg,
            name, breaklines,
        )

        surfaces.append(TINSurface(
            name=name,
            desc=desc,
            points=points_arr,
            faces=pipeline_result["faces"],
            faces_filtered_count=pipeline_result["faces_filtered_count"],
            max_edge_length_used=pipeline_result["max_edge_length_used"],
            sliver_faces_removed=pipeline_result["sliver_faces_removed"],
            min_angle_used=pipeline_result["min_angle_used"],
            fragment_faces_removed=pipeline_result["fragment_faces_removed"],
            boundary_filter_applied=pipeline_result["boundary_filter_applied"],
            boundary_loops=pipeline_result["boundary_loops"],
            breaklines=breaklines,
            suggested_max_edge_length=suggested_edge_length,
            raw_faces=raw_faces_arr,
        ))

    return surfaces


def parse_landxml_bytes(
    data: bytes,
    max_edge_length: Optional[float] = None,
    clip_to_boundary: bool = False,
    min_angle_deg: Optional[float] = None,
) -> List[TINSurface]:
    """
    Parse a LandXML file from raw bytes.
    Returns a list of TINSurface objects.
    Raises ValueError on invalid or unsupported files.

    max_edge_length is None by default — surfaces are parsed with their raw,
    unmodified triangulation. Pass an explicit value to trim Delaunay "bridge"
    triangles (see _filter_long_edge_faces); there is no auto-computed default,
    so the app never silently alters imported geometry unless the user
    explicitly asks for it with a specific threshold.

    min_angle_deg is None by default — pass an explicit value to remove thin/
    degenerate "sliver" triangles whose minimum interior angle falls below it
    (see _filter_sliver_faces). Independent of max_edge_length: a sliver can have
    perfectly normal-length edges and still be a near-degenerate triangle shape.
    No auto-computed default, same convention as max_edge_length.

    clip_to_boundary is False by default. When True, computes the surface's
    boundary (see geometry_utils.extract_boundary_loops) after the edge-length
    trim, takes the largest (main) loop, and geometrically clips out any faces
    whose centroid falls outside that boundary polygon (geometry_utils.
    clip_faces_to_boundary) — unlike a purely topological filter, this keeps
    disconnected fragments that happen to sit geometrically inside the main
    footprint (arguably legitimate data) while removing genuinely outlying
    ones. REQUIRES max_edge_length to also be set: the boundary of a raw, untrimmed
    triangulation is typically deceptively simple (bridge triangles paper over
    the real gaps), so clipping against it wouldn't remove anything meaningful
    — raises ValueError if clip_to_boundary=True and max_edge_length is None.
    """
    try:
        root = etree.fromstring(data)
    except etree.XMLSyntaxError as exc:
        raise ValueError(f"Invalid XML: {exc}") from exc

    ns = _detect_namespace(root)

    # Verify root tag is LandXML
    root_local = re.sub(r'\{.*?\}', '', root.tag)
    if root_local.lower() != "landxml":
        raise ValueError(
            f"Root element is <{root_local}>, expected <LandXML>. "
            "Please upload a valid LandXML file."
        )

    surfaces = _parse_surfaces(
        root, ns, max_edge_length=max_edge_length, clip_to_boundary=clip_to_boundary,
        min_angle_deg=min_angle_deg,
    )
    if not surfaces:
        raise ValueError(
            "No valid TIN surfaces found in this LandXML file. "
            "Ensure the file contains <Surfaces><Surface surfType='TIN'> elements."
        )

    return surfaces
