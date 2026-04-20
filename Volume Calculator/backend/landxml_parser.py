"""
LandXML Parser
Extracts TIN surface data from LandXML files (v1.1 and v1.2).
"""

import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
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

    def __post_init__(self):
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


def _parse_surfaces(root: etree._Element, ns: str) -> List[TINSurface]:
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

        surfaces.append(TINSurface(
            name=name,
            desc=desc,
            points=points_arr,
            faces=faces_arr,
        ))

    return surfaces


def parse_landxml_bytes(data: bytes) -> List[TINSurface]:
    """
    Parse a LandXML file from raw bytes.
    Returns a list of TINSurface objects.
    Raises ValueError on invalid or unsupported files.
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

    surfaces = _parse_surfaces(root, ns)
    if not surfaces:
        raise ValueError(
            "No valid TIN surfaces found in this LandXML file. "
            "Ensure the file contains <Surfaces><Surface surfType='TIN'> elements."
        )

    return surfaces
