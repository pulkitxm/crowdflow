"""Matching noised trace fragments onto the imported graph.

Everything else in this package is built on one question: *did this stretch of
walking happen on an edge the map already knows about?* Answering it well is
harder than it looks, for two reasons that pull in opposite directions.

**The trace is deliberately wrong.** A TraceFragment carries planar Laplace noise
applied on device, and it says how much: `noise_radius_m` is the radius within
which the true path is indistinguishable. So the match tolerance is not a
constant to be tuned — it is read off the fragment. A point is on an edge if it
lies within that edge's half-width plus the fragment's own noise radius. A tight
fragment matches tightly and a heavily noised one is given the slack it declared.

**The map is deliberately incomplete.** Points that match nothing are not errors
to be discarded; they are the entire signal desire-line discovery runs on. So
matching returns the misses as well as the hits, in order, with the run structure
intact — a person cutting across grass produces a *consecutive run* of misses
between two hits, and that shape is what distinguishes a shortcut from GNSS
noise flicking a single point off the path.

Edges are indexed on a uniform grid whose cell size is the pack's median edge
length, so lookup is over a handful of neighbours rather than all 2,404 edges.
The cell size is measured from the pack rather than chosen.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median

from crowdflow_contracts import CircuitPack, Position, TraceFragment

MIN_CELL_M = 1.0
"""Floor on the spatial index cell size. Guards against a degenerate pack whose
median edge length is zero; it changes which cells are searched, never which
edges match, so it cannot alter a result."""


def _project(
    p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> tuple[float, float, float]:
    """Project p onto segment ab.

    Returns (t, perpendicular_offset, signed_offset) where t is the clamped
    position along the segment in [0, 1]. The signed offset keeps left/right,
    which is what the width estimator needs: a corridor is measured by the
    spread of walkers across it, and an unsigned spread halves it.
    """
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    span = dx * dx + dy * dy
    if span <= 0.0:
        d = math.hypot(p[0] - ax, p[1] - ay)
        return 0.0, d, d
    t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / span
    t_clamped = max(0.0, min(1.0, t))
    fx, fy = ax + t_clamped * dx, ay + t_clamped * dy
    offset = math.hypot(p[0] - fx, p[1] - fy)
    # Cross product sign gives the side of the segment the point falls on.
    cross = dx * (p[1] - ay) - dy * (p[0] - ax)
    return t_clamped, offset, math.copysign(offset, cross or 1.0)


class EdgeIndex:
    """Uniform grid over edge bounding boxes. Structure only, no costs."""

    def __init__(self, pack: CircuitPack) -> None:
        self.pack = pack
        lengths = [e.length_m for e in pack.edges.values()]
        self.cell_m = max(MIN_CELL_M, median(lengths)) if lengths else MIN_CELL_M
        self._cells: dict[tuple[int, int], list[str]] = {}
        for eid, e in pack.edges.items():
            src, dst = pack.zones.get(e.source), pack.zones.get(e.destination)
            if src is None or dst is None:
                continue  # validate_integrity reports these; indexing must not crash
            for cell in self._cells_for_box(
                min(src.position.x, dst.position.x), min(src.position.y, dst.position.y),
                max(src.position.x, dst.position.x), max(src.position.y, dst.position.y),
            ):
                self._cells.setdefault(cell, []).append(eid)

    def _cells_for_box(
        self, min_x: float, min_y: float, max_x: float, max_y: float
    ) -> list[tuple[int, int]]:
        c = self.cell_m
        return [
            (i, j)
            for i in range(math.floor(min_x / c), math.floor(max_x / c) + 1)
            for j in range(math.floor(min_y / c), math.floor(max_y / c) + 1)
        ]

    def near(self, x: float, y: float, radius_m: float) -> list[str]:
        """Candidate edge ids whose bounding box could be within `radius_m`."""
        c = self.cell_m
        reach = math.ceil(radius_m / c)
        cx, cy = math.floor(x / c), math.floor(y / c)
        out: list[str] = []
        for i in range(cx - reach, cx + reach + 1):
            for j in range(cy - reach, cy + reach + 1):
                out.extend(self._cells.get((i, j), ()))
        return out


@dataclass(frozen=True)
class Match:
    """One trace point placed against the imported graph.

    `edge_id is None` means the point is off-graph — the interesting case.
    """

    index: int
    point: Position
    t: float
    edge_id: str | None = None
    offset_m: float = 0.0
    signed_offset_m: float = 0.0

    @property
    def on_graph(self) -> bool:
        return self.edge_id is not None


@dataclass
class Traversal:
    """One fragment's passage along one imported edge.

    Sample counting lives here and is deliberately per *fragment*: a fragment
    sampled at 1 Hz contributes dozens of points but only one independent
    observation of the corridor, and treating its points as samples would make
    nine traces look like nine hundred.
    """

    edge_id: str
    fragment_id: str
    t_start: float
    t_end: float
    distance_m: float
    noise_radius_m: float
    signed_offsets_m: list[float] = field(default_factory=list)

    @property
    def duration_s(self) -> float:
        return max(0.0, self.t_end - self.t_start)

    @property
    def speed_ms(self) -> float | None:
        """Observed walking speed, or None when the timing cannot support one."""
        if self.duration_s <= 0 or self.distance_m <= 0:
            return None
        return self.distance_m / self.duration_s


@dataclass
class MatchedFragment:
    fragment_id: str
    matches: list[Match]
    traversals: list[Traversal]

    @property
    def off_graph_runs(self) -> list[list[Match]]:
        """Maximal consecutive runs of off-graph points.

        Consecutiveness is the point. A single stray point between two matched
        ones is noise; a run of them is somebody walking where the map says
        there is nothing.
        """
        runs: list[list[Match]] = []
        current: list[Match] = []
        for m in self.matches:
            if m.on_graph:
                if current:
                    runs.append(current)
                    current = []
            else:
                current.append(m)
        if current:
            runs.append(current)
        return runs


class TraceMatcher:
    """Maps fragments onto a pack. Stateless between fragments, index reused."""

    def __init__(self, pack: CircuitPack) -> None:
        self.pack = pack
        self.index = EdgeIndex(pack)

    def tolerance_for(self, edge_id: str, noise_radius_m: float) -> float:
        """How far off an edge's centreline a point may sit and still count.

        Half the corridor's width (a walker can legitimately be at its edge)
        plus the noise the fragment declares it is carrying. No tuned constant:
        both terms come from data the system already holds.
        """
        return self.pack.edges[edge_id].width_m.value / 2.0 + noise_radius_m

    def match(self, fragment: TraceFragment) -> MatchedFragment:
        matches: list[Match] = []
        # Search radius must cover the widest tolerance any candidate could ask
        # for, so the grid never hides a match the tolerance would have accepted.
        widest = max((e.width_m.value for e in self.pack.edges.values()), default=0.0)
        radius = widest / 2.0 + fragment.noise_radius_m

        for i, p in enumerate(fragment.points):
            best: tuple[str, float, float, float] | None = None
            for eid in set(self.index.near(p.x, p.y, radius)):
                e = self.pack.edges[eid]
                src, dst = self.pack.zones.get(e.source), self.pack.zones.get(e.destination)
                if src is None or dst is None:
                    continue
                t, offset, signed = _project(
                    (p.x, p.y),
                    (src.position.x, src.position.y),
                    (dst.position.x, dst.position.y),
                )
                if offset > self.tolerance_for(eid, fragment.noise_radius_m):
                    continue
                if best is None or offset < best[1]:
                    best = (eid, offset, signed, t)
            if best is None:
                matches.append(Match(index=i, point=p, t=0.0))
            else:
                eid, offset, signed, t = best
                matches.append(
                    Match(
                        index=i, point=p, t=t, edge_id=eid,
                        offset_m=offset, signed_offset_m=signed,
                    )
                )

        return MatchedFragment(
            fragment_id=fragment.fragment_id,
            matches=matches,
            traversals=self._traversals(fragment, matches),
        )

    def _traversals(self, fragment: TraceFragment, matches: list[Match]) -> list[Traversal]:
        """Collapse consecutive matches on the same edge into one traversal.

        Time is interpolated across the fragment: a fragment states only its
        start and end, so a point's time is its share of the way through. That
        is an approximation, and it is the reason observed speed is reported
        with its sample count rather than on its own.
        """
        n = len(matches)
        span = max(fragment.duration_s, 0.0)

        def time_at(i: int) -> float:
            return fragment.t_start + (span * i / (n - 1) if n > 1 else 0.0)

        out: list[Traversal] = []
        current: Traversal | None = None
        for m in matches:
            if m.edge_id is None:
                current = None
                continue
            if current is None or current.edge_id != m.edge_id:
                current = Traversal(
                    edge_id=m.edge_id,
                    fragment_id=fragment.fragment_id,
                    t_start=time_at(m.index),
                    t_end=time_at(m.index),
                    distance_m=0.0,
                    noise_radius_m=fragment.noise_radius_m,
                    signed_offsets_m=[m.signed_offset_m],
                )
                out.append(current)
            else:
                previous = matches[m.index - 1]
                current.t_end = time_at(m.index)
                current.distance_m += math.dist(
                    (previous.point.x, previous.point.y), (m.point.x, m.point.y)
                )
                current.signed_offsets_m.append(m.signed_offset_m)
        return out


def match_all(pack: CircuitPack, fragments: list[TraceFragment]) -> list[MatchedFragment]:
    matcher = TraceMatcher(pack)
    return [matcher.match(f) for f in fragments]
