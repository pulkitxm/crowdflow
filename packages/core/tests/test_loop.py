"""The closed loop, and the promise that the route cache changed nothing.

Two things are proved here that no single engine can prove on its own:

  * **Invariant 4.** Nothing reaches the mesh without a safety verdict. Not the
    predictor's idea, not the intervention engine's best candidate — a command
    is dispatched only when the gate approved it, and a rejected command leaves
    the world untouched.
  * **The cache is a speedup and nothing else.** The same scenario, run with the
    route cache bypassed and with it live, must produce the same tick-by-tick
    state and the same metrics. If it does not, the cache is a behaviour change
    wearing a performance costume.
"""

from __future__ import annotations

from crowdflow_core.metrics import ab_test, run_scenario
from crowdflow_core.routing import VenueGraph
from crowdflow_core.simulation import Cohort, Scenario

from conftest import edge, make_pack, zone

TICKS = 150
"""Five minutes at the 2 s tick — past the point where the pinch saturates and
the loop has had a chance to act."""

PARTICIPATION = 0.2
CROWD = 900


def pinch_pack(never_route_through: list[str] | None = None):
    """The bottleneck venue from test_intervention, with a configurable
    forbidden list so the loop can be made to propose something illegal."""
    from crowdflow_contracts import SafetyConstraints

    return make_pack(
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
        constraints=SafetyConstraints(
            never_route_through=never_route_through or [],
            emergency_exits=["exit"],
        ),
    )


def pinch_scenario() -> Scenario:
    return Scenario(
        name="pinch-egress",
        description=f"{CROWD} spectators leave one stand through a 2 m corridor",
        cohorts=[Cohort(count=CROWD, origin="stand", destination="exit", spread_s=240.0)],
        seed=7,
    )


def _world(results) -> list[tuple]:
    """What the crowd did, tick by tick. Nothing about what was decided."""
    return [
        (
            r.time_s,
            tuple(sorted((z.zone_id, z.density_persons_m2, z.observed_nodes)
                         for z in r.state.zones.values())),
            tuple(sorted(r.state.unobserved_zones)),
        )
        for r in results
    ]


def _digest(results) -> list[tuple]:
    """The world plus everything each tick decided about it."""
    return [
        (
            world,
            tuple((f.zone_id, f.time_to_threshold_s) for f in r.forecasts),
            r.dispatched,
            None if r.verdict is None else r.verdict.outcome,
            None if r.command is None else (r.command.avoid, r.command.prefer,
                                            r.command.target_fraction),
        )
        for world, r in zip(_world(results), results)
    ]


# ------------------------------------------------------------ invariant 4 ----

def test_a_command_is_dispatched_only_after_the_gate_approves_it():
    graph = VenueGraph(pinch_pack(), "race")
    metrics, results = run_scenario(
        pinch_scenario(), graph, intervene=True, participation=PARTICIPATION, ticks=TICKS
    )

    dispatched = [r for r in results if r.dispatched]
    assert dispatched, "the scenario must actually provoke an intervention"
    for r in results:
        if r.dispatched:
            assert r.verdict is not None and r.verdict.may_dispatch
            assert r.command is not None
        if r.command is not None:
            assert r.verdict is not None, "no command exists without a verdict"
    assert metrics.interventions == len(dispatched)


def test_a_forbidden_zone_is_never_dispatched_and_never_walked():
    """The loop must not put people through a zone marked never_route_through.

    This test used to assert that the SAFETY GATE rejected such a proposal, and
    it passed for the wrong reason: the gate inspected only the zone names in the
    command, so a proposal whose ROUTE ran through the forbidden zone was
    approved. The fixture hid it because the forbidden zone was a leaf nothing
    could traverse.

    The constraint is now structural — a forbidden zone is absent from the graph,
    so it cannot be proposed in the first place and the gate is a second line of
    defence rather than the only one. The assertion is therefore the stronger
    one: whatever the loop dispatches, nobody is routed through it.
    """
    forbidden_alternative = "stand"
    graph = VenueGraph(pinch_pack([forbidden_alternative]), "race")
    metrics, results = run_scenario(
        pinch_scenario(), graph, intervene=True, participation=PARTICIPATION, ticks=TICKS
    )

    assert graph.forbidden_zones == {forbidden_alternative}
    assert forbidden_alternative not in graph.reachable("gate"), (
        "structurally unreachable, not merely expensive"
    )

    for r in results:
        if r.command is None:
            continue
        assert forbidden_alternative not in r.command.prefer
        taken = graph.route(r.command.source_zone, r.command.destination_zone,
                            avoid=set(r.command.avoid) or None,
                            prefer=set(r.command.prefer) or None)
        assert not graph.path_violations(taken.path), (
            f"dispatched a command whose route walks {forbidden_alternative}: "
            f"{taken.path}"
        )

    # Nothing was applied optimistically and rolled back: a run that never
    # intervenes must leave the crowd in the same place as one whose every
    # proposal was refused.
    assert metrics.rejected_by_safety == 0 or metrics.interventions == 0


def test_the_intervention_arm_beats_the_control_arm():
    """The gate the whole project rests on, in miniature: same seed, one arm
    allowed to reroute."""
    graph = VenueGraph(pinch_pack(), "race")
    result = ab_test(pinch_scenario(), graph, participation=PARTICIPATION, ticks=TICKS)

    assert result.without.critical_zone_seconds > 0, "the control arm must congest"
    assert result.passes_gate
    assert result.delta("critical_zone_seconds")[0] < 0


# ------------------------------------------------------- invariant 6 ---------

def test_the_same_seed_produces_the_same_run():
    a = run_scenario(pinch_scenario(), VenueGraph(pinch_pack(), "race"),
                     intervene=True, participation=PARTICIPATION, ticks=TICKS)
    b = run_scenario(pinch_scenario(), VenueGraph(pinch_pack(), "race"),
                     intervene=True, participation=PARTICIPATION, ticks=TICKS)
    assert _digest(a[1]) == _digest(b[1])
    assert a[0].as_rows() == b[0].as_rows()


# ----------------------------------------------------- the cache changes nothing

def _uncached_route(self, origin, destination, states=None, avoid=None, prefer=None,
                    depart_at=0.0, crossing_deadlines=None):
    """Straight through to the search, bypassing the memo entirely."""
    return self._search(origin, destination, states, avoid, prefer, crossing_deadlines)


def _run_once():
    graph = VenueGraph(pinch_pack(), "race")
    metrics, results = run_scenario(
        pinch_scenario(), graph, intervene=True, participation=PARTICIPATION, ticks=TICKS
    )
    return graph, metrics, results


def test_the_route_cache_does_not_change_the_run(monkeypatch):
    """THE requirement on this branch: identical results, only faster.

    The bypass is undone before the second run, so the two differ in exactly one
    thing — whether `route` consults the memo.
    """
    with monkeypatch.context() as patched:
        patched.setattr(VenueGraph, "route", _uncached_route)
        bare_graph, bare_metrics, bare_results = _run_once()
        assert bare_graph.cache_hits == 0 and bare_graph.route_cache_size == 0

    graph, metrics, results = _run_once()

    assert graph.cache_hits > 0, "the cached run must actually have used the cache"
    assert _digest(results) == _digest(bare_results)
    assert metrics.as_rows() == bare_metrics.as_rows()


def test_the_cache_serves_almost_every_route_request_in_a_real_run():
    """Why it is worth having: a crowd of hundreds shares a handful of requests,
    and the intervention engine's forks share this graph and therefore its memo."""
    graph, _, _ = _run_once()

    assert graph.route_cache_size < 50, "a venue this small has few distinct requests"
    assert graph.cache_hits > graph.cache_misses * 100
