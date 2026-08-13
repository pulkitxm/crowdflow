"""Agent-based crowd simulation.

Agents walk the real venue graph toward a destination, and their speed comes from
the same fundamental diagram the state engine measures with. Congestion is
therefore *emergent* — nobody scripts a bottleneck; it appears where demand
exceeds what a corridor can carry, which is the only way a prediction validated
in simulation means anything.

Two properties the rest of the system depends on:

  * **Seeded.** Same seed, same run, every time. The demo, the A/B harness and
    training-data generation all require it.
  * **Forkable.** `fork()` clones the world so an intervention can be tried
    against the actual current state and compared with doing nothing. The
    intervention engine is impossible without it, which is why it is here from
    the start rather than retrofitted.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field, replace

from crowdflow_contracts import CrowdNode, FREE_FLOW_SPEED_MS, Position

from ..routing.graph import VenueGraph
from ..state.flow import speed_at_density

REROUTE_COOLDOWN_S = 45.0
"""An agent will not recompute its route more often than this. Without a cooldown
a crowd oscillates between two corridors as each becomes momentarily better."""


@dataclass
class Agent:
    """One simulated spectator."""

    id: int
    origin: str
    destination: str
    at: str
    next_zone: str | None = None
    edge_id: str | None = None
    progress_m: float = 0.0
    desired_speed_ms: float = FREE_FLOW_SPEED_MS
    path: list[str] = field(default_factory=list)
    arrived: bool = False
    depart_at_s: float = 0.0
    started: bool = False
    walk_time_s: float = 0.0
    last_route_s: float = -1e9
    complies: bool = True
    """Not everyone follows a reroute. Assuming total compliance would flatter
    every intervention result."""
    participates: bool = True
    """Whether this spectator is running the app. Decided ONCE at creation, not
    resampled per tick: a device either contributes telemetry for the whole event
    or it never does. Resampling each tick makes the union over any observation
    window approach the entire crowd, which silently inflates every population
    estimate by roughly 1/participation."""


@dataclass
class SimConfig:
    seed: int = 42
    tick_s: float = 2.0
    compliance: float = 0.7
    """Share of agents that will act on a reroute. 0.7 is ASSUMED — it is a
    behavioural parameter we have no measurement for, and results are reported
    against a sweep of it rather than a single value."""
    participation: float = 0.18
    """Share of spectators running the app. Fixed per agent at creation."""
    speed_sigma: float = 0.18


class Simulation:
    """The world. Deterministic given its seed."""

    def __init__(self, graph: VenueGraph, config: SimConfig | None = None) -> None:
        self.graph = graph
        self.config = config or SimConfig()
        self.rng = random.Random(self.config.seed)
        self.time_s = 0.0
        self.agents: list[Agent] = []
        self.avoid: set[str] = set()
        self.prefer: set[str] = set()
        self.reroute_fraction: float = 0.0
        self._next_id = 0
        self.arrived_walk_times: list[float] = []

    # -- population --------------------------------------------------------

    def add_agents(
        self,
        count: int,
        origin: str,
        destination: str,
        *,
        start_s: float = 0.0,
        spread_s: float = 0.0,
    ) -> int:
        """Add a cohort. Departure times spread uniformly over `spread_s`."""
        added = 0
        for _ in range(count):
            speed = max(0.4, self.rng.gauss(FREE_FLOW_SPEED_MS, self.config.speed_sigma))
            agent = Agent(
                id=self._next_id,
                origin=origin,
                destination=destination,
                at=origin,
                desired_speed_ms=speed,
                depart_at_s=start_s + (self.rng.random() * spread_s if spread_s else 0.0),
                complies=self.rng.random() < self.config.compliance,
                participates=self.rng.random() < self.config.participation,
            )
            self._next_id += 1
            self.agents.append(agent)
            added += 1
        return added

    # -- occupancy ---------------------------------------------------------

    def edge_occupancy(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for a in self.agents:
            if a.edge_id and not a.arrived:
                counts[a.edge_id] = counts.get(a.edge_id, 0) + 1
        return counts

    def zone_occupancy(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for a in self.agents:
            if a.arrived or not a.started:
                continue
            zone = a.next_zone or a.at
            counts[zone] = counts.get(zone, 0) + 1
        return counts

    # -- movement ----------------------------------------------------------

    def _plan(self, agent: Agent) -> None:
        result = self.graph.route(
            agent.at,
            agent.destination,
            avoid=self.avoid if agent.complies else None,
            prefer=self.prefer if agent.complies else None,
        )
        agent.path = result.path[1:] if result.found else []
        agent.last_route_s = self.time_s

    def _enter_next_edge(self, agent: Agent) -> None:
        if not agent.path:
            self._plan(agent)
        if not agent.path:
            agent.arrived = True
            return
        nxt = agent.path.pop(0)
        for dest, eid in self.graph.neighbours(agent.at):
            if dest == nxt:
                agent.next_zone = nxt
                agent.edge_id = eid
                agent.progress_m = 0.0
                return
        agent.path = []
        self._plan(agent)
        if not agent.path:
            agent.arrived = True

    def step(self) -> None:
        """Advance one tick."""
        dt = self.config.tick_s
        occupancy = self.edge_occupancy()

        for agent in self.agents:
            if agent.arrived:
                continue
            if not agent.started:
                if self.time_s < agent.depart_at_s:
                    continue
                agent.started = True
                self._plan(agent)
                if agent.at == agent.destination:
                    agent.arrived = True
                    self.arrived_walk_times.append(agent.walk_time_s)
                    continue
                self._enter_next_edge(agent)
                if agent.arrived:
                    continue

            if agent.edge_id is None:
                self._enter_next_edge(agent)
                if agent.arrived or agent.edge_id is None:
                    continue

            edge = self.graph.pack.edges[agent.edge_id]
            here = occupancy.get(agent.edge_id, 1)
            dens = here / max(edge.length_m * edge.width_m.value, 1.0)
            speed = min(agent.desired_speed_ms, speed_at_density(dens))

            agent.progress_m += speed * dt
            agent.walk_time_s += dt

            while agent.edge_id and agent.progress_m >= edge.length_m:
                agent.progress_m -= edge.length_m
                agent.at = agent.next_zone or agent.at
                agent.next_zone = None
                agent.edge_id = None
                if agent.at == agent.destination:
                    agent.arrived = True
                    self.arrived_walk_times.append(agent.walk_time_s)
                    break
                if (
                    agent.complies
                    and self.time_s - agent.last_route_s > REROUTE_COOLDOWN_S
                    and (self.avoid or self.prefer)
                ):
                    self._plan(agent)
                self._enter_next_edge(agent)
                if agent.arrived or agent.edge_id is None:
                    break
                edge = self.graph.pack.edges[agent.edge_id]

        self.time_s += dt

    def run(self, seconds: float) -> None:
        for _ in range(int(seconds / self.config.tick_s)):
            self.step()

    # -- telemetry ---------------------------------------------------------

    def emit(self) -> list[CrowdNode]:
        """Emit CrowdNode telemetry for the participating agents.

        Identical in type and shape to what a phone produces. The state engine
        cannot tell the difference, which is the invariant that lets the
        simulator stand in for the crowd.

        Which agents participate is fixed at creation (see Agent.participates),
        not sampled here.
        """
        rng = random.Random(self.config.seed ^ int(self.time_s))
        out: list[CrowdNode] = []
        occupancy = self.edge_occupancy()
        epoch = int(self.time_s // 900)

        for agent in self.agents:
            if agent.arrived or not agent.started or agent.edge_id is None:
                continue
            if not agent.participates:
                continue
            edge = self.graph.pack.edges[agent.edge_id]
            src = self.graph.pack.zones.get(edge.source)
            dst = self.graph.pack.zones.get(edge.destination)
            if not src or not dst:
                continue
            t = min(1.0, agent.progress_m / max(edge.length_m, 1e-6))
            x = src.position.x + (dst.position.x - src.position.x) * t
            y = src.position.y + (dst.position.y - src.position.y) * t
            dens = occupancy.get(agent.edge_id, 1) / max(
                edge.length_m * edge.width_m.value, 1.0
            )
            out.append(
                CrowdNode(
                    node_id=f"{agent.id:x}-{epoch}",
                    epoch=epoch,
                    timestamp=self.time_s,
                    position=Position(x=round(x, 2), y=round(y, 2)),
                    speed_ms=round(min(agent.desired_speed_ms, speed_at_density(dens)), 3),
                    heading_deg=0.0,
                    accuracy_m=round(rng.uniform(4.0, 12.0), 1),
                    zone_id=edge.destination,
                )
            )
        return out

    # -- what-if -----------------------------------------------------------

    def fork(self) -> "Simulation":
        """Deep-enough copy for counterfactual evaluation.

        The intervention engine runs candidates against a fork of the live world,
        so 'what if we divert 30%' is answered against actual current state
        rather than a fresh scenario.
        """
        clone = Simulation(self.graph, self.config)
        clone.rng = random.Random(self.rng.random())
        clone.time_s = self.time_s
        clone._next_id = self._next_id
        clone.avoid = set(self.avoid)
        clone.prefer = set(self.prefer)
        clone.agents = [replace(a, path=list(a.path)) for a in self.agents]
        clone.arrived_walk_times = list(self.arrived_walk_times)
        return clone

    @property
    def active(self) -> int:
        return sum(1 for a in self.agents if a.started and not a.arrived)

    @property
    def arrived(self) -> int:
        return sum(1 for a in self.agents if a.arrived)
