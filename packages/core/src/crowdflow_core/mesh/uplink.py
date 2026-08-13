"""Opportunistic uplink election, and the dashboard's fan-in.

There is no gateway (D7). Cell networks saturate exactly when and where crowd
density peaks, so a fixed gateway is a device guaranteed to fail at the moment it
matters; a floating one degrades instead, because "who has internet" is
re-answered every few seconds by whoever currently does.

That inverts the dashboard's problem. It is not reading one stream, it is reading
N overlapping partial views from uplinks that appear and vanish, whose clocks
disagree, and whose observations are stale by an amount that depends on how many
hops they took. Three consequences, all handled here:

  * **Dedupe by (source, sequence).** The same observation arrives via several
    uplinks. Counting it once per uplink inflates the crowd by the redundancy
    factor — a silent, plausible-looking error that gets worse exactly where
    coverage is best.
  * **Every observation carries an age.** Not a timestamp: an age, reconciled
    against the reporting uplink's clock skew. An observation without an age is
    indistinguishable from a fresh one, which is how a stale map gets acted on.
  * **Coverage is a first-class metric.** A region no uplink can reach is not
    quiet, it is unheard (invariant 5, at the transport layer). The dashboard has
    to be able to say which is which.

Election is LEXICOGRAPHIC, not a weighted score. Weights would let a phone at 8%
battery win by having a good connection, and there is no exchange rate between
"fast uplink" and "handset dies during the race" worth writing down.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from crowdflow_contracts import ASSUMED_UPLINK_BATTERY_RESERVE, MESH_TTL_MAX, MeshMessage

from .buffer import MessageKey
from .node import Delivery, MeshNode

ASSUMED_SKEW_WINDOW_S = 300.0
"""How much history the clock-skew minimum filter keeps, seconds.

Long enough that the minimum has seen a lightly loaded moment (the estimator is
only as good as its best sample), short enough that handset crystal drift — parts
per million, so milliseconds over five minutes — stays far below the latency
variation the filter is there to remove. ASSUMED; it is a filter window, and the
failure mode of getting it wrong is a slightly worse age estimate, not a wrong
one."""


# ------------------------------------------------------------------ election --

@dataclass(frozen=True)
class UplinkCandidate:
    """A node offering to be an uplink, with the facts election is decided on.

    All four are measured on the device. None is inferred, and none is a score.
    """

    node_id: str
    online: bool
    battery: float
    throughput_kbps: float
    peer_degree: int

    @classmethod
    def of(cls, node: MeshNode, peer_degree: int) -> UplinkCandidate:
        return cls(
            node_id=node.id,
            online=node.online,
            battery=node.radio.battery,
            throughput_kbps=node.radio.uplink_throughput_kbps,
            peer_degree=peer_degree,
        )

    @property
    def eligible(self) -> bool:
        """Hard gates only. A node that is offline cannot uplink; a node below
        the battery reserve must not be asked to."""
        return self.online and self.battery >= ASSUMED_UPLINK_BATTERY_RESERVE

    @property
    def rank(self) -> tuple:
        """Lexicographic preference, best first when sorted.

        Order of the comparisons IS the policy: throughput, then how many peers
        this node can drain, then battery headroom, then node id. The id tiebreak
        is what makes election reproducible — two nodes with identical facts must
        elect the same winner or the mesh oscillates between them, each handing
        the other traffic it then hands back.
        """
        return (-self.throughput_kbps, -self.peer_degree, -self.battery, self.node_id)


def radio_neighbours(
    nodes: Sequence[MeshNode], radio_range_m: float
) -> dict[str, set[str]]:
    """Adjacency from proximity. O(n^2) — fine at the scale a mesh is meshy."""
    adjacency: dict[str, set[str]] = {n.id: set() for n in nodes}
    for i, a in enumerate(nodes):
        for b in nodes[i + 1 :]:
            dx = a.position.x - b.position.x
            dy = a.position.y - b.position.y
            if dx * dx + dy * dy <= radio_range_m * radio_range_m:
                adjacency[a.id].add(b.id)
                adjacency[b.id].add(a.id)
    return adjacency


def components(adjacency: Mapping[str, set[str]]) -> list[set[str]]:
    """Connected components of the radio graph — the actual mesh islands.

    A crowd is not one mesh. It is a shifting set of islands, and each island
    needs its own uplink or it has none.
    """
    unvisited = set(adjacency)
    found: list[set[str]] = []
    while unvisited:
        start = unvisited.pop()
        island = {start}
        frontier = [start]
        while frontier:
            current = frontier.pop()
            for peer in adjacency.get(current, ()):
                if peer not in island:
                    island.add(peer)
                    unvisited.discard(peer)
                    frontier.append(peer)
        found.append(island)
    return found


@dataclass(frozen=True)
class Election:
    """Who uplinks for whom, this second."""

    assignments: dict[str, str]
    """node_id -> elected uplink id, for nodes on an island that has one."""

    uplinks: list[str]
    unserved: list[set[str]] = field(default_factory=list)
    """Islands with no eligible uplink. Reported, never hidden: these are the
    nodes whose observations are not reaching anyone."""

    @property
    def served_fraction(self) -> float:
        total = len(self.assignments) + sum(len(i) for i in self.unserved)
        return len(self.assignments) / total if total else 0.0


def elect_uplinks(
    nodes: Sequence[MeshNode], adjacency: Mapping[str, set[str]]
) -> Election:
    """Elect one uplink per radio island.

    One per island, not one per node with internet: the point of election is that
    a hundred phones do not each upload the same overlapping view over a cell
    tower that is already saturated. Every node on the island then routes toward
    connectivity — which, being PRoPHET, it was doing anyway.
    """
    by_id = {n.id: n for n in nodes}
    assignments: dict[str, str] = {}
    elected: list[str] = []
    unserved: list[set[str]] = []

    for island in components(adjacency):
        candidates = [
            UplinkCandidate.of(by_id[nid], len(adjacency.get(nid, ())))
            for nid in sorted(island)
            if nid in by_id
        ]
        eligible = [c for c in candidates if c.eligible]
        if not eligible:
            unserved.append(island)
            continue
        winner = min(eligible, key=lambda c: c.rank)
        elected.append(winner.node_id)
        for nid in island:
            assignments[nid] = winner.node_id
    return Election(assignments=assignments, uplinks=elected, unserved=unserved)


# ------------------------------------------------------------------ coverage --

@dataclass(frozen=True)
class CoverageReport:
    """Which parts of the venue are currently within reach of an uplink.

    `uncovered_zones` is the operationally important half. A zone in that list
    must render as unknown, not as empty — the same rule the state engine applies
    to a zone with no devices, applied one layer down to a zone whose devices
    cannot get their data out.
    """

    covered_nodes: set[str]
    uncovered_nodes: set[str]
    covered_zones: set[str]
    uncovered_zones: set[str]
    max_hops: int

    @property
    def node_fraction(self) -> float:
        total = len(self.covered_nodes) + len(self.uncovered_nodes)
        return len(self.covered_nodes) / total if total else 0.0

    @property
    def zone_fraction(self) -> float:
        total = len(self.covered_zones) + len(self.uncovered_zones)
        return len(self.covered_zones) / total if total else 0.0


def coverage(
    adjacency: Mapping[str, set[str]],
    uplinks: Iterable[str],
    zone_of: Mapping[str, str] | None = None,
    max_hops: int = MESH_TTL_MAX,
) -> CoverageReport:
    """Nodes within `max_hops` of any uplink, and the zones they stand in.

    Bounded by hops rather than by connectivity because TTL is real: being on the
    same island as an uplink is not the same as being able to reach it. A node
    nine hops away is in the mesh and out of contact.
    """
    frontier = deque((u, 0) for u in uplinks if u in adjacency)
    reached = {u for u, _ in frontier}
    while frontier:
        current, depth = frontier.popleft()
        if depth >= max_hops:
            continue
        for peer in adjacency.get(current, ()):
            if peer not in reached:
                reached.add(peer)
                frontier.append((peer, depth + 1))

    everyone = set(adjacency)
    unreached = everyone - reached
    zone_of = zone_of or {}
    covered_zones = {zone_of[n] for n in reached if n in zone_of}
    all_zones = {zone_of[n] for n in everyone if n in zone_of}
    return CoverageReport(
        covered_nodes=reached,
        uncovered_nodes=unreached,
        covered_zones=covered_zones,
        uncovered_zones=all_zones - covered_zones,
        max_hops=max_hops,
    )


# -------------------------------------------------------------------- fan-in --

@dataclass(frozen=True)
class UplinkReport:
    """What one uplink pushes to the dashboard.

    `sent_at` is the uplink's OWN clock, not the dashboard's. Naming it that way
    is the point: it is not comparable to anything until it has been reconciled.
    """

    uplink_id: str
    sent_at: float
    deliveries: Sequence[Delivery]


@dataclass
class Observation:
    """One de-duplicated observation as the dashboard holds it."""

    key: MessageKey
    message: MeshMessage
    origin_timestamp: float
    """The originating device's clock, corrected by the reporting uplink's
    estimated skew."""

    hops: int
    via: str
    received_at: float
    reported_by: set[str] = field(default_factory=set)
    """Every uplink that reported this. Size > 1 means redundant coverage, which
    is good news about the mesh and a double-count waiting to happen if the
    dedupe below is ever removed."""

    def age_s(self, now: float) -> float:
        """How stale this observation is, in dashboard time.

        Lag depends on hop count and on how long the last custodian walked before
        meeting an uplink, so it varies by an order of magnitude between two
        observations arriving in the same batch. Consumers must weight by this,
        which they can only do if it is attached to every observation.
        """
        return now - self.origin_timestamp


class ClockSkew:
    """One-way clock offset estimate per uplink, by minimum filter.

    Honest about its own limits: with one-way messages, offset and latency are
    not separable — that is what a round trip is for, and there is no round trip
    to a phone that has already walked away. What IS available is that the true
    offset can never exceed the smallest observed (received_at - sent_at), since
    latency is non-negative. Taking the minimum over a window therefore bounds
    the error by the VARIATION in one-way latency rather than by its magnitude,
    which for a mesh whose latency varies by seconds is the difference between an
    age that is roughly right and one that is arbitrary.
    """

    def __init__(self, window_s: float = ASSUMED_SKEW_WINDOW_S) -> None:
        self.window_s = window_s
        self._samples: dict[str, deque[tuple[float, float]]] = {}

    def observe(self, uplink_id: str, sent_at: float, received_at: float) -> float:
        samples = self._samples.setdefault(uplink_id, deque())
        samples.append((received_at, received_at - sent_at))
        while samples and received_at - samples[0][0] > self.window_s:
            samples.popleft()
        return self.offset(uplink_id)

    def offset(self, uplink_id: str) -> float:
        samples = self._samples.get(uplink_id)
        if not samples:
            return 0.0
        return min(delta for _, delta in samples)

    def correct(self, uplink_id: str, remote_time: float) -> float:
        """Map a remote clock reading into dashboard time."""
        return remote_time + self.offset(uplink_id)


class FanIn:
    """The dashboard side: N uplinks in, one de-duplicated view out."""

    def __init__(self, skew_window_s: float = ASSUMED_SKEW_WINDOW_S) -> None:
        self.skew = ClockSkew(window_s=skew_window_s)
        self.observations: dict[MessageKey, Observation] = {}
        self.duplicates = 0
        self.reports = 0
        self._age_at_receipt: list[float] = []
        """Age of each observation at the moment it landed, kept separately from
        the live ages below. Averaging live ages over a whole run says only how
        long ago the run started; the number the operator needs is how stale an
        observation is when it ARRIVES, because that is the floor on how fresh
        the map can ever be."""

    def receive(self, report: UplinkReport, received_at: float) -> list[Observation]:
        """Absorb one uplink's report. Returns only the NEW observations.

        Returning the new ones rather than all of them matters downstream: the
        state engine scales counts by participation, so handing it the same
        observation twice does not look like an error, it looks like a crowd.
        """
        self.reports += 1
        self.skew.observe(report.uplink_id, report.sent_at, received_at)

        fresh: list[Observation] = []
        for delivery in report.deliveries:
            existing = self.observations.get(delivery.key)
            if existing is not None:
                existing.reported_by.add(report.uplink_id)
                self.duplicates += 1
                continue
            observation = Observation(
                key=delivery.key,
                message=delivery.message,
                origin_timestamp=self.skew.correct(
                    report.uplink_id, delivery.origin_timestamp
                ),
                hops=delivery.hops,
                via=report.uplink_id,
                received_at=received_at,
                reported_by={report.uplink_id},
            )
            self.observations[delivery.key] = observation
            self._age_at_receipt.append(observation.age_s(received_at))
            fresh.append(observation)
        return fresh

    def ages(self, now: float) -> list[float]:
        return [o.age_s(now) for o in self.observations.values()]

    def mean_age_s(self, now: float) -> float:
        ages = self.ages(now)
        return sum(ages) / len(ages) if ages else 0.0

    @property
    def mean_age_at_receipt_s(self) -> float:
        if not self._age_at_receipt:
            return 0.0
        return sum(self._age_at_receipt) / len(self._age_at_receipt)

    @property
    def p95_age_at_receipt_s(self) -> float:
        """The tail is the operationally interesting part: hop count varies, so
        the worst observations in a batch are far older than the mean, and an
        operator shown a mean is being told the map is fresher than it is."""
        if not self._age_at_receipt:
            return 0.0
        ordered = sorted(self._age_at_receipt)
        return ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))]

    @property
    def redundancy(self) -> float:
        """Mean number of uplinks that reported each observation.

        Above 1 means overlapping views — which is the design working, and the
        exact quantity that would inflate every density estimate without the
        dedupe above.
        """
        if not self.observations:
            return 0.0
        total = sum(len(o.reported_by) for o in self.observations.values())
        return total / len(self.observations)
