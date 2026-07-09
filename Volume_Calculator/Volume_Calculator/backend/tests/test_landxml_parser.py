import numpy as np
import pytest

from landxml_parser import (
    TINSurface, parse_landxml_bytes, _filter_long_edge_faces, suggest_max_edge_length,
    retrim_surface, _filter_sliver_faces, _filter_sliver_faces_from_boundary,
    _breakline_vertex_mask, Breakline,
)
from landxml_writer import write_landxml_surface


def _sliver_fixture():
    """
    A dense, well-formed 4x4 grid patch (every triangle's minimum interior angle
    is a clean 45°) plus one obvious sliver triangle — three nearly-collinear
    points, min angle ~5.7° — tacked on with its own dedicated points far from
    the grid. Normal-length edges throughout; only the ANGLE is degenerate, so
    this is something _filter_long_edge_faces can't catch but _filter_sliver_faces
    should.
    """
    n = 4
    points = [(float(xi), float(yi), 0.0) for xi in range(n) for yi in range(n)]
    faces = []
    for xi in range(n - 1):
        for yi in range(n - 1):
            a, b, c, d = xi * n + yi, (xi + 1) * n + yi, xi * n + (yi + 1), (xi + 1) * n + (yi + 1)
            faces.append((a, b, c))
            faces.append((b, d, c))

    sliver_base = len(points)
    points += [(100.0, 100.0, 0.0), (101.0, 100.0, 0.0), (100.5, 100.05, 0.0)]
    faces.append((sliver_base, sliver_base + 1, sliver_base + 2))

    return np.array(points, dtype=np.float64), np.array(faces, dtype=np.int32), n


def _bridge_fixture():
    """
    A dense, well-formed 5x5 grid patch (1m spacing, ~1.4m max edge) plus one
    isolated point 100m away connected to the patch by a single "bridge" face —
    mimics the real-world Delaunay artifact of disconnected survey data islands.
    """
    xs = np.arange(0, 5, 1.0)
    ys = np.arange(0, 5, 1.0)
    points = []
    idx = {}
    for xi, x in enumerate(xs):
        for yi, y in enumerate(ys):
            idx[(xi, yi)] = len(points)
            points.append((x, y, 0.0))

    faces = []
    for xi in range(len(xs) - 1):
        for yi in range(len(ys) - 1):
            a, b, c, d = idx[(xi, yi)], idx[(xi + 1, yi)], idx[(xi, yi + 1)], idx[(xi + 1, yi + 1)]
            faces.append((a, b, c))
            faces.append((b, d, c))

    # The isolated far point + one bridge triangle connecting it to a patch corner
    far_idx = len(points)
    points.append((100.0, 100.0, 0.0))
    faces.append((0, 1, far_idx))

    return np.array(points, dtype=np.float64), np.array(faces, dtype=np.int32)


def test_filter_long_edge_faces_requires_explicit_threshold():
    points, faces = _bridge_fixture()

    # A generous explicit threshold keeps everything, including the bridge.
    filtered, removed = _filter_long_edge_faces(points, faces, max_edge_length=200.0)
    assert removed == 0
    assert len(filtered) == len(faces)

    # A tight explicit threshold removes the bridge (and nothing else,
    # since patch edges are ~1-1.4m).
    filtered2, removed2 = _filter_long_edge_faces(points, faces, max_edge_length=5.0)
    assert removed2 == 1
    assert len(filtered2) == len(faces) - 1
    assert not any(np.array_equal(np.sort(f), np.sort([0, 1, len(points) - 1])) for f in filtered2)


def test_suggest_max_edge_length_detects_bridge_outlier():
    points, faces = _bridge_fixture()
    suggestion = suggest_max_edge_length(points, faces)
    assert suggestion is not None
    # Should sit strictly between the normal patch edges (~1.4m) and the bridge
    # edge (~141m) — trimming at this value would remove the bridge and nothing else.
    assert 1.5 < suggestion < 141.0
    filtered, removed = _filter_long_edge_faces(points, faces, max_edge_length=suggestion)
    assert removed == 1
    assert len(filtered) == len(faces) - 1


def test_suggest_max_edge_length_none_for_uniform_mesh():
    points, faces = _bridge_fixture()
    # Drop the bridge face — a uniform grid has no outliers to flag.
    uniform_faces = faces[:-1]
    assert suggest_max_edge_length(points, uniform_faces) is None


def test_suggest_max_edge_length_none_for_too_few_faces():
    points, faces = _bridge_fixture()
    assert suggest_max_edge_length(points, faces[:2]) is None


def test_retrim_surface_tightens_without_reparsing():
    points, faces = _bridge_fixture()
    # Parsed raw — no trim applied yet, bridge still present.
    surf = TINSurface(name="RETRIM_TEST", desc="", points=points, faces=faces)
    assert surf.faces_filtered_count == 0
    assert len(surf.faces) == len(faces)

    tightened = retrim_surface(surf, max_edge_length=5.0, clip_to_boundary=False)
    assert tightened.faces_filtered_count == 1
    assert len(tightened.faces) == len(faces) - 1
    assert tightened.max_edge_length_used == 5.0
    # raw_faces (and other carried-over fields) survive the retrim untouched.
    assert len(tightened.raw_faces) == len(faces)
    assert tightened.name == "RETRIM_TEST"


def test_retrim_surface_loosens_back_to_raw():
    points, faces = _bridge_fixture()
    surf = TINSurface(name="RETRIM_TEST2", desc="", points=points, faces=faces)
    tightened = retrim_surface(surf, max_edge_length=5.0, clip_to_boundary=False)
    assert tightened.faces_filtered_count == 1

    # Retrim AGAIN off of the (already-once-retrimmed) surface, loosening back to
    # no trim — the bridge triangle must reappear, proving retrim always recomputes
    # from raw_faces rather than compounding against the previous result.
    loosened = retrim_surface(tightened, max_edge_length=None, clip_to_boundary=False)
    assert loosened.faces_filtered_count == 0
    assert len(loosened.faces) == len(faces)


def test_retrim_surface_requires_max_edge_length_for_clip():
    points, faces = _bridge_fixture()
    surf = TINSurface(name="RETRIM_TEST3", desc="", points=points, faces=faces)
    with pytest.raises(ValueError, match="requires max_edge_length"):
        retrim_surface(surf, max_edge_length=None, clip_to_boundary=True)


def test_filter_sliver_faces_removes_thin_triangle():
    points, faces, n = _sliver_fixture()
    grid_face_count = (n - 1) * (n - 1) * 2

    # A generous threshold keeps everything, including the sliver.
    filtered, removed = _filter_sliver_faces(points, faces, min_angle_deg=0.0)
    assert removed == 0
    assert len(filtered) == len(faces)

    # A reasonable threshold removes only the sliver (~5.7°), keeping every
    # normal 45°-angle grid triangle.
    filtered2, removed2 = _filter_sliver_faces(points, faces, min_angle_deg=10.0)
    assert removed2 == 1
    assert len(filtered2) == grid_face_count


def test_filter_sliver_faces_degenerate_zero_length_edge():
    # Two duplicate points collapse one edge to zero length — must not crash
    # (divide-by-zero in the law-of-cosines) and must be treated as angle 0,
    # i.e. removed by any positive threshold.
    points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.0, 0.0]], dtype=np.float64)
    faces = np.array([[0, 1, 2]], dtype=np.int32)
    filtered, removed = _filter_sliver_faces(points, faces, min_angle_deg=1.0)
    assert removed == 1
    assert len(filtered) == 0


def test_filter_sliver_faces_empty_faces():
    points, _, _ = _sliver_fixture()
    filtered, removed = _filter_sliver_faces(points, np.zeros((0, 3), dtype=np.int32), min_angle_deg=5.0)
    assert removed == 0
    assert len(filtered) == 0


def test_retrim_surface_combines_edge_length_and_min_angle():
    points, faces = _bridge_fixture()
    surf = TINSurface(name="COMBINED_TEST", desc="", points=points, faces=faces)

    both = retrim_surface(surf, max_edge_length=5.0, min_angle_deg=10.0)
    # The bridge fixture's grid triangles are all a clean 45° — min_angle_deg=10
    # shouldn't touch them, only the edge-length trim removes the bridge face.
    assert both.faces_filtered_count == 1
    assert both.sliver_faces_removed == 0
    assert both.min_angle_used == 10.0
    assert len(both.faces) == len(faces) - 1

    # Loosening min_angle_deg back to None recomputes from raw_faces, not the
    # already-trimmed `both` result — should be identical to edge-length-only.
    loosened = retrim_surface(both, max_edge_length=5.0, min_angle_deg=None)
    assert loosened.sliver_faces_removed == 0
    assert loosened.min_angle_used is None
    assert len(loosened.faces) == len(faces) - 1


def test_retrim_surface_min_angle_independent_of_max_edge_length():
    points, faces, n = _sliver_fixture()
    surf = TINSurface(name="SLIVER_RETRIM_TEST", desc="", points=points, faces=faces)

    # min_angle_deg alone (no max_edge_length) must work — sliver detection
    # doesn't require the edge-length trim to have run first, unlike clip_to_boundary.
    result = retrim_surface(surf, max_edge_length=None, min_angle_deg=10.0)
    assert result.sliver_faces_removed == 1
    assert result.faces_filtered_count == 0
    assert len(result.faces) == len(faces) - 1


def test_breakline_vertex_mask_matches_coincident_points():
    points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]], dtype=np.float64)
    bl = Breakline(desc="K", brk_type="standard", points=np.array([[1.0, 0.0, 0.0], [2.0, 0.0, 0.0]]))
    mask = _breakline_vertex_mask(points, [bl])
    assert mask.tolist() == [False, True, True]


def test_breakline_vertex_mask_empty_breaklines():
    points = np.array([[0.0, 0.0, 0.0]], dtype=np.float64)
    assert _breakline_vertex_mask(points, []).tolist() == [False]


def test_filter_sliver_faces_from_boundary_erodes_unprotected_outer_sliver():
    points, faces, n = _sliver_fixture()
    grid_face_count = (n - 1) * (n - 1) * 2

    # No protected vertices — behaves like the blanket filter for a sliver that's
    # already fully exposed to the boundary (an isolated triangle, all 3 edges
    # are boundary edges from the start).
    mask_none = np.zeros(len(points), dtype=bool)
    filtered, removed = _filter_sliver_faces_from_boundary(points, faces, 10.0, mask_none)
    assert removed == 1
    assert len(filtered) == grid_face_count


def test_filter_sliver_faces_from_boundary_protects_featureline_triangle():
    points, faces, n = _sliver_fixture()

    # Mark one of the sliver's own vertices as touching a featureline — erosion
    # must stop before removing it, even though it's exactly as thin as before.
    sliver_base = n * n
    mask_protected = np.zeros(len(points), dtype=bool)
    mask_protected[sliver_base] = True
    filtered, removed = _filter_sliver_faces_from_boundary(points, faces, 10.0, mask_protected)
    assert removed == 0
    assert len(filtered) == len(faces)


def test_retrim_surface_min_angle_protects_breakline_triangle():
    points, faces, n = _sliver_fixture()
    sliver_base = n * n
    bl = Breakline(desc="K", brk_type="standard", points=points[sliver_base:sliver_base + 1].copy())
    surf = TINSurface(name="BL_PROTECT_TEST", desc="", points=points, faces=faces, breaklines=[bl])

    # Same threshold that removes the sliver with no breaklines (see
    # test_retrim_surface_min_angle_independent_of_max_edge_length) now leaves it
    # untouched, because one of its vertices coincides with a source breakline point.
    result = retrim_surface(surf, max_edge_length=None, min_angle_deg=10.0)
    assert result.sliver_faces_removed == 0
    assert len(result.faces) == len(faces)


def test_filter_long_edge_faces_empty_faces():
    points, _ = _bridge_fixture()
    filtered, removed = _filter_long_edge_faces(points, np.zeros((0, 3), dtype=np.int32), max_edge_length=5.0)
    assert removed == 0
    assert len(filtered) == 0


def test_parse_landxml_bytes_no_trimming_by_default():
    points, faces = _bridge_fixture()
    surf = TINSurface(name="BRIDGE_TEST0", desc="", points=points, faces=faces)
    xml_bytes = write_landxml_surface(surf)

    # max_edge_length defaults to None — no auto-computed guess, the raw
    # triangulation (bridge triangle included) comes through untouched.
    parsed = parse_landxml_bytes(xml_bytes)
    result = parsed[0]
    assert result.faces_filtered_count == 0
    assert result.max_edge_length_used is None
    assert len(result.faces) == len(faces)


def test_parse_landxml_bytes_trims_with_explicit_max_edge_length():
    points, faces = _bridge_fixture()
    surf = TINSurface(name="BRIDGE_TEST", desc="", points=points, faces=faces)
    xml_bytes = write_landxml_surface(surf)

    parsed = parse_landxml_bytes(xml_bytes, max_edge_length=5.0)
    assert len(parsed) == 1
    result = parsed[0]

    assert result.faces_filtered_count == 1
    assert len(result.faces) == len(faces) - 1
    assert result.max_edge_length_used == 5.0

    d = result.to_dict()
    assert d["faces_filtered_count"] == 1
    assert d["max_edge_length_used"] == 5.0


def test_parse_landxml_bytes_generous_explicit_threshold_keeps_bridge():
    points, faces = _bridge_fixture()
    surf = TINSurface(name="BRIDGE_TEST2", desc="", points=points, faces=faces)
    xml_bytes = write_landxml_surface(surf)

    # Explicitly allow edges up to 200m — the bridge should survive.
    parsed = parse_landxml_bytes(xml_bytes, max_edge_length=200.0)
    result = parsed[0]
    assert result.faces_filtered_count == 0
    assert len(result.faces) == len(faces)


def _bridge_to_satellite_patch_fixture():
    """
    A main 5x5 grid patch plus a small 2x2 satellite patch 100m away, joined to
    the main patch by one long bridge triangle. Unlike _bridge_fixture (whose
    "island" is a single unconnected point), the satellite here has its own
    short internal edges — so after the bridge triangle is edge-trimmed, the
    satellite's 2 faces survive as a genuine disconnected fragment (multiple
    connected faces, not just an orphan point) for the boundary clip to catch.
    """
    xs = np.arange(0, 5, 1.0)
    ys = np.arange(0, 5, 1.0)
    points = []
    idx = {}
    for xi, x in enumerate(xs):
        for yi, y in enumerate(ys):
            idx[(xi, yi)] = len(points)
            points.append((x, y, 0.0))
    main_faces = []
    for xi in range(len(xs) - 1):
        for yi in range(len(ys) - 1):
            a, b, c, d = idx[(xi, yi)], idx[(xi + 1, yi)], idx[(xi, yi + 1)], idx[(xi + 1, yi + 1)]
            main_faces.append((a, b, c))
            main_faces.append((b, d, c))

    sat_base = len(points)
    for sx in (100.0, 101.0):
        for sy in (100.0, 101.0):
            points.append((sx, sy, 0.0))
    # satellite square: sat_base=(100,100), +1=(100,101), +2=(101,100), +3=(101,101)
    satellite_faces = [(sat_base, sat_base + 1, sat_base + 2), (sat_base + 1, sat_base + 3, sat_base + 2)]

    bridge_face = [(0, sat_base, sat_base + 1)]   # two ~140m edges, one ~1m edge

    faces = main_faces + satellite_faces + bridge_face
    return np.array(points, dtype=np.float64), np.array(faces, dtype=np.int32), len(main_faces), len(satellite_faces)


def test_edge_trim_and_boundary_clip_compose():
    points, faces, main_count, sat_count = _bridge_to_satellite_patch_fixture()
    surf = TINSurface(name="COMPOSE_TEST", desc="", points=points, faces=faces)
    xml_bytes = write_landxml_surface(surf)

    # Edge trim alone: removes the bridge triangle, leaves the satellite as a
    # disconnected-but-present fragment.
    trimmed_only = parse_landxml_bytes(xml_bytes, max_edge_length=5.0)[0]
    assert trimmed_only.faces_filtered_count == 1
    assert len(trimmed_only.faces) == main_count + sat_count
    assert trimmed_only.fragment_faces_removed == 0

    # Edge trim + boundary clip: the now-disconnected satellite fragment sits
    # well outside the main patch's boundary polygon, so it's clipped too,
    # leaving only the main patch.
    both = parse_landxml_bytes(xml_bytes, max_edge_length=5.0, clip_to_boundary=True)[0]
    assert both.faces_filtered_count == 1
    assert both.boundary_filter_applied is True
    assert both.fragment_faces_removed == sat_count
    assert len(both.faces) == main_count


def test_clip_to_boundary_requires_max_edge_length():
    points, faces, _, _ = _bridge_to_satellite_patch_fixture()
    surf = TINSurface(name="GUARD_TEST", desc="", points=points, faces=faces)
    xml_bytes = write_landxml_surface(surf)

    with pytest.raises(ValueError, match="requires max_edge_length"):
        parse_landxml_bytes(xml_bytes, clip_to_boundary=True)


def test_boundary_loops_always_extracted_and_reflect_final_faces():
    points, faces, main_count, sat_count = _bridge_to_satellite_patch_fixture()
    surf = TINSurface(name="BOUNDARY_TEST", desc="", points=points, faces=faces)
    xml_bytes = write_landxml_surface(surf)

    # No filters at all — boundary is still always extracted (2 loops: the main
    # patch, and the bridge+satellite combined into one 5-point loop).
    raw = parse_landxml_bytes(xml_bytes)[0]
    assert len(raw.boundary_loops) == 2
    assert sorted(len(loop) for loop in raw.boundary_loops) == [5, 16]
    assert raw.to_dict()["boundary_loop_count"] == 2
    assert raw.to_dict()["boundary_main_loop_points"] == 16

    # Edge trim only: bridge removed, satellite becomes its own clean 4-point loop.
    trimmed = parse_landxml_bytes(xml_bytes, max_edge_length=5.0)[0]
    assert len(trimmed.boundary_loops) == 2
    assert sorted(len(loop) for loop in trimmed.boundary_loops) == [4, 16]

    # Edge trim + boundary clip: satellite fragment gone entirely — one loop left.
    both = parse_landxml_bytes(xml_bytes, max_edge_length=5.0, clip_to_boundary=True)[0]
    assert len(both.boundary_loops) == 1
    assert len(both.boundary_loops[0]) == 16
