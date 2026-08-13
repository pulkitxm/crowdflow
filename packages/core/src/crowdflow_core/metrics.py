"""Metrics and the A/B harness — Phase 3, the gate.

The product's claim is not "we can see the crowd". It is that predicting and
intervening *measurably beats not doing so*. That is falsifiable, testable
entirely in simulation, and cheap — so it is tested before any interface is
built on top of it.

Definitions are pinned here so before/after numbers compare across runs. All of
them are anchored to the density bands in crowdflow_contracts.standards, not to
ad-hoc thresholds.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from crowdflow_contracts import DENSITY_BUILDING_MAX, LOSBand, VenueState


@dataclass
class RunMetrics:
    """What one run produced."""

    peak_density: float = 0.0
    """Highest density seen in any zone. Above DENSITY_BUILDING_MAX means the
    venue went past capacity somewhere."""

    critical_zone_seconds: float = 0.0
    """Total zone-seconds spent at or beyond capacity. The area under the
    problem, not just its height — a brief spike and a sustained jam are very
    different operationally and a peak alone cannot tell them apart."""

    building_zone_seconds: float = 0.0
    peak_critical_zones: int = 0
    total_queue_peak: float = 0.0

    arrived: int = 0
    mean_walk_s: float = 0.0
    p95_walk_s: float = 0.0

    interventions: int = 0
    rejected_by_safety: int = 0

    samples: int = 0
    _walks: list[float] = field(default_factory=list, repr=False)

    def observe(self, state: VenueState, tick_s: float) -> None:
        self.samples += 1
        crit = state.in_band(LOSBand.CRITICAL)
        bld = state.in_band(LOSBand.BUILDING)
        self.critical_zone_seconds += len(crit) * tick_s
        self.building_zone_seconds += len(bld) * tick_s
        self.peak_critical_zones = max(self.peak_critical_zones, len(crit))
        if state.zones:
            self.peak_density = max(
                self.peak_density,
                max(z.density_persons_m2 for z in state.zones.values()),
            )
            self.total_queue_peak = max(
                self.total_queue_peak, sum(z.queue_excess for z in state.zones.values())
            )

    def finalise(self, walk_times: list[float]) -> "RunMetrics":
        self._walks = sorted(walk_times)
        self.arrived = len(self._walks)
        if self._walks:
            self.mean_walk_s = sum(self._walks) / len(self._walks)
            self.p95_walk_s = self._walks[min(len(self._walks) - 1,
                                              int(0.95 * len(self._walks)))]
        return self

    def as_rows(self) -> list[tuple[str, float]]:
        return [
            ("peak density (ped/m2)", round(self.peak_density, 3)),
            ("critical zone-seconds", round(self.critical_zone_seconds, 1)),
            ("building zone-seconds", round(self.building_zone_seconds, 1)),
            ("peak simultaneous critical zones", self.peak_critical_zones),
            ("peak queued (people)", round(self.total_queue_peak, 0)),
            ("arrived", self.arrived),
            ("mean walk (s)", round(self.mean_walk_s, 1)),
            ("p95 walk (s)", round(self.p95_walk_s, 1)),
            ("interventions dispatched", self.interventions),
            ("rejected by safety", self.rejected_by_safety),
        ]


@dataclass
class ABResult:
    """Two runs, same seed, one with intervention."""

    without: RunMetrics
    with_: RunMetrics

    def delta(self, attr: str) -> tuple[float, float]:
        """(absolute change, percent change). Negative is better for costs."""
        a = getattr(self.without, attr)
        b = getattr(self.with_, attr)
        pct = ((b - a) / a * 100.0) if a else 0.0
        return b - a, pct

    @property
    def passes_gate(self) -> bool:
        """The gate: intervention must reduce BOTH how bad it got and how long.

        Requiring both is deliberate. Shaving the peak while extending the jam is
        not an improvement, and neither is the reverse.
        """
        return (
            self.with_.critical_zone_seconds < self.without.critical_zone_seconds
            and self.with_.peak_density <= self.without.peak_density
        )

    def summary(self) -> list[tuple[str, float, float, float]]:
        """(label, without, with, percent change) for every metric."""
        out = []
        for (label, before), (_, after) in zip(
            self.without.as_rows(), self.with_.as_rows()
        ):
            pct = ((after - before) / before * 100.0) if before else 0.0
            out.append((label, before, after, round(pct, 1)))
        return out


def run_scenario(scenario, graph, *, intervene: bool, participation: float,
                 ticks: int, seed: int | None = None):
    """Run one scenario end to end and return (metrics, tick_results).

    Both arms of an A/B use the same seed and the same scenario; the only
    difference is whether the loop is allowed to intervene.
    """
    from .loop import ControlLoop

    sim = scenario.build(graph, participation=participation)
    if seed is not None:
        sim.config = type(sim.config)(
            seed=seed, tick_s=sim.config.tick_s,
            compliance=sim.config.compliance,
            participation=participation,
            speed_sigma=sim.config.speed_sigma,
        )
    loop = ControlLoop(sim, graph, participation=participation, intervene=intervene)

    metrics = RunMetrics()
    results = []
    for _ in range(ticks):
        r = loop.tick()
        metrics.observe(r.state, sim.config.tick_s)
        if r.dispatched:
            metrics.interventions += 1
        if r.verdict is not None and not r.verdict.may_dispatch:
            metrics.rejected_by_safety += 1
        results.append(r)

    metrics.finalise(sim.arrived_walk_times)
    return metrics, results


def ab_test(scenario, graph, *, participation: float, ticks: int) -> ABResult:
    """The experiment. Same seed both arms."""
    without, _ = run_scenario(
        scenario, graph, intervene=False, participation=participation, ticks=ticks
    )
    with_, _ = run_scenario(
        scenario, graph, intervene=True, participation=participation, ticks=ticks
    )
    return ABResult(without=without, with_=with_)
