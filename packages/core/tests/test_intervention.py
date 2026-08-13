"""Intervention: the counterfactual sweep, and the right to recommend nothing.

The engine's claim is not "this reroute helps". It is "this reroute helps *more
than doing nothing*, and here is the run that shows it". Two properties carry
that claim, and both are tested here:

  * the do-nothing baseline is always evaluated — it is the denominator of every
    percentage the operator is shown;
  * a candidate that does not beat it is not selected, and is still displayed.

Everything runs on a four-zone venue with one deliberate pinch point, small
enough that the peak density can be checked by hand.
"""

from __future__ import annotations

import pytest
from crowdflow_contracts import DENSITY_BUILDING_MAX

from crowdflow_core.intervention import InterventionEngine
from crowdflow_core.intervention.whatif import DEFAULT_FRACTIONS
from crowdflow_core.routing import VenueGraph
from crowdflow_core.simulation import SimConfig, Simulation

from conftest import edge, make_pack, zone

HORIZON_S = 200.0
"""Counterfactual length per candidate. Long enough for the pinch to saturate at
these walking distances, short enough to keep the suite quick."""

CROWD = 900
"""Agents in the test scenario. Sized so the pinch goes past capacity on the
do-nothing run — a baseline that never congests cannot demonstrate anything."""

SPREAD_S = 240.0
"""Departures spread over four minutes. A step release would have every agent on
the first edge before any advisory could reach them, which tests the fork
machinery and nothing about intervention."""


@pytest.fixture
def pinch_world() -> tuple[Simulation, VenueGraph]:
    """One short narrow route and one long wide one.

    stand --(50 m x 2 m)-- pinch --(50 m x 2 m)-- exit     100 m, 100 m^2 per edge
    stand --(120 m x 10 m)- plaza --(120 m x 10 m)- exit   240 m, 1200 m^2 per edge

    Everyone takes the short one, because it is short. That is the situation an
    operator is looking at when they consider a diversion.
    """
    pack = make_pack(
        [
            zone("stand", 0.0, 0.0),
            zone("pinch", 50.0, 0.0),
            zone("plaza", 50.0, 120.0),
            zone("exit", 100.0, 0.0),
        ],
        [
            edge("e_stand_pinch", "stand", "pinch", 50.0, width_m=2.0),
            edge("e_pinch_exit", "pinch", "exit", 50.0, width_m=2.0),
            edge("e_stand_plaza", "stand", "plaza", 120.0, width_m=10.0),
            edge("e_plaza_exit", "plaza", "exit", 120.0, width_m=10.0),
        ],
    )
    graph = VenueGraph(pack, "race")
    sim = Simulation(graph, SimConfig(seed=7, compliance=1.0, participation=0.2))
    sim.add_agents(CROWD, "stand", "exit", spread_s=SPREAD_S)
    for _ in range(5):
        sim.step()  # let the egress start before anyone considers intervening
    return sim, graph


def _by_fraction(result, fraction: float):
    return next(c for c in result.candidates if c.divert_fraction == fraction)


# ------------------------------------------------------- the baseline -------

def test_the_do_nothing_baseline_is_always_evaluated(pinch_world):
    sim, _ = pinch_world
    result = InterventionEngine(horizon_s=HORIZON_S).evaluate(
        sim, from_zone="pinch", to_zone="plaza", avoid={"pinch"}, prefer={"plaza"}
    )

    assert result.baseline is not None
    assert result.baseline.divert_fraction == 0.0
    assert result.baseline.description == "No intervention"
    assert result.baseline.projected_walk_time_delta_s == 0.0
    assert [c.divert_fraction for c in result.candidates] == list(DEFAULT_FRACTIONS)


def test_the_baseline_cannot_be_configured_away(pinch_world):
    """A caller asking for 30% and 40% is still shown what nothing looks like.

    Without it `congestion_reduction` is computed against no denominator, so
    every candidate scores as an improvement and the engine always recommends
    acting — the unfalsifiable recommendation the baseline exists to prevent.
    """
    sim, _ = pinch_world
    engine = InterventionEngine(horizon_s=HORIZON_S, fractions=(0.3, 0.4))

    assert engine.fractions[0] == 0.0
    result = engine.evaluate(
        sim, from_zone="pinch", to_zone="plaza", avoid={"pinch"}, prefer={"plaza"}
    )
    assert result.baseline is not None
    assert [c.divert_fraction for c in result.candidates] == [0.0, 0.3, 0.4]


def test_the_baseline_run_actually_congests(pinch_world):
    """Otherwise the rest of this file proves nothing."""
    sim, _ = pinch_world
    result = InterventionEngine(horizon_s=HORIZON_S).evaluate(
        sim, from_zone="pinch", to_zone="plaza", avoid={"pinch"}, prefer={"plaza"}
    )
    assert result.baseline.projected_peak_flow > DENSITY_BUILDING_MAX
    assert result.baseline.projected_bottleneck_duration_s > 0


# -------------------------------------------- helping less than nothing -----

def test_a_candidate_that_helps_less_than_doing_nothing_is_not_selected(pinch_world):
    """Diverting away from a zone nobody walks through changes no density.

    Every candidate then matches the baseline on peak and on walk time, and
    loses to it on fairness — so the engine must recommend nothing. This is the
    case a system that always returns its best option gets wrong.
    """
    sim, _ = pinch_world
    result = InterventionEngine(horizon_s=HORIZON_S).evaluate(
        sim, from_zone="pinch", to_zone="plaza",
        avoid={"plaza"}, prefer={"pinch"},  # tells the crowd to do what it already does
    )

    assert result.selected is None
    baseline = result.baseline
    for c in result.candidates:
        if c.divert_fraction > 0:
            assert c.projected_peak_flow == pytest.approx(baseline.projected_peak_flow)
            assert c.score.total <= baseline.score.total


def test_the_rejected_candidates_are_kept_and_scored(pinch_world):
    """A recommendation without its alternatives is an assertion, not an argument."""
    sim, _ = pinch_world
    result = InterventionEngine(horizon_s=HORIZON_S).evaluate(
        sim, from_zone="pinch", to_zone="plaza", avoid={"plaza"}, prefer={"pinch"}
    )

    assert result.selected is None
    assert len(result.candidates) == len(DEFAULT_FRACTIONS)
    assert all(not c.selected for c in result.candidates)
    for c in result.candidates:
        assert c.description
        assert c.score.total == pytest.approx(
            c.score.congestion_reduction + c.score.capacity_headroom
            + c.score.safety_margin + c.score.fairness - c.score.walk_time_cost
        )


# ------------------------------------------------------- helping ------------

def test_a_diversion_that_relieves_the_pinch_is_selected_and_is_honest(pinch_world):
    sim, _ = pinch_world
    result = InterventionEngine(horizon_s=HORIZON_S).evaluate(
        sim, from_zone="pinch", to_zone="plaza", avoid={"pinch"}, prefer={"plaza"}
    )

    assert result.selected is not None
    assert result.selected.divert_fraction > 0
    assert result.selected.projected_peak_flow < result.baseline.projected_peak_flow
    assert result.selected.score.total > result.baseline.score.total
    assert result.selected.selected is True
    assert sum(1 for c in result.candidates if c.selected) == 1
    assert result.selected.via == ["plaza"]
    assert "plaza" in result.selected.description


def test_the_walking_cost_is_reported_whichever_way_it_falls(pinch_world):
    """Added walking time is stated beside the benefit, never hidden — and it is
    charged only when it is a cost.

    It is not always a cost: relieving a jam this bad can make the *average*
    walk shorter, because the people left on the short route stop queueing. The
    engine must report a negative delta rather than quietly scoring it as a
    benefit, which is why walk_time_cost floors at zero.
    """
    sim, _ = pinch_world
    result = InterventionEngine(horizon_s=HORIZON_S).evaluate(
        sim, from_zone="pinch", to_zone="plaza", avoid={"pinch"}, prefer={"plaza"}
    )

    for c in result.candidates:
        expected = max(0.0, c.projected_walk_time_delta_s / 60.0) * 8.0
        assert c.score.walk_time_cost == pytest.approx(expected, abs=0.01)
        assert c.score.walk_time_cost >= 0.0


def test_fairness_biases_the_sweep_toward_the_smallest_diversion(pinch_world):
    """Every diverted person walks further, so the score has to charge for reach.
    Otherwise 'divert everyone' wins every sweep it is offered in."""
    sim, _ = pinch_world
    result = InterventionEngine(horizon_s=HORIZON_S).evaluate(
        sim, from_zone="pinch", to_zone="plaza", avoid={"pinch"}, prefer={"plaza"}
    )
    ordered = sorted(result.candidates, key=lambda c: c.divert_fraction)
    fairness = [c.score.fairness for c in ordered]
    assert fairness == sorted(fairness, reverse=True)
    assert result.baseline.score.fairness == max(fairness)


def test_the_sweep_does_not_disturb_the_world_it_forked_from(pinch_world):
    """Counterfactuals run on forks. If the live simulation moved, the operator
    would be shown a projection of a world that no longer exists."""
    sim, _ = pinch_world
    before_time = sim.time_s
    before_positions = [(a.at, a.edge_id, a.progress_m, a.arrived) for a in sim.agents]

    InterventionEngine(horizon_s=HORIZON_S).evaluate(
        sim, from_zone="pinch", to_zone="plaza", avoid={"pinch"}, prefer={"plaza"}
    )

    assert sim.time_s == before_time
    assert [(a.at, a.edge_id, a.progress_m, a.arrived) for a in sim.agents] == before_positions
    assert sim.avoid == set() and sim.prefer == set()


def test_the_same_world_evaluated_twice_gives_the_same_numbers(pinch_world):
    """Invariant 6. A what-if an operator cannot reproduce is not evidence."""
    sim, _ = pinch_world
    engine = InterventionEngine(horizon_s=HORIZON_S)
    kwargs = dict(from_zone="pinch", to_zone="plaza", avoid={"pinch"}, prefer={"plaza"})

    first = engine.evaluate(sim, **kwargs)
    second = engine.evaluate(sim, **kwargs)

    assert [c.model_dump() for c in first.candidates] == [
        c.model_dump() for c in second.candidates
    ]
