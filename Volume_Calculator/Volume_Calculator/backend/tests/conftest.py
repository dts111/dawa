import os
import sys

# Ensure the flat `backend/` module layout (landxml_parser, volume_calculator, ...)
# is importable regardless of pytest's rootdir/import-mode.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pytest

from landxml_parser import TINSurface


def build_grid_surface(name, x_vals, y_vals, z_func, exclude_func=None):
    """
    Build a ruled-grid TIN surface for tests. `exclude_func(x, y) -> bool`
    omits a grid point (and any quad touching it), producing a deliberate hole.
    """
    exclude_func = exclude_func or (lambda x, y: False)
    idx_map = {}
    points = []
    for xi, x in enumerate(x_vals):
        for yi, y in enumerate(y_vals):
            if exclude_func(x, y):
                continue
            idx_map[(xi, yi)] = len(points)
            points.append((x, y, z_func(x, y)))

    faces = []
    for xi in range(len(x_vals) - 1):
        for yi in range(len(y_vals) - 1):
            keys = [(xi, yi), (xi + 1, yi), (xi, yi + 1), (xi + 1, yi + 1)]
            if all(k in idx_map for k in keys):
                a, b, c, d = (idx_map[k] for k in keys)
                faces.append((a, b, c))
                faces.append((b, d, c))

    return TINSurface(
        name=name, desc="", points=np.array(points, dtype=np.float64),
        faces=np.array(faces, dtype=np.int32),
    )


# ── Shared fixture geometry ──────────────────────────────────────────────────
# Centreline along +x, chainage 0-100. normal_left=(0,1) => "L"=+y offset, "R"=-y offset.
#   HBXC:    flat z=0, full corridor, offset +/-3m.
#   CAPPING: real sloped gradient z=0.1*(offset-3), present ONLY chainage 20-60,
#            offset 3-5m, and ONLY on the left side (+y) — tests intermediate-
#            following vs. batter fallback on opposite sides.
#   EG:      z=0.3*|offset|, full corridor, EXCEPT a deliberate coverage gap at
#            chainage 70-80 on the right side (y<0) — the known untied range.

def _hbxc_z(x, y):
    return 0.0


def _capping_z(x, y):
    return 0.1 * (y - 3.0)


def _eg_z(x, y):
    return 0.3 * abs(y)


def _eg_exclude(x, y):
    return 70 <= x <= 80 and y < 0


@pytest.fixture
def hbxc_surface():
    return build_grid_surface("HBXC", np.arange(0, 101, 5.0), np.array([-3.0, 3.0]), _hbxc_z)


@pytest.fixture
def capping_surface():
    return build_grid_surface("CAPPING", np.arange(20, 61, 5.0), np.array([3.0, 5.0]), _capping_z)


@pytest.fixture
def eg_surface():
    return build_grid_surface(
        "EG", np.arange(0, 101, 5.0), np.arange(-20, 21, 2.0), _eg_z, exclude_func=_eg_exclude,
    )


@pytest.fixture
def polyline():
    return [(0.0, 0.0), (100.0, 0.0)]


@pytest.fixture
def base_cfg_kwargs():
    return dict(chainage_interval=10.0, max_search_distance=30.0, sample_step=0.25, tolerance_m=0.001)
