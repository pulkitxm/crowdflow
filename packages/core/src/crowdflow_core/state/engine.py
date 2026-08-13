"""Telemetry -> VenueState.

Takes CrowdNode observations and produces per-zone flow rates, LOS bands and
confidence. Everything downstream reads this and nothing else.

Three things it must get right, because each is a way of quietly lying:

  * **Scale by measured participation.** Observed devices are not people. The
    scaling factor is measured (unique nodes vs attendance) and carried in the
    state so nothing downstream can forget it was applied.
  * **Report unknown as unknown.** A zone nobody is reporting from is not empty.
    Under D7 uplinks are opportunistic, so silence is common and must never
    render as quiet.
  * **Attach confidence to the claim.** Three nodes and four hundred nodes give
    the same flow number with very different meaning.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from crowdflow_contracts import (
    ASSUMED_CONFIDENCE_COUNT_SATURATION,
    ASSUMED_CONFIDENCE_COUNT_WEIGHT,
    ASSUMED_POSITION_ACCURACY_BEST_M,
    ASSUMED_POSITION_ACCURACY_WORST_M,
    CircuitPack,
    Confidence,
    CrowdNode,
    VenueState,
    ZoneState,
)

from .flow import flow_from_occupancy, queue_excess

DEFAULT_WINDOW_S = 30.0
"""Observations older than this stop contributing. Long enough to smooth GNSS
jitter, short enough that a surge is not averaged away."""

STALE_S = 90.0
"""Beyond this a zone is treated as unobserved rather than stale-but-known."""


@dataclass
class _Counters:
    """Per-zone crossing counters. Occupancy is NOT stored here — see below."""

    entered: int = 0
    exited: int = 0


class StateEngine:
    """Sliding-window aggregation over CrowdNode telemetry.

    Stateful across ticks (it needs history for inflow/outflow and stability),
    but pure in the sense that matters: no I/O, and nothing it cannot recompute
    from the observations it was given.
    """

    def __init__(
        self,
        pack: CircuitPack,
        participation_rate: float,
        window_s: float = DEFAULT_WINDOW_S,
    ) -> None:
        if not 0 < participation_rate <= 1:
            raise ValueError("participation_rate must be measured and in (0, 1]")
        self.pack = pack
        self.participation_rate = participation_rate
        self.window_s = window_s
        # One authoritative record per device: its most recent observation.
        #
        # Per-zone buckets are wrong for two reasons that compound. A device
        # reporting every two seconds lands fifteen records in a thirty-second
        # window, and a device that MOVES lands in the old zone's bucket and the
        # new one at the same time. Both inflate the crowd — the first by the
        # sampling rate, the second by however many zones a walker crosses. A
        # device is in exactly one place, so it gets exactly one record.
        self._latest: dict[str, CrowdNode] = {}
        self._counters: dict[str, _Counters] = {}
        self._last_zone: dict[str, str] = {}
        self._history: dict[str, list[float]] = {}
        self._last_seen: dict[str, float] = {}

    # -- ingest ------------------------------------------------------------

    def ingest(self, nodes: list[CrowdNode], now: float) -> int:
        """Absorb a batch of observations. Returns how many were kept.

        Deduplicates by (node_id, timestamp): under D7 the same observation
        arrives via several uplinks, and counting it twice inflates the crowd.
        """
        seen: set[tuple[str, float]] = set()
        kept = 0
        for n in nodes:
            key = (n.node_id, n.timestamp)
            if key in seen:
                continue
            seen.add(key)
            if now - n.timestamp > self.window_s:
                continue
            zone = n.zone_id or self._nearest_zone(n)
            if zone is None:
                continue

            previous = self._last_zone.get(n.node_id)
            if previous != zone:
                self._counters.setdefault(zone, _Counters()).entered += 1
                if previous:
                    self._counters.setdefault(previous, _Counters()).exited += 1
                self._last_zone[n.node_id] = zone

            held = self._latest.get(n.node_id)
            if held is None or n.timestamp >= held.timestamp:
                self._latest[n.node_id] = n.model_copy(update={"zone_id": zone})
            self._last_seen[zone] = max(self._last_seen.get(zone, 0.0), n.timestamp)
            kept += 1
        return kept

    def _nearest_zone(self, node: CrowdNode) -> str | None:
        """Bind an unassigned observation to a zone. O(n) — fine at venue scale."""
        best, best_d = None, math.inf
        for zid, z in self.pack.zones.items():
            d = math.dist(
                (node.position.x, node.position.y), (z.position.x, z.position.y)
            )
            if d < best_d:
                best, best_d = zid, d
        return best

    # -- aggregate ---------------------------------------------------------

    def _zone_width_and_length(self, zone_id: str) -> tuple[float, float]:
        """Representative corridor dimensions for a zone.

        A zone owns **half of each edge incident to it** — the standard way to
        attribute corridor area to a node, and the only one that behaves. Taking
        the mean incident length instead lets a single 3 m access stub define the
        area of a grandstand exit, which produces a jammed reading from a handful
        of people and a CRITICAL band ten seconds into any egress.

            area  = sum(0.5 * length_i * width_i)
            width = length-weighted mean width
            length = area / width          (so density = people / area)

        Flow is per metre of width, so a zone with no incident edge has no
        computable flow — it gets the narrowest sensible default rather than a
        silent zero.
        """
        area = 0.0
        weighted_width = 0.0
        total_length = 0.0
        for e in self.pack.edges.values():
            if e.source == zone_id or e.destination == zone_id:
                area += 0.5 * e.length_m * e.width_m.value
                weighted_width += e.width_m.value * e.length_m
                total_length += e.length_m
        if total_length <= 0 or area <= 0:
            return 2.0, 25.0
        width = weighted_width / total_length
        return width, area / width

    def snapshot(self, now: float, session_state: str | None = None) -> VenueState:
        """Produce the state for this tick."""
        zones: dict[str, ZoneState] = {}
        observed: set[str] = set()

        # Expire, then bucket by CURRENT zone. Each device appears exactly once.
        stale = [k for k, n in self._latest.items() if now - n.timestamp > self.window_s]
        for k in stale:
            del self._latest[k]
            self._last_zone.pop(k, None)

        by_zone: dict[str, list[CrowdNode]] = {}
        for n in self._latest.values():
            by_zone.setdefault(n.zone_id or "", []).append(n)

        for zone_id, fresh in by_zone.items():
            if not zone_id or not fresh:
                continue
            observed.add(zone_id)
            counters = self._counters.setdefault(zone_id, _Counters())

            count = len(fresh)
            people = count / self.participation_rate
            width, length = self._zone_width_and_length(zone_id)
            mean_speed = sum(n.speed_ms for n in fresh) / count
            dens, _, flow = flow_from_occupancy(people, length, width, mean_speed)
            queued = queue_excess(people, length, width)

            history = self._history.setdefault(zone_id, [])
            history.append(dens)
            del history[:-10]
            stability = self._stability(history)

            minutes = max(self.window_s / 60.0, 1e-6)
            zones[zone_id] = ZoneState(
                zone_id=zone_id,
                timestamp=now,
                observed_nodes=count,
                participation_rate=self.participation_rate,
                density_persons_m2=round(dens, 4),
                flow_ped_m_min=round(flow, 2),
                queue_excess=round(queued, 1),
                mean_speed_ms=round(mean_speed, 3),
                dominant_heading_deg=None,
                inflow_per_min=round(counters.entered / minutes, 1),
                outflow_per_min=round(counters.exited / minutes, 1),
                confidence=self._confidence(fresh, now, stability),
            )
            counters.entered = 0
            counters.exited = 0

        unobserved = [
            zid
            for zid in self.pack.zones
            if zid not in observed and now - self._last_seen.get(zid, -1e9) > STALE_S
        ]

        return VenueState(
            circuit_id=self.pack.id,
            timestamp=now,
            session_id=session_state,
            zones=zones,
            unobserved_zones=unobserved,
        )

    # -- confidence --------------------------------------------------------

    @staticmethod
    def _stability(history: list[float]) -> float:
        """Agreement with recent estimates. A jumping estimate is a weak one."""
        if len(history) < 3:
            return 0.4
        mean = sum(history) / len(history)
        if mean <= 0:
            return 1.0
        var = sum((h - mean) ** 2 for h in history) / len(history)
        return max(0.0, min(1.0, 1.0 - (math.sqrt(var) / mean)))

    def _confidence(self, nodes: list[CrowdNode], now: float, stability: float) -> Confidence:
        """Combine sample size, freshness, accuracy and stability.

        Deliberately conservative on sample size: the count term only approaches
        1 in the hundreds, so a handful of devices cannot produce a confident
        claim however clean their data looks.
        """
        count = len(nodes)
        freshness = now - max(n.timestamp for n in nodes)
        accuracy = sum(n.accuracy_m for n in nodes) / count

        count_term = min(
            1.0,
            math.log1p(count) / math.log1p(ASSUMED_CONFIDENCE_COUNT_SATURATION),
        )
        fresh_term = max(0.0, 1.0 - freshness / self.window_s)
        accuracy_span = (
            ASSUMED_POSITION_ACCURACY_WORST_M - ASSUMED_POSITION_ACCURACY_BEST_M
        )
        acc_term = max(
            0.0,
            min(
                1.0,
                1.0
                - (accuracy - ASSUMED_POSITION_ACCURACY_BEST_M) / accuracy_span,
            ),
        )

        # Count is the majority of the evidence. The former 0.4 share let fresh,
        # accurate reports from three phones clear the action floor. These
        # ASSUMED weights are explicit pending calibration against labelled
        # interventions; freshness, accuracy and stability share the remainder.
        count_weight = ASSUMED_CONFIDENCE_COUNT_WEIGHT
        quality_terms = (fresh_term, acc_term, stability)
        quality_weight = (1.0 - count_weight) / len(quality_terms)
        value = count_weight * count_term + quality_weight * (
            fresh_term + acc_term + stability
        )
        return Confidence(
            value=round(max(0.0, min(1.0, value)), 3),
            observed_nodes=count,
            freshness_s=round(freshness, 2),
            mean_accuracy_m=round(accuracy, 2),
            stability=round(stability, 3),
        )
