"""Build a CircuitPack from parsed OSM geometry.

The pipeline, in order:

    project -> clip to venue envelope -> node snapping -> edges
            -> barrier subtraction -> semantic zones -> simplify -> pack

Two steps do most of the work and are easy to get wrong:

**Barrier subtraction.** Any candidate edge that crosses a fence, wall or hedge
is removed unless a gate sits on the crossing point. Without this the graph is
connected in places the crowd physically is not, and the router will confidently
send people through a barrier.

**Node snapping.** OSM ways that meet at a junction do not necessarily share a
node. Points within SNAP_M collapse to one graph node, which is what turns a pile
of polylines into a network.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from crowdflow_contracts import (
    CircuitPack,
    CoordinateFrame,
    Edge,
    Position,
    Provenance,
    SafetyConstraints,
    Sourced,
    Zone,
    ZoneKind,
)

from .frame import Frame, point_to_segment_distance, segments_intersect
from .osm import ElementKind, OsmNode, OsmWay, width_for

SNAP_M = 8.0
"""Points closer than this collapse to one junction. Roughly the width of a
service road, so genuinely distinct parallel paths survive."""

GATE_TOLERANCE_M = 12.0
"""A barrier crossing within this distance of a gate node is an opening."""

MIN_EDGE_M = 3.0
"""Shorter than this and the edge is snapping noise, not a corridor."""

ATTACH_MAX_M = 120.0
"""How far a semantic zone may be stubbed to the path network.

A grandstand or car park is connected to the graph by a short access stub. If the
nearest path node is further away than this, the connection would be fabricated —
so the zone is dropped and counted instead. An invented 900 m footpath is far
worse than an absent car park: the router would happily send people down it."""


@dataclass
class BuildStats:
    """What the import actually did. Printed by the CLI; a silent import lies."""

    ways_in: int = 0
    ways_clipped: int = 0
    raw_edges: int = 0
    barrier_removed: int = 0
    gate_preserved: int = 0
    edges_out: int = 0
    zones_out: int = 0
    simplified_away: int = 0
    assumed_widths: int = 0
    unattached: int = 0

    def as_rows(self) -> list[tuple[str, int]]:
        return [
            ("ways read", self.ways_in),
            ("dropped outside venue envelope", self.ways_clipped),
            ("candidate edges", self.raw_edges),
            ("removed: crosses a barrier", self.barrier_removed),
            ("kept: barrier crossing has a gate", self.gate_preserved),
            ("collapsed by simplification", self.simplified_away),
            ("edges in pack", self.edges_out),
            ("zones in pack", self.zones_out),
            ("edges with ASSUMED width", self.assumed_widths),
            ("semantic zones dropped: no path within reach", self.unattached),
        ]


def _grid_key(p: tuple[float, float], cell: float) -> tuple[int, int]:
    return (int(p[0] // cell), int(p[1] // cell))


class _Snapper:
    """Collapses nearby points onto shared junction ids via a uniform grid."""

    def __init__(self, tol: float = SNAP_M) -> None:
        self.tol = tol
        self.points: list[tuple[float, float]] = []
        self._grid: dict[tuple[int, int], list[int]] = {}

    def snap(self, p: tuple[float, float]) -> int:
        key = _grid_key(p, self.tol)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for idx in self._grid.get((key[0] + dx, key[1] + dy), ()):
                    if math.dist(p, self.points[idx]) <= self.tol:
                        return idx
        idx = len(self.points)
        self.points.append(p)
        self._grid.setdefault(key, []).append(idx)
        return idx


class _BarrierIndex:
    """Spatial index over barrier segments, for the crossing test."""

    CELL = 40.0

    def __init__(self) -> None:
        self._cells: dict[tuple[int, int], list[tuple]] = {}

    def add(self, a: tuple[float, float], b: tuple[float, float]) -> None:
        for key in self._keys(a, b):
            self._cells.setdefault(key, []).append((a, b))

    def _keys(self, a, b):
        x0, x1 = sorted((a[0], b[0]))
        y0, y1 = sorted((a[1], b[1]))
        for i in range(int(x0 // self.CELL), int(x1 // self.CELL) + 1):
            for j in range(int(y0 // self.CELL), int(y1 // self.CELL) + 1):
                yield (i, j)

    def crossed_by(self, a: tuple[float, float], b: tuple[float, float]) -> bool:
        seen: set[int] = set()
        for key in self._keys(a, b):
            for seg in self._cells.get(key, ()):
                if id(seg) in seen:
                    continue
                seen.add(id(seg))
                if segments_intersect(a, b, seg[0], seg[1]):
                    return True
        return False


def _centroid(pts: list[tuple[float, float]]) -> tuple[float, float]:
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def _near_track(
    pts: list[tuple[float, float]], track: list[tuple[float, float]], buffer_m: float
) -> bool:
    """Is any point of this way within buffer_m of the track polyline?

    This is the venue envelope clip. It keeps the circuit and its surroundings
    and drops the village, without hand-drawing a boundary.
    """
    for p in pts:
        for i in range(len(track) - 1):
            if point_to_segment_distance(p, track[i], track[i + 1]) <= buffer_m:
                return True
    return False


def build_pack(
    *,
    circuit_id: str,
    name: str,
    geometry_source: str,
    track_length_m: float,
    altitude_m: float,
    track_latlon: list[tuple[float, float]],
    ways: list[OsmWay],
    nodes: list[OsmNode],
    venue_buffer_m: float = 900.0,
) -> tuple[CircuitPack, BuildStats]:
    """Assemble a validated-shaped CircuitPack from OSM geometry."""
    stats = BuildStats(ways_in=len(ways))

    origin_lat = min(c[0] for c in track_latlon)
    origin_lon = min(c[1] for c in track_latlon)
    frame = Frame(origin_lat, origin_lon)
    track_xy = frame.project_all(track_latlon)

    # --- project and clip -------------------------------------------------
    projected: list[tuple[OsmWay, list[tuple[float, float]]]] = []
    for w in ways:
        pts = frame.project_all(w.coords)
        if not _near_track(pts, track_xy, venue_buffer_m):
            stats.ways_clipped += 1
            continue
        projected.append((w, pts))

    gates_xy = [
        frame.to_xy(*n.coord) for n in nodes if n.kind is ElementKind.GATE
    ]

    # --- barriers ---------------------------------------------------------
    barriers = _BarrierIndex()
    for w, pts in projected:
        if w.kind is ElementKind.BARRIER:
            for i in range(len(pts) - 1):
                barriers.add(pts[i], pts[i + 1])

    # --- walkable edges ---------------------------------------------------
    snapper = _Snapper()
    raw: list[tuple[int, int, float, OsmWay]] = []
    for w, pts in projected:
        if w.kind is not ElementKind.WALKABLE:
            continue
        ids = [snapper.snap(p) for p in pts]
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            u, v = ids[i], ids[i + 1]
            if u == v:
                continue
            length = math.dist(a, b)
            if length < MIN_EDGE_M:
                continue
            stats.raw_edges += 1
            if barriers.crossed_by(a, b):
                mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                if any(math.dist(mid, g) <= GATE_TOLERANCE_M for g in gates_xy):
                    stats.gate_preserved += 1
                else:
                    stats.barrier_removed += 1
                    continue
            raw.append((u, v, length, w))

    # --- graph zones ------------------------------------------------------
    used: set[int] = set()
    for u, v, _, _ in raw:
        used.add(u)
        used.add(v)

    zones: dict[str, Zone] = {}
    for idx in sorted(used):
        x, y = snapper.points[idx]
        zid = f"n{idx}"
        zones[zid] = Zone(
            id=zid, kind=ZoneKind.CONCOURSE, position=Position(x=round(x, 2), y=round(y, 2))
        )

    edges: dict[str, Edge] = {}
    for k, (u, v, length, w) in enumerate(raw):
        width = width_for(w.tags)
        if width.provenance is Provenance.ASSUMED:
            stats.assumed_widths += 1
        eid = f"e{k}"
        edges[eid] = Edge(
            id=eid,
            source=f"n{u}",
            destination=f"n{v}",
            length_m=round(length, 2),
            width_m=width,
            bidirectional=True,
        )

    # --- semantic zones, attached to their nearest graph node -------------
    def attach(pos: tuple[float, float], zid: str, kind: ZoneKind, nm: str | None,
               cap: Sourced | None, osm_id: str | None) -> None:
        if not used:
            return
        nearest = min(used, key=lambda i: math.dist(pos, snapper.points[i]))
        gap = math.dist(pos, snapper.points[nearest])
        if gap > ATTACH_MAX_M:
            stats.unattached += 1
            return
        zones[zid] = Zone(
            id=zid, kind=kind, name=nm,
            position=Position(x=round(pos[0], 2), y=round(pos[1], 2)),
            capacity=cap, osm_id=osm_id,
        )
        eid = f"a{zid}"
        edges[eid] = Edge(
            id=eid, source=zid, destination=f"n{nearest}",
            length_m=max(MIN_EDGE_M, round(math.dist(pos, snapper.points[nearest]), 2)),
            width_m=Sourced(value=4.0, provenance=Provenance.ASSUMED,
                            note="access stub to nearest path node"),
            bidirectional=True,
        )
        stats.assumed_widths += 1

    for w, pts in projected:
        if w.kind is ElementKind.GRANDSTAND:
            attach(_centroid(pts), f"stand_{w.osm_id}", ZoneKind.VIEWING,
                   w.name or "Grandstand", None, str(w.osm_id))
        elif w.kind is ElementKind.PARKING:
            attach(_centroid(pts), f"park_{w.osm_id}", ZoneKind.PARKING,
                   w.name or "Car park", None, str(w.osm_id))

    for n in nodes:
        if n.kind is not ElementKind.GATE:
            continue
        p = frame.to_xy(*n.coord)
        if not _near_track([p], track_xy, venue_buffer_m):
            continue
        attach(p, f"gate_{n.osm_id}", ZoneKind.GATE, n.name, None, str(n.osm_id))

    zones, edges, collapsed = simplify(zones, edges, protected=_semantic_ids(zones))
    stats.simplified_away = collapsed
    stats.assumed_widths = sum(
        1 for e in edges.values() if e.width_m.provenance is Provenance.ASSUMED
    )

    stats.edges_out = len(edges)
    stats.zones_out = len(zones)

    xs = [z.position.x for z in zones.values()] or [0.0]
    ys = [z.position.y for z in zones.values()] or [0.0]
    tx = [p[0] for p in track_xy]
    ty = [p[1] for p in track_xy]

    pack = CircuitPack(
        id=circuit_id,
        name=name,
        geometry_source=geometry_source,
        track_length_m=track_length_m,
        altitude_m=altitude_m,
        frame=CoordinateFrame(
            origin_lat=origin_lat,
            origin_lon=origin_lon,
            track_bounds_m=(round(max(tx) - min(tx), 1), round(max(ty) - min(ty), 1)),
            venue_bounds_m=(
                round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)
            ),
        ),
        zones=zones,
        edges=edges,
        constraints=SafetyConstraints(),
    )
    return pack, stats


# --------------------------------------------------------------------------
# Simplification
#
# Every OSM geometry vertex starts as a graph node, which makes a graph that is
# geometrically faithful and operationally useless — thousands of "zones" that
# are really just bends in a path. Collapsing degree-2 chains turns the vertex
# soup into corridors between junctions, which is what an operator reasons about
# and what routing wants.
#
# Semantic zones are never collapsed: a gate is a place even if only two paths
# meet there.
# --------------------------------------------------------------------------

_SEMANTIC_KINDS = {ZoneKind.GATE, ZoneKind.VIEWING, ZoneKind.PARKING, ZoneKind.EXIT}


def _semantic_ids(zones: dict[str, Zone]) -> set[str]:
    return {z.id for z in zones.values() if z.kind in _SEMANTIC_KINDS}


def simplify(
    zones: dict[str, Zone],
    edges: dict[str, Edge],
    protected: set[str] | None = None,
) -> tuple[dict[str, Zone], dict[str, Edge], int]:
    """Collapse degree-2 chains into single corridor edges.

    Width of the merged edge is the length-weighted mean of its parts, and the
    weakest provenance wins — one assumed segment makes the whole corridor
    assumed, which is the honest reading.
    """
    protected = protected or set()

    adj: dict[str, list[str]] = {z: [] for z in zones}
    for eid, e in edges.items():
        adj.setdefault(e.source, []).append(eid)
        adj.setdefault(e.destination, []).append(eid)

    edges = dict(edges)
    collapsed = 0

    for zid in list(zones):
        if zid in protected:
            continue
        incident = [e for e in adj.get(zid, []) if e in edges]
        if len(incident) != 2:
            continue
        e1, e2 = edges[incident[0]], edges[incident[1]]
        if e1.id == e2.id:
            continue

        far1 = e1.destination if e1.source == zid else e1.source
        far2 = e2.destination if e2.source == zid else e2.source
        if far1 == far2 or far1 == zid or far2 == zid:
            continue

        total = e1.length_m + e2.length_m
        w = (e1.width_m.value * e1.length_m + e2.width_m.value * e2.length_m) / total
        prov = (
            Provenance.ASSUMED
            if Provenance.ASSUMED in (e1.width_m.provenance, e2.width_m.provenance)
            else e1.width_m.provenance
        )
        merged_id = f"m{e1.id}_{e2.id}"
        merged = Edge(
            id=merged_id,
            source=far1,
            destination=far2,
            length_m=round(total, 2),
            width_m=Sourced(value=round(w, 2), provenance=prov,
                            note="length-weighted mean of merged segments"),
            gradient=(e1.gradient + e2.gradient) / 2,
            bidirectional=e1.bidirectional and e2.bidirectional,
        )

        del edges[e1.id]
        del edges[e2.id]
        edges[merged_id] = merged
        for far in (far1, far2):
            adj.setdefault(far, []).append(merged_id)
        adj[zid] = []
        del zones[zid]
        collapsed += 1

    live = {e.source for e in edges.values()} | {e.destination for e in edges.values()}
    zones = {z: v for z, v in zones.items() if z in live}
    return zones, edges, collapsed
