"""What the three policies actually cost, measured rather than argued.

The claim being tested is narrow and falsifiable: bounding copies buys a large
reduction in radio cost for a small reduction in delivery, and routing toward
connectivity by encounter history beats spreading copies at random. Three numbers
per class settle it:

  delivery ratio       fraction of originated messages that reached the internet
  mean hop count       how far a delivered message travelled
  copies per message   transmissions per originated message — the battery bill

Copies-per-message is the number that matters most and is the one usually left
out of protocol comparisons, because it is the one that makes epidemic routing
look bad. It is reported first here for that reason.
"""

from __future__ import annotations

from dataclasses import dataclass

from crowdflow_contracts import MeshClass


@dataclass
class PolicyMetrics:
    """Per-traffic-class outcome of one simulated run."""

    traffic_class: MeshClass
    policy: str
    created: int = 0
    delivered: int = 0
    transmissions: int = 0
    hops_total: int = 0
    latency_total_s: float = 0.0
    evictions: int = 0

    def record_delivery(self, hops: int, latency_s: float) -> None:
        """First delivery only. A message that reaches two uplinks was delivered
        once — counting both would let redundancy inflate the ratio past 1."""
        self.delivered += 1
        self.hops_total += hops
        self.latency_total_s += latency_s

    @property
    def delivery_ratio(self) -> float:
        return self.delivered / self.created if self.created else 0.0

    @property
    def mean_hops(self) -> float:
        return self.hops_total / self.delivered if self.delivered else 0.0

    @property
    def copies_per_message(self) -> float:
        return self.transmissions / self.created if self.created else 0.0

    @property
    def mean_latency_s(self) -> float:
        return self.latency_total_s / self.delivered if self.delivered else 0.0

    def as_row(self) -> tuple[str, str, float, float, float, float]:
        return (
            self.traffic_class.value,
            self.policy,
            round(self.delivery_ratio, 3),
            round(self.mean_hops, 2),
            round(self.copies_per_message, 2),
            round(self.mean_latency_s, 1),
        )


@dataclass
class MeshRunMetrics:
    """All three classes from one run over one topology.

    One run, not three: the classes are compared on the same seed, the same node
    positions and the same encounters. Running them separately would let a lucky
    topology flatter whichever policy happened to draw it.
    """

    by_class: dict[MeshClass, PolicyMetrics]
    ticks: int = 0
    mean_uplinks: float = 0.0
    """Elected uplinks per tick — one per radio island, so this counts islands
    that have connectivity, not handsets that do. `mean_online_nodes` is the
    handset count, and the gap between the two is the whole point of election."""

    mean_online_nodes: float = 0.0
    mean_coverage: float = 0.0
    mean_observation_age_s: float = 0.0
    p95_observation_age_s: float = 0.0
    uplink_redundancy: float = 0.0

    def rows(self) -> list[tuple[str, str, float, float, float, float]]:
        return [self.by_class[c].as_row() for c in MeshClass if c in self.by_class]

    @property
    def epidemic_cost_ratio(self) -> float:
        """How many times more radio traffic URGENT costs than STATE.

        The one-line justification for not flooding: if this is large, then
        flooding everything would multiply every phone's radio duty cycle by
        roughly this factor, for a delivery ratio that is only a little higher.
        """
        state = self.by_class.get(MeshClass.STATE)
        urgent = self.by_class.get(MeshClass.URGENT)
        if not state or not urgent or not state.copies_per_message:
            return 0.0
        return urgent.copies_per_message / state.copies_per_message
