import math

import numpy as np
import pytest
from lxml import etree

from conftest import build_grid_surface
from excavation_profile import (
    ExcavationConfig, StationSideResult,
    generate_stations, parse_batter_angle, _find_surface_edge, _trace_station_side,
    detect_batter_requirement, _group_chainage_ranges, compute_excavation_profile,
)
from volume_calculator import _build_interpolator
from geometry_utils import build_face_grid_index
from landxml_parser import parse_landxml_bytes
from landxml_writer import _NS, _q


# ────────────────────────────────────────────────────────────────────────────
# Corridor station generation
# ────────────────────────────────────────────────────────────────────────────

def test_generate_stations_basic(polyline):
    stations = generate_stations(polyline, 10.0)
    assert len(stations) == 11
    assert [round(s.chainage, 1) for s in stations] == [float(i * 10) for i in range(11)]
    for s in stations:
        assert abs(s.dir_x - 1.0) < 1e-9 and abs(s.dir_y - 0.0) < 1e-9
        assert abs(s.normal_left_x - 0.0) < 1e-9 and abs(s.normal_left_y - 1.0) < 1e-9


def test_generate_stations_partial_last():
    poly = [(0.0, 0.0), (95.0, 0.0)]
    stations = generate_stations(poly, 10.0)
    chainages = [round(s.chainage, 3) for s in stations]
    assert chainages[:-1] == [0.0, 10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0]
    assert chainages[-1] == 95.0
    assert stations[-1].is_partial_last is True
    assert all(not s.is_partial_last for s in stations[:-1])


def test_generate_stations_requires_positive_interval(polyline):
    with pytest.raises(ValueError):
        generate_stations(polyline, 0.0)


def test_generate_stations_requires_two_distinct_vertices():
    with pytest.raises(ValueError):
        generate_stations([(0.0, 0.0), (0.0, 0.0)], 10.0)


# ────────────────────────────────────────────────────────────────────────────
# Batter angle/ratio parsing
# ────────────────────────────────────────────────────────────────────────────

def test_batter_angle_parsing_ratio():
    b = parse_batter_angle("1:2")
    assert abs(b.run_per_rise - 0.5) < 1e-9
    assert abs(b.angle_deg - math.degrees(math.atan2(2, 1))) < 1e-9


def test_batter_angle_parsing_degrees():
    b = parse_batter_angle("45")
    assert abs(b.run_per_rise - 1.0) < 1e-9
    assert abs(b.angle_deg - 45.0) < 1e-9


@pytest.mark.parametrize("raw", ["0:5", "95", "abc", "", "1:0", "-1:2", "0"])
def test_batter_angle_parsing_invalid(raw):
    with pytest.raises(ValueError):
        parse_batter_angle(raw)


# ────────────────────────────────────────────────────────────────────────────
# Surface edge detection
# ────────────────────────────────────────────────────────────────────────────

def test_find_surface_edge_hbxc(hbxc_surface):
    interp = _build_interpolator(hbxc_surface)
    cfg = ExcavationConfig(chainage_interval=10.0, max_search_distance=10.0, sample_step=0.1, tolerance_m=0.001)

    edge_offset, truncated = _find_surface_edge(interp, 50.0, 0.0, 0.0, 1.0, 0.0, cfg)
    assert edge_offset is not None
    assert abs(edge_offset - 3.0) < 0.005
    assert truncated is False


# ────────────────────────────────────────────────────────────────────────────
# Intermediate-following vs. batter fallback
# ────────────────────────────────────────────────────────────────────────────

def test_trace_follows_intermediate_surface(hbxc_surface, capping_surface, eg_surface, polyline, base_cfg_kwargs):
    stations = generate_stations(polyline, 10.0)
    station40 = next(s for s in stations if abs(s.chainage - 40.0) < 1e-6)

    interp = {s.name: _build_interpolator(s) for s in [hbxc_surface, eg_surface, capping_surface]}
    eg_index = build_face_grid_index(eg_surface)
    batter = parse_batter_angle("1:1")
    cfg = ExcavationConfig(batter=batter, **base_cfg_kwargs)

    result = _trace_station_side(
        hbxc_surface, eg_surface, [capping_surface], interp, eg_index, station40, "L", cfg, batter=batter,
    )

    sources = {p.source for p in result.path}
    assert "CAPPING" in sources
    for p in result.path:
        if p.source == "CAPPING":
            assert abs(p.z - 0.1 * (p.offset - 3.0)) < 0.01


def test_trace_uses_batter_when_no_intermediate(hbxc_surface, eg_surface, polyline, base_cfg_kwargs):
    stations = generate_stations(polyline, 10.0)
    station90 = next(s for s in stations if abs(s.chainage - 90.0) < 1e-6)

    interp = {s.name: _build_interpolator(s) for s in [hbxc_surface, eg_surface]}
    eg_index = build_face_grid_index(eg_surface)
    batter = parse_batter_angle("1:1")
    cfg = ExcavationConfig(batter=batter, **base_cfg_kwargs)

    result = _trace_station_side(
        hbxc_surface, eg_surface, [], interp, eg_index, station90, "L", cfg, batter=batter,
    )

    assert result.path[-1].source == "BATTER"
    assert result.tied_in is True
    assert result.distance_3d_m <= cfg.tolerance_m


def test_batter_requirement_governed_side_not_flagged():
    # A dedicated small fixture where the intermediate's own profile lands
    # exactly on EG's elevation at its edge -> the left side never needs a
    # batter, while the right side (no intermediate, no EG data at all) always does.
    hbxc2 = build_grid_surface("HBXC2", np.arange(0, 21, 5.0), np.array([-1.0, 1.0]), lambda x, y: 0.0)
    ramp = build_grid_surface("RAMP", np.arange(0, 21, 5.0), np.array([1.0, 3.0]), lambda x, y: 0.5 * (y - 1.0))
    eg2 = build_grid_surface("EG2", np.arange(0, 21, 5.0), np.array([1.0, 10.0]), lambda x, y: 1.0)

    poly = [(0.0, 0.0), (20.0, 0.0)]
    cfg = ExcavationConfig(chainage_interval=5.0, max_search_distance=20.0, sample_step=0.1, tolerance_m=0.001)
    stations = generate_stations(poly, 5.0)

    check = detect_batter_requirement(hbxc2, eg2, [ramp], stations, cfg)

    affected = {(round(ch, 1), side) for ch, side in check.affected_examples}
    for s in stations:
        assert (round(s.chainage, 1), "L") not in affected
        assert (round(s.chainage, 1), "R") in affected


# ────────────────────────────────────────────────────────────────────────────
# Chainage-range grouping
# ────────────────────────────────────────────────────────────────────────────

def _mk_result(chainage, side, tied, dist_mm=None):
    dist_m = (dist_mm / 1000.0) if dist_mm is not None else (0.0 if tied else 0.05)
    return StationSideResult(
        chainage=chainage, side=side, skipped=False, skip_reason=None, needs_batter=False,
        path=[], end_point=(0.0, 0.0, 0.0), nearest_eg_point=(0.0, 0.0, 0.0),
        distance_3d_m=dist_m, tied_in=tied, batter_used=False, truncated=False,
    )


def test_chainage_range_grouping_merges_consecutive():
    results = [
        _mk_result(0, "R", True), _mk_result(10, "R", False, 50),
        _mk_result(20, "R", False, 80), _mk_result(30, "R", True),
    ]
    ranges = _group_chainage_ranges(results, tolerance_m=0.001)
    assert len(ranges) == 1
    r = ranges[0]
    assert r.chainage_start == 10 and r.chainage_end == 20
    assert abs(r.max_variation_m - 0.08) < 1e-9
    assert abs(r.avg_variation_m - 0.065) < 1e-9


def test_chainage_range_grouping_does_not_over_merge():
    results = [
        _mk_result(0, "R", True), _mk_result(10, "R", False, 50), _mk_result(20, "R", True),
        _mk_result(30, "R", False, 60), _mk_result(40, "R", True),
    ]
    ranges = _group_chainage_ranges(results, tolerance_m=0.001)
    assert len(ranges) == 2
    assert ranges[0].chainage_start == 10 and ranges[0].chainage_end == 10
    assert ranges[1].chainage_start == 30 and ranges[1].chainage_end == 30


# ────────────────────────────────────────────────────────────────────────────
# Full pipeline: the deliberate tie-in gap
# ────────────────────────────────────────────────────────────────────────────

def test_tie_in_gap_detected_at_known_range(hbxc_surface, capping_surface, eg_surface, polyline, base_cfg_kwargs):
    cfg = ExcavationConfig(batter=parse_batter_angle("1:1"), **base_cfg_kwargs)
    result = compute_excavation_profile(hbxc_surface, eg_surface, [capping_surface], polyline, cfg)

    r_ranges = [r for r in result.ranges if r.side == "R"]
    assert len(r_ranges) == 1
    rng = r_ranges[0]
    assert rng.chainage_start <= 70 and rng.chainage_end >= 80
    assert rng.max_variation_m > 0.1

    assert [r for r in result.ranges if r.side == "L"] == []

    for r in result.station_results:
        if r.side == "R" and r.chainage not in (70.0, 80.0):
            assert r.tied_in is True
            assert r.distance_3d_m <= cfg.tolerance_m


def test_build_excavation_surface_leaves_gap(hbxc_surface, capping_surface, eg_surface, polyline, base_cfg_kwargs):
    cfg = ExcavationConfig(batter=parse_batter_angle("1:1"), **base_cfg_kwargs)
    result = compute_excavation_profile(hbxc_surface, eg_surface, [capping_surface], polyline, cfg)

    n = cfg.resample_points_per_station
    expected_l = (11 - 1) * (n - 1) * 2                          # one unbroken run, 11 stations
    expected_r = (7 - 1) * (n - 1) * 2 + (2 - 1) * (n - 1) * 2    # gap splits into runs of 7 and 2 stations

    assert len(result.surface.faces) == expected_l + expected_r


# ────────────────────────────────────────────────────────────────────────────
# End-to-end from real LandXML bytes
# ────────────────────────────────────────────────────────────────────────────

def _combine_surfaces_to_landxml(surfaces) -> bytes:
    """Test-only helper: writes several surfaces into one LandXML document,
    reusing landxml_writer's namespace-qualification helper directly."""
    root = etree.Element(_q("LandXML"), nsmap={None: _NS})
    root.set("version", "1.2")
    units = etree.SubElement(root, _q("Units"))
    etree.SubElement(units, _q("Metric"), linearUnit="meter", areaUnit="squareMeter",
                      volumeUnit="cubicMeter", temperatureUnit="celsius", pressureUnit="mmHG")
    etree.SubElement(root, _q("Project"), name="Combined Test Surfaces")
    surfaces_el = etree.SubElement(root, _q("Surfaces"))
    for surface in surfaces:
        surface_el = etree.SubElement(surfaces_el, _q("Surface"), name=surface.name, desc=surface.desc or "")
        definition_el = etree.SubElement(surface_el, _q("Definition"), surfType="TIN")
        pnts_el = etree.SubElement(definition_el, _q("Pnts"))
        for i, (x, y, z) in enumerate(surface.points):
            p_el = etree.SubElement(pnts_el, _q("P"), id=str(i + 1))
            p_el.text = f"{y:.4f} {x:.4f} {z:.4f}"
        faces_el = etree.SubElement(definition_el, _q("Faces"))
        for a, b, c in surface.faces:
            f_el = etree.SubElement(faces_el, _q("F"))
            f_el.text = f"{int(a) + 1} {int(b) + 1} {int(c) + 1}"
    return etree.tostring(root, pretty_print=True, xml_declaration=True, encoding="UTF-8")


def test_end_to_end_from_landxml_bytes(hbxc_surface, capping_surface, eg_surface, polyline, base_cfg_kwargs):
    xml_bytes = _combine_surfaces_to_landxml([hbxc_surface, capping_surface, eg_surface])
    parsed = parse_landxml_bytes(xml_bytes)
    surf_map = {s.name: s for s in parsed}

    cfg = ExcavationConfig(batter=parse_batter_angle("1:1"), **base_cfg_kwargs)
    result = compute_excavation_profile(surf_map["HBXC"], surf_map["EG"], [surf_map["CAPPING"]], polyline, cfg)

    r_ranges = [r for r in result.ranges if r.side == "R"]
    assert len(r_ranges) == 1
    assert r_ranges[0].chainage_start <= 70 and r_ranges[0].chainage_end >= 80
