"""Intervention: simulate the options, then pick the smallest one that works.

When the predictor says a bottleneck is coming, the wrong move is to reroute
immediately. The right move is to ask what each candidate would actually do —
against the current world, not a fresh scenario — and then choose the *minimum
effective* one.

Minimum matters. A bigger diversion usually reduces peak flow further, but every
diverted person walks further, and past a point the diversion creates the queue
it was avoiding. The rejected candidates are kept and shown: a recommendation
without its alternatives is an assertion, with them it is an argument.
"""

from __future__ import annotations

from dataclasses import dataclass

from crowdflow_contracts import (
    DENSITY_BUILDING_MAX,
    InterventionCandidate,
    ScoreBreakdown,
)

from ..simulation.model import Simulation

DEFAULT_FRACTIONS = (0.0, 0.1, 0.2, 0.3, 0.4)
"""0.0 is the do-nothing baseline and is always evaluated. Without it there is
nothing to compare against and 'it helped' is unfalsifiable."""

WALK_COST_PER_MIN = 8.0
"""Score penalty per extra minute of mean walking time. ASSUMED — it encodes how
much operator patience an added minute is worth, which is a judgement, not a
measurement. Exposed so it can be argued with."""


@dataclass
class WhatIfResult:
    candidates: list[InterventionCandidate]
    selected: InterventionCandidate | None

    @property
    def baseline(self) -> InterventionCandidate | None:
        return next((c for c in self.candidates if c.divert_fraction == 0.0), None)


class InterventionEngine:
    """Counterfactual sweep over diversion fractions."""

    def __init__(self, horizon_s: float = 300.0, fractions=DEFAULT_FRACTIONS) -> None:
        self.horizon_s = horizon_s
        # The do-nothing baseline is not a candidate the caller may omit. Without
        # it, `reduction` is measured against nothing, every diversion scores as
        # an improvement, and the engine recommends acting whatever the world is
        # doing. Injected here rather than trusted to the caller, and sorted so a
        # caller's ordering cannot decide a tie.
        self.fractions = tuple(sorted({0.0, *fractions}))

    def _evaluate(
        self, sim: Simulation, fraction: float, avoid: set[str], prefer: set[str]
    ) -> tuple[float, float, float]:
        """Run one candidate on a fork. Returns (peak_flow, mean_walk_s, over_s)."""
        fork = sim.fork()
        if fraction > 0:
            fork.avoid = set(avoid)
            fork.prefer = set(prefer)
            # Only `fraction` of compliant agents actually divert.
            for i, agent in enumerate(fork.agents):
                if agent.complies and (i % 100) >= fraction * 100:
                    agent.complies = False
        else:
            fork.avoid = set()
            fork.prefer = set()

        peak = 0.0
        over = 0.0
        steps = int(self.horizon_s / fork.config.tick_s)
        for _ in range(steps):
            fork.step()
            occ = fork.edge_occupancy()
            for eid, n in occ.items():
                e = fork.graph.pack.edges[eid]
                from ..state.flow import density as _density

                d = _density(n, e.length_m, e.width_m.value)
                if d > peak:
                    peak = d
                if d >= DENSITY_BUILDING_MAX:
                    over += fork.config.tick_s

        walks = fork.arrived_walk_times
        mean_walk = sum(walks) / len(walks) if walks else 0.0
        return peak, mean_walk, over

    def evaluate(
        self,
        sim: Simulation,
        *,
        from_zone: str,
        to_zone: str,
        avoid: set[str],
        prefer: set[str],
    ) -> WhatIfResult:
        results: list[tuple[float, float, float, float]] = []
        for fraction in self.fractions:
            peak, walk, over = self._evaluate(sim, fraction, avoid, prefer)
            results.append((fraction, peak, walk, over))

        base_peak = next((p for f, p, _, _ in results if f == 0.0), None)
        base_walk = next((w for f, _, w, _ in results if f == 0.0), None)

        candidates: list[InterventionCandidate] = []
        for fraction, peak, walk, over in results:
            reduction = 0.0 if not base_peak else (base_peak - peak) / base_peak * 100
            walk_delta = 0.0 if base_walk is None else walk - base_walk
            headroom = max(0.0, DENSITY_BUILDING_MAX - peak)

            score = ScoreBreakdown(
                congestion_reduction=round(reduction, 2),
                walk_time_cost=round(max(0.0, walk_delta / 60.0) * WALK_COST_PER_MIN, 2),
                capacity_headroom=round(min(headroom, 2.0) * 15.0, 2),
                safety_margin=round(0.0 if peak >= DENSITY_BUILDING_MAX else 10.0, 2),
                fairness=round(10.0 * (1.0 - fraction), 2),
            )
            candidates.append(
                InterventionCandidate(
                    candidate_id=f"divert-{int(fraction * 100):02d}",
                    description=(
                        "No intervention"
                        if fraction == 0
                        else f"Divert {fraction:.0%} of {from_zone} traffic to "
                             f"{to_zone} via {', '.join(sorted(prefer)) or 'alternate route'}"
                    ),
                    divert_fraction=fraction,
                    from_zone=from_zone,
                    to_zone=to_zone,
                    via=sorted(prefer),
                    projected_peak_flow=round(peak, 2),
                    projected_walk_time_delta_s=round(walk_delta, 1),
                    projected_bottleneck_duration_s=round(over, 1),
                    score=score,
                )
            )

        best = max(
            (c for c in candidates if c.divert_fraction > 0),
            key=lambda c: c.score.total,
            default=None,
        )
        baseline = next((c for c in candidates if c.divert_fraction == 0.0), None)
        if best and baseline and best.score.total <= baseline.score.total:
            best = None  # doing nothing wins; say so rather than intervening anyway

        if best is not None:
            candidates = [
                c.model_copy(update={"selected": c.candidate_id == best.candidate_id})
                for c in candidates
            ]
            best = next(c for c in candidates if c.selected)

        return WhatIfResult(candidates=candidates, selected=best)
