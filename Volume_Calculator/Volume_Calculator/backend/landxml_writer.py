"""
LandXML Writer
Serializes a TINSurface back to LandXML bytes. Mirrors landxml_parser.py's
conventions in reverse: point text is northing-easting-elevation (Y X Z) order,
and face point references are 1-based ids.
"""

from lxml import etree

from landxml_parser import TINSurface, LANDXML_NAMESPACES

_NS = LANDXML_NAMESPACES[0]  # "http://www.landxml.org/schema/LandXML-1.2"


def _q(tag: str) -> str:
    """Namespace-qualify a tag so every element shares the root's default namespace —
    required for parse_landxml_bytes()'s namespace-aware element lookups to find them."""
    return f"{{{_NS}}}{tag}"


def write_landxml_surface(surface: TINSurface, project_name: str = "Excavation Profile Export") -> bytes:
    """
    Serialize a TINSurface to a LandXML 1.2 document (bytes, UTF-8, pretty-printed).
    The output is round-trip compatible with parse_landxml_bytes().
    """
    root = etree.Element(_q("LandXML"), nsmap={None: _NS})
    root.set("version", "1.2")

    units = etree.SubElement(root, _q("Units"))
    etree.SubElement(units, _q("Metric"),
                      linearUnit="meter", areaUnit="squareMeter",
                      volumeUnit="cubicMeter", temperatureUnit="celsius",
                      pressureUnit="mmHG")

    etree.SubElement(root, _q("Project"), name=project_name)

    surfaces_el = etree.SubElement(root, _q("Surfaces"))
    surface_el = etree.SubElement(surfaces_el, _q("Surface"), name=surface.name, desc=surface.desc or "")
    definition_el = etree.SubElement(surface_el, _q("Definition"), surfType="TIN")

    pnts_el = etree.SubElement(definition_el, _q("Pnts"))
    for i, (x, y, z) in enumerate(surface.points):
        p_el = etree.SubElement(pnts_el, _q("P"), id=str(i + 1))
        # Reverse of _parse_point_text: LandXML order is northing(Y) easting(X) elevation(Z)
        p_el.text = f"{y:.4f} {x:.4f} {z:.4f}"

    faces_el = etree.SubElement(definition_el, _q("Faces"))
    for a, b, c in surface.faces:
        f_el = etree.SubElement(faces_el, _q("F"))
        # Reverse of the parser's zero-based index resolution: emit 1-based point ids
        f_el.text = f"{int(a) + 1} {int(b) + 1} {int(c) + 1}"

    return etree.tostring(root, pretty_print=True, xml_declaration=True, encoding="UTF-8")
