"""OpenStreetMap parsing and classification.

Pure: takes already-fetched Overpass JSON and returns typed geometry. Fetching is
an adapter's job (packages/cli), because core does no I/O.

The classification here is the whole reason the venue is importable rather than
traceable by hand. OSM already tags what we need at a major circuit:
grandstands, gates, parking, footways — and, critically, barriers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from crowdflow_contracts import Provenance, Sourced, ZoneKind

# --------------------------------------------------------------------------
# Which OSM highway values carry pedestrians.
#
# service/track/residential are included because at a circuit the access roads
# ARE the concourses on an event day — they carry spectators, not cars.
# --------------------------------------------------------------------------

WALKABLE_HIGHWAY = {
    "footway", "path", "pedestrian", "steps",
    "service", "track", "cycleway", "living_street",
    "residential", "unclassified",
}

BARRIER_VALUES = {"fence", "wall", "hedge", "retaining_wall", "guard_rail", "kerb"}
"""Barriers define where people CANNOT go. A graph built from paths alone will
happily route someone through a fence."""

PERMEABLE_BARRIER = {"gate", "entrance", "stile", "cycle_barrier", "kissing_gate"}
"""Barrier tags that are openings rather than obstructions."""


# --------------------------------------------------------------------------
# Default corridor widths.
#
# ASSUMED, and tagged as such. Flow rate is per metre of width, so a width is
# required to compute a LOS band at all — but an assumed width must never
# masquerade as a measured one. These are superseded by an OSM `width` tag where
# present, and by observation once the venue has been walked.
# --------------------------------------------------------------------------

DEFAULT_WIDTH_M = {
    "footway": 2.0,
    "path": 1.5,
    "pedestrian": 6.0,
    "steps": 1.8,
    "cycleway": 2.5,
    "service": 4.5,
    "track": 3.5,
    "living_street": 5.0,
    "residential": 5.5,
    "unclassified": 5.0,
}
FALLBACK_WIDTH_M = 3.0


class ElementKind(str, Enum):
    WALKABLE = "walkable"
    BARRIER = "barrier"
    GRANDSTAND = "grandstand"
    PARKING = "parking"
    GATE = "gate"
    CROSSING = "crossing"
    IGNORED = "ignored"


@dataclass(frozen=True)
class OsmWay:
    osm_id: int
    kind: ElementKind
    coords: list[tuple[float, float]]  # (lat, lon)
    tags: dict[str, str] = field(default_factory=dict)

    @property
    def name(self) -> str | None:
        return self.tags.get("name")

    @property
    def is_closed(self) -> bool:
        return len(self.coords) > 2 and self.coords[0] == self.coords[-1]


@dataclass(frozen=True)
class OsmNode:
    osm_id: int
    kind: ElementKind
    coord: tuple[float, float]
    tags: dict[str, str] = field(default_factory=dict)

    @property
    def name(self) -> str | None:
        return self.tags.get("name")


def classify_way(tags: dict[str, str]) -> ElementKind:
    """Map OSM tags onto our vocabulary. Order matters: barriers win over ways."""
    if tags.get("building") == "grandstand":
        return ElementKind.GRANDSTAND
    if tags.get("amenity") == "parking":
        return ElementKind.PARKING
    barrier = tags.get("barrier")
    if barrier in BARRIER_VALUES:
        return ElementKind.BARRIER
    if barrier in PERMEABLE_BARRIER:
        return ElementKind.GATE
    if tags.get("highway") in WALKABLE_HIGHWAY:
        return ElementKind.WALKABLE
    return ElementKind.IGNORED


def classify_node(tags: dict[str, str]) -> ElementKind:
    if tags.get("barrier") in PERMEABLE_BARRIER:
        return ElementKind.GATE
    if tags.get("highway") == "crossing":
        return ElementKind.CROSSING
    return ElementKind.IGNORED


def width_for(tags: dict[str, str]) -> Sourced:
    """Corridor width, with honest provenance.

    An OSM `width` tag is real data. Everything else is an assumption, and is
    labelled so that `Sourced.is_trustworthy` returns False and the routing
    engine can weight it accordingly.
    """
    raw = tags.get("width") or tags.get("est_width")
    if raw:
        try:
            return Sourced(
                value=float(str(raw).split()[0]),
                provenance=Provenance.OSM,
                note="OSM width tag",
            )
        except ValueError:
            pass
    highway = tags.get("highway", "")
    return Sourced(
        value=DEFAULT_WIDTH_M.get(highway, FALLBACK_WIDTH_M),
        provenance=Provenance.ASSUMED,
        note=f"default for highway={highway or 'unknown'}; supersede by observation",
    )


GRANDSTAND_KIND = ZoneKind.VIEWING
PARKING_KIND = ZoneKind.PARKING
GATE_KIND = ZoneKind.GATE


def parse(elements: list[dict]) -> tuple[list[OsmWay], list[OsmNode]]:
    """Parse Overpass `out geom` output into typed geometry.

    Ignores elements without usable geometry rather than guessing at them.
    """
    ways: list[OsmWay] = []
    nodes: list[OsmNode] = []

    for el in elements:
        tags = el.get("tags") or {}
        if el.get("type") == "way":
            geom = el.get("geometry") or []
            if len(geom) < 2:
                continue
            kind = classify_way(tags)
            if kind is ElementKind.IGNORED:
                continue
            ways.append(
                OsmWay(
                    osm_id=el["id"],
                    kind=kind,
                    coords=[(g["lat"], g["lon"]) for g in geom],
                    tags=tags,
                )
            )
        elif el.get("type") == "node":
            kind = classify_node(tags)
            if kind is ElementKind.IGNORED:
                continue
            if "lat" not in el:
                continue
            nodes.append(
                OsmNode(osm_id=el["id"], kind=kind, coord=(el["lat"], el["lon"]), tags=tags)
            )

    return ways, nodes


def summarise(ways: list[OsmWay], nodes: list[OsmNode]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for w in ways:
        counts[w.kind.value] = counts.get(w.kind.value, 0) + 1
    for n in nodes:
        key = f"node:{n.kind.value}"
        counts[key] = counts.get(key, 0) + 1
    return counts
