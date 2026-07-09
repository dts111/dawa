"""
Maximum Excavation Profile
Traces, station by station and side by side along a user-supplied corridor
polyline, the excavation extent between a design formation surface (HBXC) and
existing ground (EG), following any intermediate surfaces' real geometry where
present and projecting a user-supplied batter where none exist, then checks
whether each traced path ties into existing ground within a negligible
floating-point tolerance.
"""

import bisect
import math
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

from landxml_parser import TINSurface
from volume_calculator import _build_interpolator
from geometry_utils import FaceGridIndex, build_face_grid_index, nearest_point_on_surface


# ────────────────────────────────────────────────────────────────────────────
# Data model
# ────────────────────────────────────────────────────────────────────────────

@dataclass
class CorridorStation:
    index: int
    chainage: float
    cx: float
    cy: float
    dir_x: float
    dir_y: float
    normal_left_x: float
    normal_left_y: float
    segment_index: int
    is_partial_last: bool = False

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "chainage": round(self.chainage, 4),
            "cx": round(self.cx, 4),
            "cy": round(self.cy, 4),
            "is_partial_last": self.is_partial_last,
        }


@dataclass
class BatterAngle:
    raw_input: str
    angle_deg: float
    run_per_rise: float   # horizontal distance per 1 unit of vertical rise (H:V)


@dataclass
class TracePoint:
    offset: float
    x: float
    y: float
    z: float
    source: str   # "<HBXC name>" | "<intermediate surface name>" | "BATTER"

    def to_dict(self) -> dict:
        return {
            "offset": round(self.offset, 4), "x": round(self.x, 4),
            "y": round(self.y, 4), "z": round(self.z, 4), "source": self.source,
        }


@dataclass
class StationSideResult:
    chainage: float
    side: str   # "L" | "R"
    skipped: bool
    skip_reason: Optional[str]
    needs_batter: bool
    path: List[TracePoint]
    end_point: Optional[Tuple[float, float, float]]
    nearest_eg_point: Optional[Tuple[float, float, float]]
    distance_3d_m: Optional[float]
    tied_in: Optional[bool]
    batter_used: bool
    truncated: bool

    def to_dict(self, include_path: bool = True) -> dict:
        d = {
            "chainage": round(self.chainage, 4),
            "side": self.side,
            "skipped": self.skipped,
            "skip_reason": self.skip_reason,
            "needs_batter": self.needs_batter,
            "end_point": list(self.end_point) if self.end_point is not None else None,
            "distance_3d_mm": round(self.distance_3d_m * 1000, 2) if self.distance_3d_m is not None else None,
            "tied_in": self.tied_in,
            "batter_used": self.batter_used,
            "truncated": self.truncated,
        }
        if include_path:
            d["path"] = [p.to_dict() for p in self.path]
        return d


def _format_chainage(ch: float) -> str:
    km = int(ch // 1000)
    rem = ch - km * 1000
    return f"{km}+{rem:03.0f}"


@dataclass
class ChainageRange:
    side: str
    chainage_start: float
    chainage_end: float
    max_variation_m: float
    avg_variation_m: float
    station_count: int

    def report_line(self) -> str:
        side_label = "left edge" if self.side == "L" else "right edge"
        return (
            f"Ch {_format_chainage(self.chainage_start)}–{_format_chainage(self.chainage_end)}, "
            f"{side_label}: not tied in, max variation {round(self.max_variation_m * 1000)}mm, "
            f"avg {round(self.avg_variation_m * 1000)}mm"
        )

    def to_dict(self) -> dict:
        return {
            "side": self.side,
            "chainage_start": round(self.chainage_start, 3),
            "chainage_end": round(self.chainage_end, 3),
            "max_variation_mm": round(self.max_variation_m * 1000, 2),
            "avg_variation_mm": round(self.avg_variation_m * 1000, 2),
            "station_count": self.station_count,
            "report_line": self.report_line(),
        }


@dataclass
class BatterRequirementCheck:
    required: bool
    stations_checked: int
    affected_count: int
    affected_examples: List[Tuple[float, str]]

    def to_dict(self) -> dict:
        return {
            "batter_required": self.required,
            "stations_checked": self.stations_checked,
            "affected_count": self.affected_count,
            "affected_examples": [{"chainage": round(ch, 3), "side": s} for ch, s in self.affected_examples],
        }


@dataclass
class ExcavationConfig:
    chainage_interval: float
    max_search_distance: float = 50.0
    sample_step: float = 0.25
    tolerance_m: float = 0.001
    batter: Optional[BatterAngle] = None
    resample_points_per_station: int = 20

    def to_dict(self) -> dict:
        return {
            "chainage_interval": self.chainage_interval,
            "max_search_distance": self.max_search_distance,
            "sample_step": self.sample_step,
            "tolerance_mm": round(self.tolerance_m * 1000, 3),
            "batter": (
                {
                    "raw_input": self.batter.raw_input,
                    "angle_deg": round(self.batter.angle_deg, 3),
                    "run_per_rise": round(self.batter.run_per_rise, 4),
                }
                if self.batter else None
            ),
        }


@dataclass
class ExcavationProfileResult:
    stations: List[CorridorStation]
    station_results: List[StationSideResult]
    ranges: List[ChainageRange]
    surface: TINSurface
    config: ExcavationConfig

    def summary(self) -> dict:
        tied = sum(1 for r in self.station_results if r.tied_in)
        untied = sum(1 for r in self.station_results if r.tied_in is False)
        corridor_length = self.stations[-1].chainage if self.stations else 0.0
        return {
            "corridor_length_m": round(corridor_length, 3),
            "station_count": len(self.stations),
            "tied_in_count": tied,
            "untied_count": untied,
            "surface_point_count": len(self.surface.points),
            "surface_face_count": len(self.surface.faces),
        }

    def report_text(self) -> str:
        if not self.ranges:
            return "All traced stations tied into existing ground within tolerance."
        return "\n".join(r.report_line() for r in self.ranges)


# ────────────────────────────────────────────────────────────────────────────
# Batter ratio / angle parsing
# ────────────────────────────────────────────────────────────────────────────

def parse_batter_angle(raw: str) -> BatterAngle:
    """
    Accepts either a H:V ratio (e.g. "1:2" = 1 horizontal : 2 vertical, ~63.4deg,
    the UK highways "1 in 2" convention) or a plain degrees value (e.g. "45").
    Format is auto-detected by presence of a colon.
    """
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Batter angle/ratio input is empty.")

    if ":" in raw:
        h_str, v_str = raw.split(":", 1)
        try:
            h, v = float(h_str), float(v_str)
        except ValueError:
            raise ValueError(f"Invalid batter ratio '{raw}'. Expected e.g. '1:2' (H:V).")
        if h <= 0 or v <= 0:
            raise ValueError("Batter ratio components must be positive.")
        angle_deg = math.degrees(math.atan2(v, h))
        run_per_rise = h / v
    else:
        try:
            angle_deg = float(raw)
        except ValueError:
            raise ValueError(f"Invalid batter angle '{raw}'. Expected e.g. '45' or a ratio like '1:2'.")
        if not (0 < angle_deg < 90):
            raise ValueError("Batter angle in degrees must be between 0 and 90.")
        run_per_rise = 1.0 / math.tan(math.radians(angle_deg))

    return BatterAngle(raw_input=raw, angle_deg=angle_deg, run_per_rise=run_per_rise)


# ────────────────────────────────────────────────────────────────────────────
# Corridor station generation
# ────────────────────────────────────────────────────────────────────────────

def generate_stations(polyline: List[Tuple[float, float]], interval: float) -> List[CorridorStation]:
    """
    Walk a straight-segment polyline at a fixed chainage interval, producing a
    station at each interval plus a final station at the corridor's true end
    (flagged is_partial_last if that segment is shorter than a full interval).
    """
    if interval <= 0:
        raise ValueError("chainage_interval must be positive.")

    pts = [(float(polyline[0][0]), float(polyline[0][1]))]
    for p in polyline[1:]:
        p = (float(p[0]), float(p[1]))
        if math.hypot(p[0] - pts[-1][0], p[1] - pts[-1][1]) > 1e-9:
            pts.append(p)
    if len(pts) < 2:
        raise ValueError("Corridor polyline needs at least 2 distinct vertices.")

    seg_len = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1)]
    cum = [0.0]
    for L in seg_len:
        cum.append(cum[-1] + L)
    total = cum[-1]
    if total <= 0:
        raise ValueError("Corridor polyline has zero length.")

    # np.arange yields numpy.float64 — cast to plain Python float immediately so no
    # numpy scalar (float64 or bool_) leaks into CorridorStation/API responses.
    # (numpy.bool_ in particular fails `is True` identity checks and isn't always
    # JSON-serializable, unlike numpy.float64 which happens to subclass float.)
    chainages = [float(c) for c in np.arange(0.0, total, interval)]
    is_partial = [False] * len(chainages)
    remainder = total - chainages[-1]
    if remainder > 1e-9:
        chainages.append(total)
        is_partial.append(bool(remainder < interval - 1e-6))

    stations = []
    for idx, ch in enumerate(chainages):
        seg = bisect.bisect_right(cum, ch) - 1
        seg = min(max(seg, 0), len(seg_len) - 1)
        seg_start = cum[seg]
        t = 0.0 if seg_len[seg] == 0 else (ch - seg_start) / seg_len[seg]
        t = min(max(t, 0.0), 1.0)
        x0, y0 = pts[seg]
        x1, y1 = pts[seg + 1]
        cx = float(x0 + t * (x1 - x0))
        cy = float(y0 + t * (y1 - y0))
        dx = float((x1 - x0) / seg_len[seg])
        dy = float((y1 - y0) / seg_len[seg])
        stations.append(CorridorStation(
            index=idx, chainage=ch, cx=cx, cy=cy,
            dir_x=dx, dir_y=dy, normal_left_x=-dy, normal_left_y=dx,
            segment_index=seg, is_partial_last=is_partial[idx],
        ))
    return stations


# ────────────────────────────────────────────────────────────────────────────
# Surface-edge search (shared by HBXC edge location and intermediate following)
# ────────────────────────────────────────────────────────────────────────────

def _find_surface_edge(
    interp_fn: Callable, cx: float, cy: float, nx: float, ny: float,
    start_offset: float, cfg: ExcavationConfig,
) -> Tuple[Optional[float], bool]:
    """
    Walk outward from start_offset along the ray (cx,cy) + (nx,ny)*offset,
    sampling interp_fn, and locate the offset where validity (non-NaN)
    transitions to invalid, bisection-refined to sub-mm precision.

    Returns (edge_offset, truncated):
      - edge_offset is None if the surface has no data even at start_offset.
      - truncated is True if the surface stayed valid all the way out to
        max_search_distance without ever going invalid.
    """
    offsets = np.arange(start_offset, cfg.max_search_distance + cfg.sample_step, cfg.sample_step)
    if len(offsets) == 0:
        return start_offset, True

    z = interp_fn(cx + nx * offsets, cy + ny * offsets)
    valid = ~np.isnan(z)

    if not valid[0]:
        return None, False
    if valid.all():
        return float(offsets[-1]), True

    first_invalid = int(np.argmax(~valid))
    lo, hi = offsets[first_invalid - 1], offsets[first_invalid]

    def is_valid(o: float) -> bool:
        zz = interp_fn(np.array([cx + nx * o]), np.array([cy + ny * o]))[0]
        return not np.isnan(zz)

    for _ in range(25):
        mid = (lo + hi) / 2
        if is_valid(mid):
            lo = mid
        else:
            hi = mid

    return float(lo), False


def _project_batter(
    eg_interp: Callable, cx: float, cy: float, nx: float, ny: float,
    start_offset: float, start_z: float, batter: BatterAngle, cfg: ExcavationConfig,
) -> Tuple[float, float, bool]:
    """
    Project a straight batter line z = start_z + (offset-start_offset)/run_per_rise
    outward until it crosses the EG profile sampled along the same ray
    (bisection-refined), or EG's own extent runs out first, or max_search_distance
    is reached. Returns (end_offset, end_z, truncated).
    """
    offsets = np.arange(start_offset, cfg.max_search_distance + cfg.sample_step, cfg.sample_step)
    if len(offsets) == 0:
        return start_offset, start_z, True

    line_z = start_z + (offsets - start_offset) / batter.run_per_rise
    eg_z = eg_interp(cx + nx * offsets, cy + ny * offsets)
    valid = ~np.isnan(eg_z)

    if not valid[0]:
        return float(offsets[0]), float(line_z[0]), False

    f = line_z - eg_z
    crossed = valid & (f >= 0)
    first_invalid = int(np.argmax(~valid)) if (~valid).any() else -1
    first_cross = int(np.argmax(crossed)) if crossed.any() else -1

    def f_at(o: float) -> Optional[float]:
        zz = eg_interp(np.array([cx + nx * o]), np.array([cy + ny * o]))[0]
        if np.isnan(zz):
            return None
        return (start_z + (o - start_offset) / batter.run_per_rise) - zz

    if first_cross != -1 and (first_invalid == -1 or first_cross <= first_invalid):
        lo = offsets[first_cross - 1] if first_cross > 0 else offsets[0]
        hi = offsets[first_cross]
        for _ in range(25):
            mid = (lo + hi) / 2
            mid_f = f_at(mid)
            if mid_f is None or mid_f < 0:
                lo = mid
            else:
                hi = mid
        end_offset = hi
        end_z = start_z + (end_offset - start_offset) / batter.run_per_rise
        return float(end_offset), float(end_z), False

    if first_invalid != -1:
        idx = max(first_invalid - 1, 0)
        end_offset = offsets[idx]
        end_z = start_z + (end_offset - start_offset) / batter.run_per_rise
        return float(end_offset), float(end_z), False

    end_offset = offsets[-1]
    end_z = start_z + (end_offset - start_offset) / batter.run_per_rise
    return float(end_offset), float(end_z), True


# ────────────────────────────────────────────────────────────────────────────
# Per-station-side tracing
# ────────────────────────────────────────────────────────────────────────────

def _trace_station_side(
    hbxc: TINSurface, eg: TINSurface, intermediates: List[TINSurface],
    interp: Dict[str, Callable], eg_index: FaceGridIndex,
    station: CorridorStation, side: str, cfg: ExcavationConfig,
    batter: Optional[BatterAngle],
) -> StationSideResult:
    """
    Trace from the HBXC edge point outward: follow intermediate surfaces'
    actual profile where one governs (auto-detected by elevation), otherwise
    (if `batter` is supplied) project a straight batter line to EG. If `batter`
    is None and a segment has no intermediate coverage, returns immediately
    with needs_batter=True instead of projecting anything — this is what
    powers the contextual "only ask for a batter angle when needed" check.
    """
    if side == "L":
        nx, ny = station.normal_left_x, station.normal_left_y
    else:
        nx, ny = -station.normal_left_x, -station.normal_left_y
    cx, cy = station.cx, station.cy

    hbxc_interp = interp[hbxc.name]
    eg_interp = interp[eg.name]

    edge_offset, truncated = _find_surface_edge(hbxc_interp, cx, cy, nx, ny, 0.0, cfg)
    if edge_offset is None:
        return StationSideResult(
            chainage=station.chainage, side=side, skipped=True,
            skip_reason="HBXC has no data at this station/side", needs_batter=False,
            path=[], end_point=None, nearest_eg_point=None, distance_3d_m=None,
            tied_in=None, batter_used=False, truncated=False,
        )

    z_edge = float(hbxc_interp(np.array([cx + nx * edge_offset]), np.array([cy + ny * edge_offset]))[0])
    path = [TracePoint(offset=edge_offset, x=cx + nx * edge_offset, y=cy + ny * edge_offset, z=z_edge, source=hbxc.name)]

    current_offset, current_z = edge_offset, z_edge
    needs_batter = False
    batter_used = False
    elev_eps = max(cfg.tolerance_m, 1e-4)

    for _ in range(25):
        cx_c, cy_c = cx + nx * current_offset, cy + ny * current_offset

        candidates = []
        for surf in intermediates:
            z_here = float(interp[surf.name](np.array([cx_c]), np.array([cy_c]))[0])
            if not np.isnan(z_here) and z_here >= current_z - elev_eps:
                candidates.append((surf, z_here))

        governed = False
        if candidates:
            governing, _ = min(candidates, key=lambda cz: cz[1])
            gov_interp = interp[governing.name]
            gov_edge_offset, gov_truncated = _find_surface_edge(gov_interp, cx, cy, nx, ny, current_offset, cfg)
            if gov_edge_offset is not None and gov_edge_offset > current_offset + 1e-9:
                governed = True
                sample_offsets = np.arange(current_offset, gov_edge_offset, cfg.sample_step)
                if len(sample_offsets) == 0 or sample_offsets[-1] < gov_edge_offset - 1e-9:
                    sample_offsets = np.append(sample_offsets, gov_edge_offset)
                zs = gov_interp(cx + nx * sample_offsets, cy + ny * sample_offsets)
                for o, z in zip(sample_offsets, zs):
                    if o <= current_offset + 1e-9 or np.isnan(z):
                        continue
                    path.append(TracePoint(offset=float(o), x=float(cx + nx * o), y=float(cy + ny * o), z=float(z), source=governing.name))
                current_offset = gov_edge_offset
                current_z = float(gov_interp(np.array([cx + nx * current_offset]), np.array([cy + ny * current_offset]))[0])
                truncated = truncated or gov_truncated

        if governed:
            continue

        eg_z_here = float(eg_interp(np.array([cx_c]), np.array([cy_c]))[0])
        if not np.isnan(eg_z_here) and abs(eg_z_here - current_z) <= cfg.tolerance_m:
            break   # already tied in at this point, no batter needed

        if batter is None:
            needs_batter = True
            break

        batter_used = True
        end_offset, end_z, batter_truncated = _project_batter(
            eg_interp, cx, cy, nx, ny, current_offset, current_z, batter, cfg,
        )
        path.append(TracePoint(offset=end_offset, x=cx + nx * end_offset, y=cy + ny * end_offset, z=end_z, source="BATTER"))
        current_offset, current_z = end_offset, end_z
        truncated = truncated or batter_truncated
        break
    else:
        truncated = True   # exceeded intermediate-hop safety cap without resolving

    if needs_batter:
        return StationSideResult(
            chainage=station.chainage, side=side, skipped=False, skip_reason=None,
            needs_batter=True, path=path, end_point=None, nearest_eg_point=None,
            distance_3d_m=None, tied_in=None, batter_used=False, truncated=truncated,
        )

    end_point = (cx + nx * current_offset, cy + ny * current_offset, current_z)
    nearest_pt, dist = nearest_point_on_surface(eg_index, np.array(end_point))
    tied_in = dist <= cfg.tolerance_m

    return StationSideResult(
        chainage=station.chainage, side=side, skipped=False, skip_reason=None,
        needs_batter=False, path=path, end_point=end_point,
        nearest_eg_point=tuple(nearest_pt.tolist()), distance_3d_m=dist,
        tied_in=tied_in, batter_used=batter_used, truncated=truncated,
    )


# ────────────────────────────────────────────────────────────────────────────
# Batter-requirement pre-check
# ────────────────────────────────────────────────────────────────────────────

def detect_batter_requirement(
    hbxc: TINSurface, eg: TINSurface, intermediates: List[TINSurface],
    stations: List[CorridorStation], cfg: ExcavationConfig,
) -> BatterRequirementCheck:
    """
    Runs the tracer with batter=None across every station/side and collects
    which ones would need one, without ever prompting for or applying an angle.
    """
    interp = {s.name: _build_interpolator(s) for s in [hbxc, eg] + intermediates}
    eg_index = build_face_grid_index(eg)

    affected: List[Tuple[float, str]] = []
    checked = 0
    for station in stations:
        for side in ("L", "R"):
            checked += 1
            result = _trace_station_side(hbxc, eg, intermediates, interp, eg_index, station, side, cfg, batter=None)
            if result.needs_batter:
                affected.append((station.chainage, side))

    return BatterRequirementCheck(
        required=len(affected) > 0, stations_checked=checked,
        affected_count=len(affected), affected_examples=affected[:20],
    )


# ────────────────────────────────────────────────────────────────────────────
# Chainage-range grouping
# ────────────────────────────────────────────────────────────────────────────

def _finalize_range(side: str, run: List[StationSideResult]) -> ChainageRange:
    variations = [r.distance_3d_m for r in run if r.distance_3d_m is not None]
    max_var = max(variations) if variations else 0.0
    avg_var = (sum(variations) / len(variations)) if variations else 0.0
    return ChainageRange(
        side=side, chainage_start=run[0].chainage, chainage_end=run[-1].chainage,
        max_variation_m=max_var, avg_variation_m=avg_var, station_count=len(run),
    )


def _group_chainage_ranges(station_results: List[StationSideResult], tolerance_m: float) -> List[ChainageRange]:
    """
    Merges CONSECUTIVE (by station adjacency, not numeric chainage proximity)
    untied/skipped stations per side into ranges. A tied-in station between two
    untied ones splits them into two separate ranges.
    """
    ranges = []
    for side in ("L", "R"):
        side_results = [r for r in station_results if r.side == side]
        run: List[StationSideResult] = []
        for r in side_results:
            unresolved = r.skipped or r.tied_in is False
            if unresolved:
                run.append(r)
            else:
                if run:
                    ranges.append(_finalize_range(side, run))
                    run = []
        if run:
            ranges.append(_finalize_range(side, run))
    return ranges


# ────────────────────────────────────────────────────────────────────────────
# Excavation surface rebuild
# ────────────────────────────────────────────────────────────────────────────

def _resample_path(path: List[TracePoint], n: int) -> List[Tuple[float, float, float]]:
    pts = np.array([[p.x, p.y, p.z] for p in path], dtype=np.float64)
    if len(pts) == 1:
        return [tuple(pts[0])] * n
    seg_d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg_d)])
    total = cum[-1]
    if total <= 0:
        return [tuple(pts[0])] * n
    targets = np.linspace(0.0, total, n)
    xs = np.interp(targets, cum, pts[:, 0])
    ys = np.interp(targets, cum, pts[:, 1])
    zs = np.interp(targets, cum, pts[:, 2])
    return list(zip(xs.tolist(), ys.tolist(), zs.tolist()))


def build_excavation_surface(station_results: List[StationSideResult], cfg: ExcavationConfig) -> TINSurface:
    """
    Rebuilds a TIN from all successfully tied-in station/side paths, stitching
    only ADJACENT qualifying stations into triangulated strips per side.
    Untied/skipped stations contribute no strip — this IS the "leave gaps,
    don't interpolate over them" requirement, not a limitation to work around.
    Left and right sides are stitched independently (not connected across the
    centreline) — a deliberate v1 scope limit.
    """
    all_points: List[Tuple[float, float, float]] = []
    all_faces: List[Tuple[int, int, int]] = []

    for side in ("L", "R"):
        side_results = [r for r in station_results if r.side == side]
        prev_indices: Optional[List[int]] = None
        for r in side_results:
            if r.skipped or r.tied_in is not True or not r.path:
                prev_indices = None
                continue

            resampled = _resample_path(r.path, cfg.resample_points_per_station)
            start_idx = len(all_points)
            all_points.extend(resampled)
            cur_indices = list(range(start_idx, start_idx + len(resampled)))

            if prev_indices is not None and len(prev_indices) == len(cur_indices):
                n = len(cur_indices)
                for i in range(n - 1):
                    a, b = prev_indices[i], prev_indices[i + 1]
                    c, d = cur_indices[i], cur_indices[i + 1]
                    all_faces.append((a, b, c))
                    all_faces.append((b, d, c))
            prev_indices = cur_indices

    if not all_points:
        raise ValueError("No tied-in stations available to build an excavation surface.")

    points_arr = np.array(all_points, dtype=np.float64)
    faces_arr = np.array(all_faces, dtype=np.int32) if all_faces else np.zeros((0, 3), dtype=np.int32)

    return TINSurface(
        name="Excavation Profile", desc="Auto-generated maximum excavation profile",
        points=points_arr, faces=faces_arr,
    )


# ────────────────────────────────────────────────────────────────────────────
# Orchestration
# ────────────────────────────────────────────────────────────────────────────

def compute_excavation_profile(
    hbxc: TINSurface, eg: TINSurface, intermediates: List[TINSurface],
    polyline: List[Tuple[float, float]], cfg: ExcavationConfig,
) -> ExcavationProfileResult:
    if hbxc.name == eg.name:
        raise ValueError("HBXC and EG must be different surfaces.")

    stations = generate_stations(polyline, cfg.chainage_interval)

    interp = {s.name: _build_interpolator(s) for s in [hbxc, eg] + intermediates}
    eg_index = build_face_grid_index(eg)

    station_results: List[StationSideResult] = []
    for station in stations:
        for side in ("L", "R"):
            result = _trace_station_side(hbxc, eg, intermediates, interp, eg_index, station, side, cfg, batter=cfg.batter)
            if result.needs_batter and cfg.batter is None:
                side_label = "left" if side == "L" else "right"
                raise ValueError(
                    f"Batter angle required but not supplied "
                    f"(Ch {_format_chainage(station.chainage)}, {side_label} side has no intermediate coverage)."
                )
            station_results.append(result)

    ranges = _group_chainage_ranges(station_results, cfg.tolerance_m)
    surface = build_excavation_surface(station_results, cfg)

    return ExcavationProfileResult(
        stations=stations, station_results=station_results, ranges=ranges,
        surface=surface, config=cfg,
    )
