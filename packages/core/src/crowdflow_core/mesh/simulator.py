"""A mesh with no devices in it.

Protocol logic is algorithmic, so it belongs in core and must be testable without
a single handset. Nothing here knows about Android, Wi-Fi Aware or BLE: N nodes
with positions, a radio range, connectivity from proximity, and messages moving
one hop per encounter. That is the whole physical model, and it is enough to
measure the three things the policy choice rests on.

Two modelling decisions worth defending:

  * **Clustered random waypoint mobility.** Initial homes are clustered and
    waypoints are either venue-wide or bounded around those homes. This is not
    the uniform literature baseline; the clustering is what gives encounter
    history information to learn, and the distinction is stated in config.

  * **Cell saturation is an explicit scenario input.** At the standards-derived
    density the 150-node design case cannot trigger it arithmetically, so the
    default is a prior, not a claimed effect. Tests that study saturation lower
    the configured threshold visibly; reported default runs do not say it helped.

Seeded end to end (invariant 6): same seed, same node placement, same waypoints,
same encounters, same numbers.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from crowdflow_contracts import (
    ASSUMED_MESH_BUFFER_MESSAGES,
    ASSUMED_RADIO_RANGE_CROWD_M,
    DENSITY_BUILDING_MAX,
    FREE_FLOW_SPEED_MS,
    MESH_TTL_MAX,
    MeshClass,
    MeshMessageType,
    Position,
)

from .metrics import MeshRunMetrics, PolicyMetrics
from .node import MeshNode, encounter
from .policy import default_policies
from .uplink import FanIn, UplinkReport, coverage, elect_uplinks, radio_neighbours


@dataclass(frozen=True)
class MeshSimConfig:
    """Everything that makes a run reproducible."""

    seed: int = 1
    node_count: int = 150
    span_m: float = 300.0
    """Side of the square the nodes move in. Not a venue — a neighbourhood, which
    is the scale a TTL of 8 hops can actually cover."""

    radio_range_m: float = ASSUMED_RADIO_RANGE_CROWD_M
    tick_s: float = 5.0
    walk_speed_ms: float = FREE_FLOW_SPEED_MS

    cluster_count: int = 4
    """Crowds are not uniform, and the difference is not cosmetic. Uniform
    placement makes every node statistically identical, which makes encounter
    history carry no information, which makes any history-based routing metric
    provably pointless — you can only measure PRoPHET as useless if you first
    build a world in which nothing is predictable. Clusters give the mesh what a
    circuit has: dense pockets where the cell network dies, and thinner ground
    around them where it does not."""

    roam_radius_m: float | None = None
    """How far a spectator wanders from where they settled. None means classic
    random waypoint over the whole area.

    A spectator has a seat and a preferred bar. Bounded roaming is both more
    realistic and the thing that makes delivery predictability real: a node whose
    ground is near the edge of a pocket meets working uplinks far more often than
    one in the middle, and that difference is exactly what PRoPHET measures."""
    data_plan_fraction: float = 0.25
    """Fraction of nodes whose handset could reach the internet if the cell
    network were healthy. A scenario input, not a threshold: vary it and the
    coverage metric is what responds."""

    participation: float = 0.15
    """Measured elsewhere (unique nodes / attendance). Used here only to convert
    node density into people density for the saturation model, since the crowd is
    what congests the cell, not the subset running the app."""

    saturating: bool = True
    cell_capacity_persons_m2: float = DENSITY_BUILDING_MAX
    """Crowd density at which the local cell stops carrying traffic.

    Defaults to the standards-derived capacity density, because the honest prior
    is that the cell dies about where the crowd does. Configurable because it is
    the one number in this model nobody has measured, and because of a scale
    effect worth stating: a few hundred simulated devices at 15% participation
    represent a few thousand people, and a few thousand people spread over a
    400 m square are NOT dense. At simulator scale the default therefore almost
    never fires, and a scenario that wants to exercise saturation has to say so
    — which is better than a saturation model that silently never runs and is
    mistaken for one that does."""

    battery_floor: float = 0.5
    """Starting battery for every node in the base scenario. Election is what
    varies battery; the sim does not model discharge, and pretending to would be
    a curve nobody measured."""

    buffer_capacity: int = ASSUMED_MESH_BUFFER_MESSAGES
    ttl: int = MESH_TTL_MAX

    state_every_ticks: int = 1
    uplink_every_ticks: int = 1
    urgent_every_ticks: int = 20
    """Offered load per class, in ticks between originations.

    URGENT is rarer than the others by construction, because "affordable
    precisely because it is rare" is an assumption and not a fact — the rate
    limiter enforces the budget but nothing enforces the rarity. Making it a
    config field means a test can violate it deliberately and watch the limiter
    degrade URGENT toward direct delivery, which is the intended failure mode
    rather than a surprise."""

    @classmethod
    def crowd(cls, **overrides) -> MeshSimConfig:
        """The design case, and the one the reported numbers come from.

        Sparse connectivity (5% of handsets with a usable data plan), a
        clustered crowd, and spectators who roam a
        fifth of the neighbourhood rather than all of it. The base dataclass
        uses venue-wide waypoints but still starts from clustered homes; it is
        not labelled as a uniform literature baseline.
        """
        settings: dict = {
            "span_m": 400.0,
            "data_plan_fraction": 0.05,
            "roam_radius_m": 80.0,
            "cluster_count": 4,
        }
        settings.update(overrides)
        return cls(**settings)



@dataclass
class _Walker:
    """Mobility state, kept beside the node rather than inside it.

    A MeshNode is protocol state. It has a position because the radio does, but
    it must not have a destination — a real phone's owner does not tell it where
    they are walking, and a protocol that needed that would not deploy.
    """

    node: MeshNode
    target: Position
    has_data_plan: bool
    home: Position


class MeshSimulator:
    """N nodes, proximity connectivity, hop-by-hop propagation."""

    def __init__(self, config: MeshSimConfig | None = None) -> None:
        self.config = config or MeshSimConfig()
        self.rng = random.Random(self.config.seed)
        self.now = 0.0
        self.tick_count = 0
        self.fan_in = FanIn()

        self._clusters = [self._random_point() for _ in range(max(1, self.config.cluster_count))]
        self.walkers: list[_Walker] = []
        for i in range(self.config.node_count):
            home = self._home_point()
            node = MeshNode(
                f"n{i:04d}",
                home,
                battery=self.config.battery_floor,
                now=0.0,
                buffer_capacity=self.config.buffer_capacity,
                policies=default_policies(),
                population_hint=self.config.node_count,
            )
            has_plan = self.rng.random() < self.config.data_plan_fraction
            node.radio.uplink_throughput_kbps = self.rng.uniform(50.0, 2000.0) if has_plan else 0.0
            self.walkers.append(
                _Walker(
                    node=node,
                    target=self._waypoint(home),
                    has_data_plan=has_plan,
                    home=home,
                )
            )

        self.metrics = MeshRunMetrics(
            by_class={
                MeshClass.STATE: PolicyMetrics(MeshClass.STATE, "spray-and-wait"),
                MeshClass.UPLINK: PolicyMetrics(MeshClass.UPLINK, "spray-and-wait"),
                MeshClass.URGENT: PolicyMetrics(MeshClass.URGENT, "rate-limited-epidemic"),
            }
        )
        self._delivered: set[tuple[str, int]] = set()
        self._uplink_counts: list[int] = []
        self._online_counts: list[int] = []
        self._coverage_fractions: list[float] = []
        self._drained: dict[str, int] = {}
        self.adjacency: dict[str, set[str]] = {}
        self._refresh_topology()

    # -- world -------------------------------------------------------------

    def _random_point(self) -> Position:
        return Position(
            x=self.rng.uniform(0.0, self.config.span_m),
            y=self.rng.uniform(0.0, self.config.span_m),
        )

    def _clamp(self, x: float, y: float) -> Position:
        span = self.config.span_m
        return Position(x=min(max(x, 0.0), span), y=min(max(y, 0.0), span))

    def _home_point(self) -> Position:
        """Where one spectator settles: near a cluster, not anywhere.

        Spread is a tenth of the span, so the clusters stay clusters at any
        scale — a figure in metres would silently become a uniform crowd the
        moment someone doubled the area."""
        centre = self.rng.choice(self._clusters)
        spread = self.config.span_m / 10.0
        return self._clamp(
            self.rng.gauss(centre.x, spread), self.rng.gauss(centre.y, spread)
        )

    def _waypoint(self, home: Position) -> Position:
        if self.config.roam_radius_m is None:
            return self._random_point()
        angle = self.rng.uniform(0.0, 2.0 * math.pi)
        # sqrt of the uniform draw, so waypoints are uniform over the disc rather
        # than piled up at its centre.
        radius = self.config.roam_radius_m * math.sqrt(self.rng.random())
        return self._clamp(home.x + radius * math.cos(angle), home.y + radius * math.sin(angle))

    @property
    def nodes(self) -> list[MeshNode]:
        return [w.node for w in self.walkers]

    def _move(self) -> None:
        step = self.config.walk_speed_ms * self.config.tick_s
        for walker in self.walkers:
            here = walker.node.position
            dx, dy = walker.target.x - here.x, walker.target.y - here.y
            distance = math.hypot(dx, dy)
            if distance <= step:
                walker.node.move_to(walker.target)
                walker.target = self._waypoint(walker.home)
                continue
            walker.node.move_to(
                Position(x=here.x + step * dx / distance, y=here.y + step * dy / distance)
            )

    def _refresh_topology(self) -> None:
        self.adjacency = radio_neighbours(self.nodes, self.config.radio_range_m)

    def _update_connectivity(self) -> None:
        """Decide who has internet this tick.

        Local people density is estimated from how many peers are in radio range
        — the same quantity a real device has — divided by participation to get
        from devices to people. At or above the cell's capacity density the
        uplink is gone, however good the signal was a minute ago.
        """
        area = math.pi * self.config.radio_range_m**2
        for walker in self.walkers:
            if not walker.has_data_plan:
                walker.node.set_online(False, self.now)
                continue
            if not self.config.saturating:
                walker.node.set_online(True, self.now)
                continue
            neighbours = len(self.adjacency.get(walker.node.id, ()))
            device_density = (neighbours + 1) / area
            people_density = device_density / self.config.participation
            saturated = people_density >= self.config.cell_capacity_persons_m2
            walker.node.set_online(not saturated, self.now)

    # -- traffic -----------------------------------------------------------

    def inject(self, traffic_class: MeshClass, payload: dict | None = None) -> None:
        """Originate one message from a randomly chosen node."""
        message_type = {
            MeshClass.STATE: MeshMessageType.ZONE_UPDATE,
            MeshClass.UPLINK: MeshMessageType.STATE_UPDATE,
            MeshClass.URGENT: MeshMessageType.ALERT,
        }[traffic_class]
        source = self.rng.choice(self.walkers).node
        source.originate(
            message_type, traffic_class, payload or {}, self.now, ttl=self.config.ttl
        )
        self.metrics.by_class[traffic_class].created += 1

    def inject_all_classes(self) -> None:
        """One message per class, same tick.

        The comparison is only fair if all three face the same topology at the
        same moment, so they are injected together and never in separate runs.
        """
        for traffic_class in (MeshClass.STATE, MeshClass.UPLINK, MeshClass.URGENT):
            self.inject(traffic_class)

    # -- tick --------------------------------------------------------------

    def tick(self) -> None:
        self.now += self.config.tick_s
        self.tick_count += 1
        self._move()
        self._refresh_topology()
        self._update_connectivity()

        for node in self.nodes:
            node.advance(self.now, self.adjacency.get(node.id, set()))

        # Deterministic encounter order. Without it the run is reproducible only
        # up to dict iteration, which is not reproducible.
        for i, a in enumerate(self.walkers):
            for b in self.walkers[i + 1 :]:
                if b.node.id in self.adjacency.get(a.node.id, ()):
                    encounter(a.node, b.node, self.now)

        self._collect()

    def _collect(self) -> None:
        """Drain uplinks into the dashboard and score deliveries.

        Each uplink pushes only what it has not pushed before, which is what a
        real one would do, and is what makes the fan-in's dedupe do real work:
        the same message genuinely arrives from several uplinks.
        """
        election = elect_uplinks(self.nodes, self.adjacency)
        self._uplink_counts.append(len(election.uplinks))
        self._online_counts.append(sum(1 for n in self.nodes if n.online))
        self._coverage_fractions.append(
            coverage(self.adjacency, election.uplinks, max_hops=self.config.ttl).node_fraction
        )

        elected = set(election.uplinks)
        for node in self.nodes:
            # Election must affect uploads, not merely the reported count. One
            # winner per island drains the overlapping view; every online phone
            # uploading made election decorative and inflated redundancy.
            if node.id not in elected or not node.uplinked:
                continue
            already = self._drained.get(node.id, 0)
            fresh = node.uplinked[already:]
            if not fresh:
                continue
            self._drained[node.id] = len(node.uplinked)
            self.fan_in.receive(
                UplinkReport(uplink_id=node.id, sent_at=self.now, deliveries=fresh),
                received_at=self.now,
            )
            for delivery in fresh:
                if delivery.key in self._delivered:
                    continue
                self._delivered.add(delivery.key)
                self.metrics.by_class[delivery.traffic_class].record_delivery(
                    delivery.hops, delivery.transit_s
                )

    def intervals(self) -> dict[MeshClass, int]:
        return {
            MeshClass.STATE: self.config.state_every_ticks,
            MeshClass.UPLINK: self.config.uplink_every_ticks,
            MeshClass.URGENT: self.config.urgent_every_ticks,
        }

    def run(self, ticks: int) -> MeshRunMetrics:
        """Run and return the comparison.

        All three classes share one topology and one RNG stream, so the delivery
        ratios are directly comparable; only the offered load differs, and it
        differs because the classes genuinely do.
        """
        for i in range(ticks):
            for traffic_class, every in self.intervals().items():
                if every > 0 and i % every == 0:
                    self.inject(traffic_class)
            self.tick()
        return self.finalise()

    def finalise(self) -> MeshRunMetrics:
        for traffic_class, metrics in self.metrics.by_class.items():
            metrics.transmissions = sum(
                n.transmissions_by_class[traffic_class] for n in self.nodes
            )
            metrics.evictions = sum(
                n.buffer.evictions_by_class[traffic_class] for n in self.nodes
            )
        self.metrics.ticks = self.tick_count
        self.metrics.mean_uplinks = (
            sum(self._uplink_counts) / len(self._uplink_counts) if self._uplink_counts else 0.0
        )
        self.metrics.mean_coverage = (
            sum(self._coverage_fractions) / len(self._coverage_fractions)
            if self._coverage_fractions
            else 0.0
        )
        self.metrics.mean_online_nodes = (
            sum(self._online_counts) / len(self._online_counts) if self._online_counts else 0.0
        )
        self.metrics.mean_observation_age_s = self.fan_in.mean_age_at_receipt_s
        self.metrics.p95_observation_age_s = self.fan_in.p95_age_at_receipt_s
        self.metrics.uplink_redundancy = self.fan_in.redundancy
        return self.metrics


def compare_policies(config: MeshSimConfig | None = None, ticks: int = 200) -> MeshRunMetrics:
    """The headline experiment: one topology, three policies, three costs."""
    return MeshSimulator(config or MeshSimConfig.crowd()).run(ticks)
