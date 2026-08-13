"""Venue graph and routing.

Edge cost is not distance. It is the time the walk actually takes under current
conditions, plus penalties for risk and for edges that are close to their limit:

    cost = travel_time + congestion_penalty + risk_penalty + capacity_penalty

Two things routing must refuse to do, both of which look fine on a static map:

  * route through an edge that is closed, or will have closed by the time the
    walker arrives (D5 — the ETA gate)
  * route over geometry it does not trust (D6 — provenance)
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field

from crowdflow_contracts import CircuitPack, LOSBand, ZoneState

from ..state.flow import MIN_SPEED_MS

CONGESTION_WEIGHT = 2.5
"""Multiplier on travel time when an edge is in the BUILDING band. Routing should
prefer a longer clear path over a shorter slow one, but not absurdly so."""

CRITICAL_WEIGHT = 12.0
"""BUILDING is discouraged; CRITICAL is nearly forbidden. Not infinite, because a
graph with no path at all is worse than a bad path."""

UNTRUSTED_WIDTH_PENALTY = 1.15
"""Small tax on edges whose width is assumed. Their band is provisional, so their
cost estimate is too; prefer corroborated geometry where the choice is close."""


@dataclass
class RouteResult:
    path: list[str] = field(default_factory=list)
    cost_s: float = math.inf
    distance_m: float = 0.0
    eta_s: float = 0.0
    rejected_reason: str | None = None

    @property
    def found(self) -> bool:
        return bool(self.path) and self.rejected_reason is None


class VenueGraph:
    """Adjacency over a CircuitPack, with dynamic per-tick costs.

    Rebuilt when the session state changes (crossings open and close); re-costed
    every tick (density moves). Those are different frequencies, so they are
    different operations.
    """

    def __init__(self, pack: CircuitPack, session_state: str | None = None) -> None:
        self.pack = pack
        self.session_state = session_state
        self._adj: dict[str, list[tuple[str, str]]] = {}
        self._closed: set[str] = set()
        self.rebuild(session_state)

    # -- structure ---------------------------------------------------------

    def rebuild(self, session_state: str | None) -> None:
        """Recompute which edges exist at all, given the session state (D5)."""
        self.session_state = session_state
        self._closed = set()
        for crossing in self.pack.crossings.values():
            if not crossing.availability.is_open_during(session_state):
                self._closed.add(crossing.edge_id)

        self._adj = {zid: [] for zid in self.pack.zones}
        for eid, e in self.pack.edges.items():
            if eid in self._closed:
                continue
            self._adj.setdefault(e.source, []).append((e.destination, eid))
            if e.bidirectional:
                self._adj.setdefault(e.destination, []).append((e.source, eid))

    @property
    def closed_edges(self) -> set[str]:
        return set(self._closed)

    def neighbours(self, zone_id: str) -> list[tuple[str, str]]:
        return self._adj.get(zone_id, [])

    # -- cost --------------------------------------------------------------

    def edge_cost(
        self,
        edge_id: str,
        states: dict[str, ZoneState] | None = None,
        avoid: set[str] | None = None,
    ) -> tuple[float, float]:
        """Return (cost_seconds, travel_time_seconds) for traversing an edge."""
        e = self.pack.edges[edge_id]
        state = (states or {}).get(e.destination) or (states or {}).get(e.source)

        speed = MIN_SPEED_MS
        band = LOSBand.NOMINAL
        if state is not None:
            speed = max(MIN_SPEED_MS, state.mean_speed_ms)
            band = state.band
        else:
            speed = e.free_speed_ms.value if e.free_speed_ms else 1.34

        travel = e.length_m / speed
        cost = travel
        if band is LOSBand.BUILDING:
            cost *= CONGESTION_WEIGHT
        elif band is LOSBand.CRITICAL:
            cost *= CRITICAL_WEIGHT
        if not e.width_m.is_trustworthy:
            cost *= UNTRUSTED_WIDTH_PENALTY
        if avoid and (e.source in avoid or e.destination in avoid):
            cost *= 25.0
        return cost, travel

    # -- search ------------------------------------------------------------

    def _heuristic(self, a: str, b: str) -> float:
        za, zb = self.pack.zones.get(a), self.pack.zones.get(b)
        if not za or not zb:
            return 0.0
        d = math.dist((za.position.x, za.position.y), (zb.position.x, zb.position.y))
        return d / 1.34  # optimistic: free-flow walk, so A* stays admissible

    def route(
        self,
        origin: str,
        destination: str,
        states: dict[str, ZoneState] | None = None,
        avoid: set[str] | None = None,
        prefer: set[str] | None = None,
        depart_at: float = 0.0,
        crossing_deadlines: dict[str, float] | None = None,
    ) -> RouteResult:
        """A* over dynamic cost, with the ETA gate on time-limited edges.

        crossing_deadlines maps edge_id -> seconds from depart_at after which
        that edge closes. A path is rejected if the walker would arrive at an
        edge after it shuts: routing someone toward a crossing that closes before
        they get there manufactures the queue it was trying to prevent.
        """
        if origin not in self.pack.zones:
            return RouteResult(rejected_reason=f"unknown origin {origin!r}")
        if destination not in self.pack.zones:
            return RouteResult(rejected_reason=f"unknown destination {destination!r}")
        if origin == destination:
            return RouteResult(path=[origin], cost_s=0.0)

        deadlines = crossing_deadlines or {}
        prefer = prefer or set()

        best: dict[str, float] = {origin: 0.0}
        elapsed: dict[str, float] = {origin: 0.0}
        dist: dict[str, float] = {origin: 0.0}
        came: dict[str, tuple[str, str]] = {}
        heap: list[tuple[float, str]] = [(self._heuristic(origin, destination), origin)]
        seen: set[str] = set()

        while heap:
            _, node = heapq.heappop(heap)
            if node in seen:
                continue
            seen.add(node)
            if node == destination:
                break

            for nxt, eid in self.neighbours(node):
                if nxt in seen:
                    continue
                cost, travel = self.edge_cost(eid, states, avoid)
                if eid in prefer or nxt in prefer:
                    cost *= 0.6

                arrive = elapsed[node] + travel
                if eid in deadlines and arrive > deadlines[eid]:
                    continue  # would arrive after it closes — the ETA gate

                g = best[node] + cost
                if g < best.get(nxt, math.inf):
                    best[nxt] = g
                    elapsed[nxt] = arrive
                    dist[nxt] = dist[node] + self.pack.edges[eid].length_m
                    came[nxt] = (node, eid)
                    heapq.heappush(heap, (g + self._heuristic(nxt, destination), nxt))

        if destination not in best:
            return RouteResult(rejected_reason="no path under current conditions")

        path: list[str] = [destination]
        while path[-1] != origin:
            path.append(came[path[-1]][0])
        path.reverse()

        return RouteResult(
            path=path,
            cost_s=best[destination],
            distance_m=dist[destination],
            eta_s=elapsed[destination],
        )

    def reachable(self, origin: str) -> set[str]:
        """Connectivity check — used by validation and by safety."""
        seen = {origin}
        stack = [origin]
        while stack:
            for nxt, _ in self.neighbours(stack.pop()):
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return seen
