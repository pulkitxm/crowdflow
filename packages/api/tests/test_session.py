"""What the console is told, and — more importantly — what it is not allowed to
be told wrongly.

The failure modes tested here are all the same shape: the system does not know
something, and the screen shows a number anyway. A zone with no reporting device
must not arrive as quiet, a zone that fell silent must not vanish into the
observed count, and a coverage figure must be a fraction of the venue rather than
a fraction of the part of the venue that happened to answer.
"""

from __future__ import annotations

from crowdflow_api.session import CLIENT_QUEUE_DEPTH, ScenarioSession
from crowdflow_api.wire import ControlAction, EventKind, SessionStatus
from crowdflow_contracts import LOSBand
from crowdflow_core.simulation.scenario import Cohort, Scenario


def build_session(circuit, option, *, count=400, seed=7, intervene=False, participation=0.5):
    scenario = Scenario(
        name="toy-egress",
        description="everyone leaves at once",
        cohorts=[Cohort(count=count, origin="stand", destination="park", spread_s=20.0)],
        duration_s=600.0,
        seed=seed,
    )
    return ScenarioSession(
        circuit,
        scenario,
        option,
        population=count,
        participation=participation,
        tick_s=2.0,
        intervene=intervene,
    )


def run(session, ticks: int):
    return [session.tick_once() for _ in range(ticks)]


# -- coverage --------------------------------------------------------------


def test_every_zone_is_accounted_for_every_tick(toy_circuit, toy_option):
    """No zone may fall off the screen.

    observed + unknown + silent must equal the pack. A zone in none of the three
    is a zone the console would simply not draw, which is the "unobserved renders
    as empty" failure wearing a different coat.
    """
    session = build_session(toy_circuit, toy_option)
    for envelope in run(session, 40):
        c = envelope.coverage
        assert c.observed + c.unknown + c.silent == c.zones_total == len(
            toy_circuit.pack.zones
        )


def test_unobserved_zones_are_never_reported_as_quiet(toy_circuit, toy_option):
    """A zone with no device has no ZoneState at all — not a zero one."""
    session = build_session(toy_circuit, toy_option)
    envelope = run(session, 6)[-1]
    assert envelope.state.unobserved_zones, "expected some zone to have no coverage"
    for zone_id in envelope.state.unobserved_zones:
        assert zone_id not in envelope.state.zones


def test_silent_zones_are_the_ones_the_state_engine_declares_neither_way(
    toy_circuit, toy_option
):
    """The third category, which `VenueState` has no field for.

    A zone that reported inside the stale window but not this tick appears in
    neither `zones` nor `unobserved_zones`. It is not observed and it is not
    declared unknown; the console has to render it as something, and that
    something must not be 'quiet'.
    """
    session = build_session(toy_circuit, toy_option)
    envelopes = run(session, 60)
    silent = [e for e in envelopes if e.silent_zones]
    assert silent, "expected a zone to fall silent as the crowd moved through"
    for envelope in silent:
        for zone_id in envelope.silent_zones:
            assert zone_id not in envelope.state.zones
            assert zone_id not in envelope.state.unobserved_zones


def test_coverage_denominator_is_the_venue_not_the_answering_part(
    toy_circuit, toy_option
):
    """`VenueState.coverage` omits silent zones from its denominator, so it reads
    higher than the truth whenever a zone has just gone quiet. The console's
    fraction is over every zone in the pack."""
    session = build_session(toy_circuit, toy_option)
    for envelope in run(session, 60):
        assert envelope.coverage.fraction_observed == (
            envelope.coverage.observed / len(toy_circuit.pack.zones)
        )
        if envelope.silent_zones:
            assert envelope.coverage.fraction_observed < envelope.state.coverage


def test_low_confidence_zones_are_flagged_not_dropped(toy_circuit, toy_option):
    """A handful of devices still produces a reading; the operator gets it, with
    the contract's own judgement of whether to lean on it attached."""
    session = build_session(toy_circuit, toy_option, count=40, participation=0.1)
    flagged = [e for e in run(session, 40) if e.low_confidence_zones]
    assert flagged, "expected thin coverage to produce an unreportable estimate"
    envelope = flagged[0]
    for zone_id in envelope.low_confidence_zones:
        assert zone_id in envelope.state.zones  # shown, not withheld
        assert not envelope.state.zones[zone_id].confidence.is_reportable


def test_actionable_is_the_contracts_judgement_not_a_second_copy(toy_circuit, toy_option):
    """The console must not own a copy of the actionable bar.

    `Forecast.is_actionable` is a property, so it does not serialise; the
    envelope carries the zone ids instead. If this drifts, a TypeScript
    reimplementation of `probability >= 0.6 and confidence >= 0.5` is the next
    thing that happens, and then there are two definitions of "worth acting on".
    """
    session = build_session(toy_circuit, toy_option)
    seen_any = False
    for envelope in run(session, 40):
        expected = [f.zone_id for f in envelope.forecasts if f.is_actionable]
        assert envelope.actionable == expected
        seen_any = seen_any or bool(expected)
    assert seen_any, "expected at least one actionable forecast in a congesting run"


# -- reproducibility -------------------------------------------------------


def test_same_seed_produces_an_identical_run(toy_circuit, toy_option):
    """Invariant 6. The console header carries the seed for exactly this reason."""
    a = run(build_session(toy_circuit, toy_option, seed=99), 25)
    b = run(build_session(toy_circuit, toy_option, seed=99), 25)
    assert [e.state.model_dump() for e in a] == [e.state.model_dump() for e in b]
    assert [e.metrics.model_dump() for e in a] == [e.metrics.model_dump() for e in b]


def test_a_different_seed_produces_a_different_run(toy_circuit, toy_option):
    a = run(build_session(toy_circuit, toy_option, seed=1), 25)
    b = run(build_session(toy_circuit, toy_option, seed=2), 25)
    assert [e.state.model_dump() for e in a] != [e.state.model_dump() for e in b]


# -- the feed --------------------------------------------------------------


def test_feed_reports_transitions_not_conditions(toy_circuit, toy_option):
    """A zone that stays in its band must not produce a line every tick."""
    session = build_session(toy_circuit, toy_option)
    envelopes = run(session, 60)
    band_events = [
        event
        for envelope in envelopes
        for event in envelope.events
        if event.kind is EventKind.BAND
    ]
    assert band_events, "expected the pinch to change band"
    # Far fewer lines than ticks x zones, or the feed is unreadable.
    assert len(band_events) < len(envelopes)


def test_first_sight_of_a_quiet_zone_is_not_an_event(toy_circuit, toy_option):
    session = build_session(toy_circuit, toy_option)
    first = run(session, 1)[0]
    assert not [
        e for e in first.events if e.kind is EventKind.BAND and "NOMINAL" in e.message
    ]


def test_losing_a_busy_zone_is_reported(toy_circuit, toy_option):
    """Coverage loss on a zone that was BUILDING or CRITICAL is an event.

    Driven directly rather than waited for: under this simulator a zone almost
    always decays to NOMINAL before its last device leaves, so the condition that
    matters most operationally — the uplink dying on the zone you were watching —
    is the one a scenario is least likely to produce by chance. It is the
    derivation that is under test, so the derivation is what is set up.
    """
    session = build_session(toy_circuit, toy_option)
    run(session, 5)
    session._memory.band["quiet"] = LOSBand.CRITICAL  # nobody is ever in "quiet"

    envelope = session.tick_once()
    coverage = [e for e in envelope.events if e.kind is EventKind.COVERAGE]
    assert len(coverage) == 1
    assert coverage[0].zone_id == "quiet"
    assert "lost coverage while CRITICAL" in coverage[0].message


def test_losing_a_quiet_zone_is_not_reported(toy_circuit, toy_option):
    """The other half: coverage churn on nominal zones would drown the feed."""
    session = build_session(toy_circuit, toy_option)
    run(session, 5)
    session._memory.band["quiet"] = LOSBand.NOMINAL

    envelope = session.tick_once()
    assert not [e for e in envelope.events if e.kind is EventKind.COVERAGE]
    # ...but it must still be visible in the coverage counts.
    assert "quiet" in envelope.state.unobserved_zones or "quiet" in envelope.silent_zones


def test_band_events_carry_a_word_and_a_number(toy_circuit, toy_option):
    """Never colour alone — and never a word alone either."""
    session = build_session(toy_circuit, toy_option)
    events = [
        e
        for env in run(session, 60)
        for e in env.events
        if e.kind is EventKind.BAND
    ]
    for event in events:
        assert any(b.label in event.message for b in LOSBand)
        assert event.detail and "ped/m2" in event.detail


def test_event_log_is_bounded(toy_circuit, toy_option):
    from crowdflow_api.session import EVENT_LOG_CAPACITY

    session = build_session(toy_circuit, toy_option)
    for _ in range(EVENT_LOG_CAPACITY + 50):
        session._log(EventKind.SESSION, session.events[0].severity, "filler")
    assert len(session.events) == EVENT_LOG_CAPACITY


# -- intervention ----------------------------------------------------------


def test_rejected_candidates_reach_the_console(toy_circuit, toy_option):
    """A recommendation without its alternatives is an assertion.

    Whatever the loop decides, every option it evaluated must arrive — including
    the do-nothing baseline, which is the only thing the rest can be judged
    against.
    """
    session = build_session(toy_circuit, toy_option, intervene=True)
    with_candidates = [e for e in run(session, 90) if e.candidates]
    assert with_candidates, "expected the loop to evaluate an intervention"
    envelope = with_candidates[0]
    assert len(envelope.candidates) > 1
    assert any(c.divert_fraction == 0.0 for c in envelope.candidates)
    assert sum(1 for c in envelope.candidates if c.selected) <= 1


# -- control ---------------------------------------------------------------


def test_step_and_pause_do_not_advance_the_clock(toy_circuit, toy_option):
    session = build_session(toy_circuit, toy_option)
    assert session.status is SessionStatus.PAUSED
    session.control(ControlAction.PLAY)
    assert session.status is SessionStatus.RUNNING
    session.control(ControlAction.PAUSE)
    assert session.status is SessionStatus.PAUSED
    assert session.sim.time_s == 0.0


def test_speed_requires_a_speed(toy_circuit, toy_option):
    import pytest

    session = build_session(toy_circuit, toy_option)
    with pytest.raises(ValueError):
        session.control(ControlAction.SPEED, None)


def test_a_console_that_falls_behind_is_dropped_not_buffered(toy_circuit, toy_option):
    """A stale console must disconnect and replay, never drift silently."""
    import asyncio

    async def scenario():
        session = build_session(toy_circuit, toy_option)
        queue = session.subscribe()
        for _ in range(CLIENT_QUEUE_DEPTH + 1):
            session._broadcast(session.tick_once())
        return session, queue

    session, queue = asyncio.run(scenario())
    assert queue not in session._subscribers
    assert queue.qsize() == CLIENT_QUEUE_DEPTH
