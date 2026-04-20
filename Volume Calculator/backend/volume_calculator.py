"""
Volume Calculator
Computes cut/fill volumes between two TIN surfaces using grid-based interpolation.
"""

from dataclasses import dataclass
from typing import Tuple
import numpy as np
from scipy.interpolate import LinearNDInterpolator
from scipy.spatial import Delaunay

from landxml_parser import TINSurface


@dataclass
class VolumeResult:
    cut_volume: float       # m³ — material removed (surface1 > surface2)
    fill_volume: float      # m³ — material added   (surface2 > surface1)
    net_volume: float       # cut - fill (positive = net cut)
    grid_x: list            # 1-D x-axis values
    grid_y: list            # 1-D y-axis values
    dz_grid: list           # 2-D list [rows][cols], dz = surf1_z - surf2_z
    mask_grid: list         # 2-D bool — True where both surfaces have data
    grid_resolution: float  # cell side length (m)
    surface1_name: str
    surface2_name: str

    def summary(self) -> dict:
        return {
            "surface1": self.surface1_name,
            "surface2": self.surface2_name,
            "cut_volume_m3": round(self.cut_volume, 3),
            "fill_volume_m3": round(self.fill_volume, 3),
            "net_volume_m3": round(self.net_volume, 3),
            "grid_resolution_m": self.grid_resolution,
            "grid_cols": len(self.grid_x),
            "grid_rows": len(self.grid_y),
        }


def _auto_resolution(surface: TINSurface, max_cells: int = 400) -> float:
    """
    Choose a grid cell size so we get at most max_cells cells in each direction.
    Never smaller than 0.1 m.
    """
    x_span = surface.x_max - surface.x_min
    y_span = surface.y_max - surface.y_min
    span = max(x_span, y_span)
    if span <= 0:
        return 1.0
    res = span / max_cells
    return max(res, 0.1)


def _build_interpolator(surface: TINSurface) -> LinearNDInterpolator:
    """Build a 2-D scipy interpolator for the surface."""
    xy = surface.points[:, :2]
    z = surface.points[:, 2]
    return LinearNDInterpolator(xy, z)


def calculate_volumes(
    surface1: TINSurface,
    surface2: TINSurface,
    grid_resolution: float = None,
) -> VolumeResult:
    """
    Compute cut and fill volumes between surface1 (e.g. existing ground) and
    surface2 (e.g. design surface).

    Convention:
        dz = z_surface1 - z_surface2
        dz > 0  →  surface1 is higher  →  CUT  (remove material)
        dz < 0  →  surface2 is higher  →  FILL (add material)

    Returns a VolumeResult with the volumes and full grid data for visualisation.
    """

    # ---- Build common extent ----
    x_min = max(surface1.x_min, surface2.x_min)
    x_max = min(surface1.x_max, surface2.x_max)
    y_min = max(surface1.y_min, surface2.y_min)
    y_max = min(surface1.y_max, surface2.y_max)

    if x_max <= x_min or y_max <= y_min:
        raise ValueError(
            "The two surfaces do not overlap in plan. "
            "Volume calculation requires overlapping extents."
        )

    # ---- Determine grid resolution ----
    if grid_resolution is None or grid_resolution <= 0:
        res1 = _auto_resolution(surface1)
        res2 = _auto_resolution(surface2)
        grid_resolution = max(res1, res2)

    # ---- Build regular grid ----
    grid_x = np.arange(x_min, x_max + grid_resolution * 0.5, grid_resolution)
    grid_y = np.arange(y_min, y_max + grid_resolution * 0.5, grid_resolution)

    # Cap grid size for performance
    MAX_CELLS = 600
    if len(grid_x) > MAX_CELLS:
        grid_x = np.linspace(x_min, x_max, MAX_CELLS)
        grid_resolution = float(grid_x[1] - grid_x[0])
    if len(grid_y) > MAX_CELLS:
        grid_y = np.linspace(y_min, y_max, MAX_CELLS)

    GX, GY = np.meshgrid(grid_x, grid_y)  # shape (rows, cols)
    pts_flat = np.column_stack([GX.ravel(), GY.ravel()])

    # ---- Interpolate surfaces ----
    interp1 = _build_interpolator(surface1)
    interp2 = _build_interpolator(surface2)

    z1_flat = interp1(pts_flat)
    z2_flat = interp2(pts_flat)

    z1 = z1_flat.reshape(GX.shape)
    z2 = z2_flat.reshape(GX.shape)

    # ---- Mask cells where either surface is undefined (NaN) ----
    valid = (~np.isnan(z1)) & (~np.isnan(z2))

    dz = np.where(valid, z1 - z2, np.nan)   # dz = surf1 - surf2

    cell_area = grid_resolution ** 2  # m²

    # ---- Volume calculation ----
    cut_mask = valid & (dz > 0)
    fill_mask = valid & (dz < 0)

    cut_volume = float(np.sum(dz[cut_mask]) * cell_area)
    fill_volume = float(np.abs(np.sum(dz[fill_mask])) * cell_area)
    net_volume = cut_volume - fill_volume

    return VolumeResult(
        cut_volume=cut_volume,
        fill_volume=fill_volume,
        net_volume=net_volume,
        grid_x=grid_x.tolist(),
        grid_y=grid_y.tolist(),
        dz_grid=np.where(valid, dz, None).tolist(),
        mask_grid=valid.tolist(),
        grid_resolution=grid_resolution,
        surface1_name=surface1.name,
        surface2_name=surface2.name,
    )


def surface_to_mesh(surface: TINSurface, max_faces: int = 20_000) -> dict:
    """
    Convert a TINSurface to a lightweight mesh dict for Three.js rendering.
    Downsamples if the surface has too many faces.
    """
    points = surface.points
    faces = surface.faces

    # Downsample if needed
    if len(faces) > max_faces:
        step = len(faces) // max_faces
        faces = faces[::step]

    return {
        "name": surface.name,
        "vertices": points.tolist(),
        "faces": faces.tolist(),
        "z_min": float(points[:, 2].min()),
        "z_max": float(points[:, 2].max()),
        "x_min": float(points[:, 0].min()),
        "x_max": float(points[:, 0].max()),
        "y_min": float(points[:, 1].min()),
        "y_max": float(points[:, 1].max()),
    }


def compute_section(
    surfaces: list,          # list of TINSurface objects
    x1: float, y1: float,
    x2: float, y2: float,
    num_samples: int = 400,
) -> dict:
    """
    Sample elevation profiles for every surface along a section line
    from (x1,y1) to (x2,y2).

    Returns
    -------
    {
        "distance": [0.0, …, total_length],   # m along the line
        "profiles": { surface_name: [z | null, …] },
        "line": { "x1","y1","x2","y2" }
    }
    """
    num_samples = max(50, min(int(num_samples), 1000))
    t = np.linspace(0.0, 1.0, num_samples)
    xs = x1 + t * (x2 - x1)
    ys = y1 + t * (y2 - y1)
    total_len = float(np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2))
    distances = (t * total_len).tolist()
    pts = np.column_stack([xs, ys])

    profiles: dict = {}
    for surf in surfaces:
        interp = _build_interpolator(surf)
        z_raw = interp(pts)
        profiles[surf.name] = [
            (float(v) if not np.isnan(v) else None) for v in z_raw
        ]

    return {
        "distance":  distances,
        "profiles":  profiles,
        "line":      {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
        "total_length": round(total_len, 3),
    }
