"""Venue graph and routing.

Edge cost is not distance. It is the time the walk actually takes under current
conditions, plus penalties for risk and for edges that are close to their limit:

    cost = travel_time + congestion_penalty + risk_penalty + capacity_penalty

Two things routing must refuse to do, both of which look fine on a static map:

  * route through an edge that is closed, or will have closed by the time the
    walker arrives (D5 — the ETA gate)
  * route over geometry it does not trust (D6 — provenance)

Static routes are cached. See `route` for why that is safe and where it stops.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field, replace

from crowdflow_contracts import CircuitPack, FREE_FLOW_SPEED_MS, LOSBand, ZoneState

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

AVOID_PENALTY = 25.0
"""Multiplier on an edge touching a zone the operator asked walkers to avoid.
ASSUMED. Large enough that any plausible detour wins, finite because an advisory
is not a closure: if avoiding a zone would strand someone, they still get a path
through it. Compare CRITICAL_WEIGHT, which is the same argument for a measured
condition rather than an instruction."""

PREFER_DISCOUNT = 0.6
"""Multiplier on an edge the operator asked walkers to prefer. ASSUMED. A
discount rather than a rewrite: preferring a route must be able to lose to a
much shorter alternative, or an advisory becomes a diversion nobody chose."""


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
        self._forbidden: set[str] = set()
        self._route_cache: dict[
            tuple[str, str, frozenset[str], frozenset[str]], RouteResult
        ] = {}
        self.cache_hits = 0
        self.cache_misses = 0
        self.rebuild(session_state)

    # -- structure ---------------------------------------------------------

    def rebuild(self, session_state: str | None) -> None:
        """Recompute which edges exist at all, given the session state (D5).

        Drops the route cache. A cached path computed while a crossing was open
        is not merely stale after it shuts — it routes people at a closed
        crossing, which is the exact failure the ETA gate exists to prevent.
        Invalidation lives here, in the one method that can change the edge set,
        so it cannot be forgotten at a call site.
        """
        self.session_state = session_state
        self._route_cache.clear()
        self._closed = set()
        for crossing in self.pack.crossings.values():
            if not crossing.availability.is_open_during(session_state):
                self._closed.add(crossing.edge_id)

        # Forbidden zones are REMOVED, not penalised. `avoid` is a preference
        # expressed as a cost multiplier, which is right for "steer traffic away"
        # and wrong for "never route through a live-circuit working position": a
        # multiplier still yields a path when it is the only one, and a path is
        # what the caller then acts on. If the only way runs through a marshal
        # post, the honest answer is that there is no way.
        self._forbidden = set(self.pack.constraints.never_route_through)

        self._adj = {zid: [] for zid in self.pack.zones}
        for eid, e in self.pack.edges.items():
            if eid in self._closed:
                continue
            if e.source in self._forbidden or e.destination in self._forbidden:
                continue
            self._adj.setdefault(e.source, []).append((e.destination, eid))
            if e.bidirectional:
                self._adj.setdefault(e.destination, []).append((e.source, eid))

    @property
    def closed_edges(self) -> set[str]:
        return set(self._closed)

    @property
    def forbidden_zones(self) -> set[str]:
        """Zones no route may traverse. Structurally absent from the graph."""
        return set(self._forbidden)

    def path_violations(self, path: list[str]) -> list[str]:
        """Forbidden zones a path traverses. Should always be empty — this is the
        independent check that the structural exclusion actually held."""
        return [z for z in path if z in self._forbidden]

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
            speed = e.free_speed_ms.value if e.free_speed_ms else FREE_FLOW_SPEED_MS

        travel = e.length_m / speed
        cost = travel
        if band is LOSBand.BUILDING:
            cost *= CONGESTION_WEIGHT
        elif band is LOSBand.CRITICAL:
            cost *= CRITICAL_WEIGHT
        if not e.width_m.is_trustworthy:
            cost *= UNTRUSTED_WIDTH_PENALTY
        if avoid and (e.source in avoid or e.destination in avoid):
            cost *= AVOID_PENALTY
        return cost, travel

    # -- search ------------------------------------------------------------

    def _heuristic(self, a: str, b: str) -> float:
        za, zb = self.pack.zones.get(a), self.pack.zones.get(b)
        if not za or not zb:
            return 0.0
        d = math.dist((za.position.x, za.position.y), (zb.position.x, zb.position.y))
        # Optimistic: free-flow walk on the straight line, so A* stays admissible.
        return d / FREE_FLOW_SPEED_MS

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

        **Memoised, but only where the answer is a pure function of the graph.**
        Six thousand simulated agents share on the order of tens of distinct
        (origin, destination, avoid, prefer) requests, and the intervention
        engine forks the whole world once per candidate — so the same handful of
        searches over a 1,875-node graph was being repeated tens of thousands of
        times per decision. Forks share this graph, so they share the cache.

        Two boundaries keep the memo honest, and both are load-bearing:

          * `states` is the per-tick density field. It changes every tick, so a
            cached cost would be a cost from a crowd that has since moved. A
            call that passes states is never cached and never served from cache.
          * `crossing_deadlines` makes the answer depend on when the walker
            leaves, which is not in the key. Same treatment.

        Invalidation on structural change lives in `rebuild`.
        """
        if states is not None or crossing_deadlines:
            return self._search(
                origin, destination, states, avoid, prefer, crossing_deadlines
            )

        key = (origin, destination, frozenset(avoid or ()), frozenset(prefer or ()))
        cached = self._route_cache.get(key)
        if cached is None:
            self.cache_misses += 1
            cached = self._search(origin, destination, None, avoid, prefer, None)
            self._route_cache[key] = cached
        else:
            self.cache_hits += 1
        # Hand back a copy: callers own their path list, and one that mutated it
        # would corrupt every later hit rather than fail visibly.
        return replace(cached, path=list(cached.path))

    @property
    def route_cache_size(self) -> int:
        return len(self._route_cache)

    def _search(
        self,
        origin: str,
        destination: str,
        states: dict[str, ZoneState] | None,
        avoid: set[str] | None,
        prefer: set[str] | None,
        crossing_deadlines: dict[str, float] | None,
    ) -> RouteResult:
        """The A* itself. Pure in its arguments — which is what makes `route`
        cacheable, and why the cache wrapper is separate from the search."""
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
                    cost *= PREFER_DISCOUNT

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
