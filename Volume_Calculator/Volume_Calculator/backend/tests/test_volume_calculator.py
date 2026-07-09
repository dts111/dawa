import numpy as np

from conftest import build_grid_surface
from landxml_parser import TINSurface
from volume_calculator import _build_interpolator, calculate_volumes


def _l_shape_surface(name, z=0.0):
    """20x20 square with a 10x10 notch removed from the top-right corner (x>=10, y>=10)."""
    return build_grid_surface(
        name, np.arange(0, 21, 5.0), np.arange(0, 21, 5.0),
        z_func=lambda x, y: z,
        exclude_func=lambda x, y: x >= 10 and y >= 10,
    )


def test_interpolator_masks_concave_notch():
    surf = _l_shape_surface("L_SHAPE")
    interp = _build_interpolator(surf)

    # Deep inside the deliberately-removed notch — must be NaN, not interpolated
    # across the phantom convex-hull triangle that would otherwise fill it in.
    z_notch = interp(np.array([12.0]), np.array([12.0]))[0]
    assert np.isnan(z_notch)

    # Points genuinely within the true L-shaped footprint stay valid.
    for qx, qy in [(5.0, 5.0), (18.0, 2.0), (2.0, 18.0)]:
        z = interp(np.array([qx]), np.array([qy]))[0]
        assert not np.isnan(z)


def test_interpolator_falls_back_gracefully_on_duplicate_points():
    # A duplicate (x,y) point referenced by a face — the real-faces boundary
    # triangulation can't be built from this, but the interpolator must not crash.
    pts = np.array([[0, 0, 1.0], [10, 0, 2.0], [0, 10, 3.0], [10, 10, 4.0], [0, 0, 1.0]], dtype=float)
    faces = np.array([[0, 1, 2], [1, 3, 2], [4, 1, 2]], dtype=np.int32)
    surf = TINSurface(name="DUP", desc="", points=pts, faces=faces)

    interp = _build_interpolator(surf)
    z = interp(np.array([5.0]), np.array([2.0]))[0]
    assert not np.isnan(z)


def test_calculate_volumes_excludes_notch_from_mask():
    surf1 = _l_shape_surface("L_SHAPE_EG", z=0.0)
    surf2 = _l_shape_surface("L_SHAPE_DESIGN", z=-1.0)

    result = calculate_volumes(surf1, surf2, grid_resolution=1.0)

    grid_x = np.array(result.grid_x)
    grid_y = np.array(result.grid_y)
    mask = np.array(result.mask_grid)

    # Find a grid cell whose centre falls inside the removed notch (x>=10, y>=10,
    # well clear of the diagonal boundary) and assert it's excluded from the mask.
    ix = np.argmin(np.abs(grid_x - 15.0))
    iy = np.argmin(np.abs(grid_y - 15.0))
    assert mask[iy, ix] == False  # noqa: E712 — explicit bool compare reads clearer here

    # A cell well within the true footprint should be included.
    ix2 = np.argmin(np.abs(grid_x - 5.0))
    iy2 = np.argmin(np.abs(grid_y - 5.0))
    assert mask[iy2, ix2] == True  # noqa: E712
