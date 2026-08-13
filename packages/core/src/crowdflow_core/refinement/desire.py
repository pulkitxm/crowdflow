"""Desire-line discovery: the paths people walk that no map contains.

OpenStreetMap knows the paths somebody drew. It does not know the gap in the
hedge behind Copse that half the campsite uses, or the diagonal across the grass
that appears the moment a session ends. Those informal shortcuts matter out of
all proportion to their length, because they are unmanaged, unlit, usually
narrow, and they are exactly where flow breaks down — an unmapped corridor
carries real people whose density nothing is watching.

The method is deliberately conservative, because the failure mode here is
inventing a path through a fence:

  1. Match every fragment to the imported graph (see trace.py).
  2. Keep only *runs* of consecutive off-graph points. One stray point is GNSS
     jitter; a run is a crossing.
  3. Anchor each run to the nearest known zone at each end. A shortcut that does
     not begin and end somewhere the map knows is not routable and is dropped.
  4. Discard any pair the graph already connects directly — that is a matching
     miss, not a discovery.
  5. Require the crossing to be shorter than the imported walk by more than the
     privacy noise the fragments declare. Below that margin the "saving" is
     indistinguishable from the noise that created it.
  6. Require repeated, independent support: distinct fragments, counted as
     fragments, against `standards.MEASURED_SAMPLE_FLOOR`.

What comes out is a *proposal*. Nothing here mutates the pack. A desire line is
evidence for an operator to look at, and the width it carries is measured from
the same traces rather than guessed — an edge proposed with an assumed width
would be an invented path wearing a measurement's clothes, so a line whose width
cannot be measured is reported and not proposed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import median

from crowdflow_contracts import (
    CircuitPack,
    Edge,
    MEASURED_SAMPLE_FLOOR,
    Position,
    Sourced,
    TraceFragment,
)

from ..routing.graph import VenueGraph
from ..venue.frame import polyline_length
from .capacity import measure_width
from .trace import EdgeIndex, Match, MatchedFragment, Traversal, TraceMatcher, _project

MIN_RUN_POINTS = 2
"""A crossing needs at least two points to have a direction. One off-graph point
between two matched ones is jitter, and treating it as a discovery would carve a
path through whatever the walker's GNSS drifted over."""


@dataclass(frozen=True)
class Crossing:
    """One fragment's single passage across unmapped open space."""

    fragment_id: str
    from_zone: str
    to_zone: str
    length_m: float
    noise_radius_m: float
    signed_offsets_m: list[float]


@dataclass(frozen=True)
class DesireLine:
    """A shortcut the imported graph does not contain, and its evidence."""

    from_zone: str
    to_zone: str
    support: int
    """Distinct fragments crossing here. Fragments, never points."""

    observed_length_m: float
    graph_walk_m: float | None
    """Distance of the fastest imported path between the anchors, or None when
    the graph does not connect them at all — the strongest case of the lot."""

    width: Sourced | None
    saving_m: float
    noise_radius_m: float

    @property
    def key(self) -> tuple[str, str]:
        return (self.from_zone, self.to_zone)

    @property
    def is_trustworthy(self) -> bool:
        return self.support >= MEASURED_SAMPLE_FLOOR

    @property
    def detour_ratio(self) -> float | None:
        """How much further the imported map makes people walk. None if
        unconnected, because 'infinitely further' is not a ratio worth printing."""
        if self.graph_walk_m is None or self.observed_length_m <= 0:
            return None
        return self.graph_walk_m / self.observed_length_m

    def describe(self) -> str:
        walk = "no imported path" if self.graph_walk_m is None else f"{self.graph_walk_m:.0f} m"
        return (
            f"{self.support} fragments cross {self.observed_length_m:.0f} m of open "
            f"space between {self.from_zone} and {self.to_zone}; imported walk is {walk}"
        )


class ZoneIndex:
    """Nearest-zone lookup on the same uniform grid the edge index uses."""

    def __init__(self, pack: CircuitPack, cell_m: float) -> None:
        self.pack = pack
        self.cell_m = cell_m
        self._cells: dict[tuple[int, int], list[str]] = {}
        for zid, z in pack.zones.items():
            cell = (
                math.floor(z.position.x / cell_m),
                math.floor(z.position.y / cell_m),
            )
            self._cells.setdefault(cell, []).append(zid)

    def nearest(self, p: Position) -> str | None:
        cx = math.floor(p.x / self.cell_m)
        cy = math.floor(p.y / self.cell_m)
        candidates: list[str] = []
        reach = 1
        # Expand the ring until something is found. Cheap at venue scale and it
        # cannot miss: the fallback below scans everything.
        while reach <= 4 and not candidates:
            for i in range(cx - reach, cx + reach + 1):
                for j in range(cy - reach, cy + reach + 1):
                    candidates.extend(self._cells.get((i, j), ()))
            reach += 1
        if not candidates:
            candidates = list(self.pack.zones)
        best, best_d = None, math.inf
        for zid in candidates:
            z = self.pack.zones[zid]
            d = math.dist((p.x, p.y), (z.position.x, z.position.y))
            if d < best_d:
                best, best_d = zid, d
        return best


def _directly_connected(pack: CircuitPack) -> set[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    for e in pack.edges.values():
        pairs.add((e.source, e.destination))
        pairs.add((e.destination, e.source))
    return pairs


def _crossings_in(
    fragment_id: str,
    runs: list[list[Match]],
    noise_radius_m: float,
    zones: ZoneIndex,
    pack: CircuitPack,
) -> list[Crossing]:
    out: list[Crossing] = []
    for run in runs:
        if len(run) < MIN_RUN_POINTS:
            continue
        a = zones.nearest(run[0].point)
        b = zones.nearest(run[-1].point)
        if a is None or b is None or a == b:
            continue
        za, zb = pack.zones[a], pack.zones[b]
        path = [
            (za.position.x, za.position.y),
            *[(m.point.x, m.point.y) for m in run],
            (zb.position.x, zb.position.y),
        ]
        # Offsets are taken about the straight anchor-to-anchor axis: that is the
        # corridor being proposed, so it is the axis its width is measured across.
        offsets = [
            _project(
                (m.point.x, m.point.y),
                (za.position.x, za.position.y),
                (zb.position.x, zb.position.y),
            )[2]
            for m in run
        ]
        # Orient the pair so that both directions of travel land in one group.
        key = (a, b) if a <= b else (b, a)
        out.append(
            Crossing(
                fragment_id=fragment_id,
                from_zone=key[0],
                to_zone=key[1],
                length_m=polyline_length(path),
                noise_radius_m=noise_radius_m,
                signed_offsets_m=offsets,
            )
        )
    return out


def discover(
    pack: CircuitPack,
    fragments: list[TraceFragment],
    *,
    matched: list[MatchedFragment] | None = None,
    graph: VenueGraph | None = None,
    min_support: int = MEASURED_SAMPLE_FLOOR,
) -> list[DesireLine]:
    """Find repeatedly-walked shortcuts the imported graph does not contain.

    `matched` is accepted so a caller that has already matched the fragments —
    the refinement report does — does not pay for it twice.
    """
    matcher = TraceMatcher(pack)
    if matched is None:
        matched = [matcher.match(f) for f in fragments]
    noise_by_id = {f.fragment_id: f.noise_radius_m for f in fragments}

    zones = ZoneIndex(pack, EdgeIndex(pack).cell_m)
    connected = _directly_connected(pack)

    grouped: dict[tuple[str, str], list[Crossing]] = {}
    for m in matched:
        for crossing in _crossings_in(
            m.fragment_id, m.off_graph_runs, noise_by_id.get(m.fragment_id, 0.0), zones, pack
        ):
            if (crossing.from_zone, crossing.to_zone) in connected:
                continue  # the map already has this; the miss was ours
            grouped.setdefault((crossing.from_zone, crossing.to_zone), []).append(crossing)

    graph = graph or VenueGraph(pack)
    lines: list[DesireLine] = []
    for (a, b), crossings in grouped.items():
        support = len({c.fragment_id for c in crossings})
        if support < min_support:
            continue

        observed = median([c.length_m for c in crossings])
        noise = median([c.noise_radius_m for c in crossings])
        result = graph.route(a, b)
        graph_walk = result.distance_m if result.found else None

        # An unconnected pair is an unconditional discovery; a connected one has
        # to beat the imported walk by more than the noise that describes it.
        saving = math.inf if graph_walk is None else graph_walk - observed
        if saving <= noise:
            continue

        width, _ = measure_width(
            [
                Traversal(
                    edge_id=f"desire:{a}->{b}",
                    fragment_id=c.fragment_id,
                    t_start=0.0,
                    t_end=0.0,
                    distance_m=c.length_m,
                    noise_radius_m=c.noise_radius_m,
                    signed_offsets_m=list(c.signed_offsets_m),
                )
                for c in crossings
            ],
            imported=None,
            samples=support,
        )

        lines.append(
            DesireLine(
                from_zone=a,
                to_zone=b,
                support=support,
                observed_length_m=round(observed, 2),
                graph_walk_m=None if graph_walk is None else round(graph_walk, 2),
                width=width,
                saving_m=0.0 if graph_walk is None else round(saving, 2),
                noise_radius_m=round(noise, 2),
            )
        )

    lines.sort(key=lambda line: (line.support, line.saving_m), reverse=True)
    return lines


def propose_edges(lines: list[DesireLine]) -> dict[str, Edge]:
    """Turn trustworthy desire lines into edges an operator could adopt.

    Proposals, not additions. A line whose width could not be measured is left
    out: proposing a corridor with a made-up width would launder a guess into
    the one part of the graph that was supposed to be evidence.
    """
    out: dict[str, Edge] = {}
    for line in lines:
        if not line.is_trustworthy or line.width is None:
            continue
        edge_id = f"desire-{line.from_zone}-{line.to_zone}"
        out[edge_id] = Edge(
            id=edge_id,
            source=line.from_zone,
            destination=line.to_zone,
            length_m=line.observed_length_m,
            width_m=line.width,
            bidirectional=True,
        )
    return out
