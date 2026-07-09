import numpy as np

from landxml_parser import TINSurface, parse_landxml_bytes
from landxml_writer import write_landxml_surface


def test_write_landxml_surface_roundtrip():
    pts = np.array([[0, 0, 1], [10, 0, 2], [0, 10, 3], [10, 10, 4]], dtype=float)
    faces = np.array([[0, 1, 2], [1, 3, 2]], dtype=np.int32)
    surf = TINSurface(name="RoundTripSurf", desc="round trip test", points=pts, faces=faces)

    xml_bytes = write_landxml_surface(surf, project_name="Test Project")
    parsed = parse_landxml_bytes(xml_bytes)

    assert len(parsed) == 1
    result = parsed[0]
    assert result.name == "RoundTripSurf"
    assert result.desc == "round trip test"
    assert np.allclose(result.points, pts, atol=1e-4)
    assert np.array_equal(result.faces, faces)


def test_write_landxml_surface_roundtrip_with_grid(eg_surface):
    xml_bytes = write_landxml_surface(eg_surface, project_name="Grid Surface Export")
    parsed = parse_landxml_bytes(xml_bytes)

    assert len(parsed) == 1
    result = parsed[0]
    assert result.name == eg_surface.name
    assert len(result.points) == len(eg_surface.points)
    assert len(result.faces) == len(eg_surface.faces)
    assert np.allclose(np.sort(result.points, axis=0), np.sort(eg_surface.points, axis=0), atol=1e-3)
