"""Venue import and graph construction.

Per D6 the structure is imported before the event and refined by observation
after it. This package does the import: OSM geometry in, CircuitPack out, with
provenance attached to every value so the router can tell a measured width from
an assumed one.
"""

from .frame import Frame, point_to_segment_distance, polyline_length, segments_intersect
from .osm import ElementKind, OsmNode, OsmWay, parse, summarise, width_for
from .build import BuildStats, build_pack, simplify

__all__ = [
    "Frame", "point_to_segment_distance", "polyline_length", "segments_intersect",
    "ElementKind", "OsmNode", "OsmWay", "parse", "summarise", "width_for",
    "BuildStats", "build_pack", "simplify",
]
