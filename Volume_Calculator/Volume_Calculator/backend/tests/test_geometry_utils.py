import numpy as np

from geometry_utils import (
    _closest_point_on_triangle, build_face_grid_index, nearest_point_on_surface,
    extract_boundary_loops, clip_faces_to_boundary, chain_breaklines,
)
from landxml_parser import Breakline


def _bl(points):
    return Breakline(desc="K", brk_type="standard", points=np.array(points, dtype=np.float64))


TRI_A = np.array([0.0, 0.0, 0.0])
TRI_B = np.array([4.0, 0.0, 0.0])
TRI_C = np.array([0.0, 4.0, 0.0])


def test_closest_point_on_triangle_interior_projection():
    # Point directly above the triangle's interior -> closest point is the
    # orthogonal projection onto the triangle's plane.
    p = np.array([1.0, 1.0, 5.0])
    cp = _closest_point_on_triangle(p, TRI_A, TRI_B, TRI_C)
    assert np.allclose(cp, [1.0, 1.0, 0.0], atol=1e-9)


def test_closest_point_on_triangle_beyond_vertex():
    # Point beyond vertex A (opposite the triangle body) -> closest point is A itself.
    p = np.array([-5.0, -5.0, 0.0])
    cp = _closest_point_on_triangle(p, TRI_A, TRI_B, TRI_C)
    assert np.allclose(cp, TRI_A, atol=1e-9)


def test_closest_point_on_triangle_beyond_edge():
    # Point beyond the hypotenuse edge B-C -> closest point lies on that edge.
    p = np.array([4.0, 4.0, 0.0])
    cp = _closest_point_on_triangle(p, TRI_A, TRI_B, TRI_C)
    assert np.allclose(cp, [2.0, 2.0, 0.0], atol=1e-9)


def test_nearest_point_on_surface_matches_bruteforce(eg_surface):
    index = build_face_grid_index(eg_surface)
    pts = eg_surface.points

    rng = np.random.default_rng(42)
    for _ in range(15):
        query = np.array([
            rng.uniform(eg_surface.x_min, eg_surface.x_max),
            rng.uniform(eg_surface.y_min, eg_surface.y_max),
            rng.uniform(-5, 5),
        ])

        got_point, got_dist = nearest_point_on_surface(index, query)

        best_dist = float("inf")
        for a, b, c in eg_surface.faces:
            cp = _closest_point_on_triangle(query, pts[a], pts[b], pts[c])
            d = float(np.linalg.norm(cp - query))
            if d < best_dist:
                best_dist = d

        assert abs(got_dist - best_dist) < 1e-6


def _main_patch():
    """4x4 grid of connected triangles (9 quads * 2 = 18 faces), point indices 0-15,
    spanning (0,0) to (3,3)."""
    n = 4
    points = [(float(xi), float(yi), 0.0) for xi in range(n) for yi in range(n)]
    faces = []
    for xi in range(n - 1):
        for yi in range(n - 1):
            a, b, c, d = xi * n + yi, (xi + 1) * n + yi, xi * n + (yi + 1), (xi + 1) * n + (yi + 1)
            faces.append((a, b, c))
            faces.append((b, d, c))
    return points, faces


def test_clip_faces_to_boundary_removes_outlying_fragment():
    points, main_faces = _main_patch()
    points = points + [(100.0, 100.0, 0.0), (101.0, 100.0, 0.0), (100.0, 101.0, 0.0)]
    far_fragment = (16, 17, 18)   # disconnected, well outside the main patch's footprint

    points = np.array(points, dtype=np.float64)
    faces = np.array(main_faces + [far_fragment], dtype=np.int32)

    boundary = extract_boundary_loops(points, faces)
    main_loop = max(boundary, key=len)

    kept, removed = clip_faces_to_boundary(points, faces, main_loop)

    assert removed == 1
    assert len(kept) == len(main_faces)
    kept_set = {tuple(sorted(f)) for f in kept.tolist()}
    assert tuple(sorted(far_fragment)) not in kept_set


def test_clip_faces_to_boundary_keeps_disconnected_fragment_inside_footprint():
    # A fragment that's topologically disconnected (distinct point indices, no
    # shared edge) but geometrically sits INSIDE the main patch's footprint is
    # kept — this is the behaviour that distinguishes a geometric clip from a
    # purely topological (connected-component) filter, which would remove any
    # non-largest component regardless of where it actually sits.
    points, main_faces = _main_patch()
    points = points + [(1.4, 1.4, 0.0), (1.6, 1.4, 0.0), (1.5, 1.6, 0.0)]
    inside_fragment = (16, 17, 18)

    points = np.array(points, dtype=np.float64)
    faces = np.array(main_faces + [inside_fragment], dtype=np.int32)

    boundary = extract_boundary_loops(points, faces)
    main_loop = max(boundary, key=len)

    kept, removed = clip_faces_to_boundary(points, faces, main_loop)

    assert removed == 0
    assert len(kept) == len(faces)
    kept_set = {tuple(sorted(f)) for f in kept.tolist()}
    assert tuple(sorted(inside_fragment)) in kept_set


def test_clip_faces_to_boundary_noop_when_all_inside():
    points, faces = _main_patch()
    points = np.array(points, dtype=np.float64)
    faces = np.array(faces, dtype=np.int32)

    boundary = extract_boundary_loops(points, faces)
    main_loop = max(boundary, key=len)

    kept, removed = clip_faces_to_boundary(points, faces, main_loop)
    assert removed == 0
    assert len(kept) == len(faces)


def test_clip_faces_to_boundary_empty_faces():
    points, _ = _main_patch()
    points = np.array(points, dtype=np.float64)
    kept, removed = clip_faces_to_boundary(points, np.zeros((0, 3), dtype=np.int32), [0, 1, 2])
    assert removed == 0
    assert len(kept) == 0


def test_clip_faces_to_boundary_degenerate_loop_is_noop():
    points, faces = _main_patch()
    points = np.array(points, dtype=np.float64)
    faces = np.array(faces, dtype=np.int32)
    kept, removed = clip_faces_to_boundary(points, faces, [0, 1])   # <3 points, not a polygon
    assert removed == 0
    assert len(kept) == len(faces)


def test_chain_breaklines_clean_rectangle_closes_into_one_loop():
    bl1 = _bl([[0, 0, 0], [1, 0, 0]])
    bl2 = _bl([[1, 0, 0], [1, 1, 0]])
    bl3 = _bl([[1, 1, 0], [0, 1, 0]])
    bl4 = _bl([[0, 1, 0], [0, 0, 0]])
    result = chain_breaklines([bl1, bl2, bl3, bl4])
    assert len(result["loops"]) == 1
    assert len(result["loops"][0]) == 5   # 4 corners, closed back to the start
    assert result["open_chains"] == []
    assert result["gap_points"] == []
    assert result["branch_points"] == []


def test_chain_breaklines_missing_side_reports_two_gaps():
    bl1 = _bl([[0, 0, 0], [1, 0, 0]])
    bl2 = _bl([[1, 0, 0], [1, 1, 0]])
    bl3 = _bl([[1, 1, 0], [0, 1, 0]])
    result = chain_breaklines([bl1, bl2, bl3])
    assert result["loops"] == []
    assert len(result["open_chains"]) == 1
    assert len(result["open_chains"][0]) == 4
    assert len(result["gap_points"]) == 2
    assert result["branch_points"] == []


def test_chain_breaklines_branch_point_stops_in_every_direction():
    # Three breaklines meeting at a single point — an ambiguous 3-way junction.
    bl_a = _bl([[0, 0, 0], [1, 1, 0]])
    bl_b = _bl([[1, 1, 0], [2, 0, 0]])
    bl_c = _bl([[1, 1, 0], [1, 2, 0]])
    result = chain_breaklines([bl_a, bl_b, bl_c])
    assert result["loops"] == []
    assert len(result["open_chains"]) == 3
    assert len(result["branch_points"]) == 1   # deduped — one physical junction
    assert len(result["gap_points"]) == 3      # the three distinct outer dead-ends


def test_chain_breaklines_two_disjoint_closed_loops():
    def square(x0, y0):
        return [
            _bl([[x0, y0, 0], [x0 + 1, y0, 0]]),
            _bl([[x0 + 1, y0, 0], [x0 + 1, y0 + 1, 0]]),
            _bl([[x0 + 1, y0 + 1, 0], [x0, y0 + 1, 0]]),
            _bl([[x0, y0 + 1, 0], [x0, y0, 0]]),
        ]
    result = chain_breaklines(square(0, 0) + square(10, 10))
    assert len(result["loops"]) == 2
    assert result["open_chains"] == []


def test_chain_breaklines_empty_input():
    assert chain_breaklines([]) == {
        "loops": [], "open_chains": [], "gap_points": [], "branch_points": [],
    }
