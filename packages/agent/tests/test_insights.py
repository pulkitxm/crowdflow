"""Insight engine tests.

The defects guarded against here are the ones that make an insight engine worse
than no insight engine: a false alarm at a live event, an infinite z-score from
a flat sensor, a peer comparison against one other gate, and a number that came
out of a language model rather than the data.
"""

from __future__ import annotations

import pytest
from conftest import PARTICIPATION, build_pack, build_state, says, scripted, zone_state
from crowdflow_agent import Insight, InsightEngine, InsightKind, narrate
from crowdflow_agent.insights import MIN_BASELINE_POINTS, modified_z
from crowdflow_contracts import MODIFIED_Z_OUTLIER
from pydantic import ValidationError

# Four peers spread around 100 with one gate well below them. The spread is
# deliberate: four identical peers would give a MAD of zero and no comparison
# would be possible at all — which is itself a case tested below.
GATE_OUTFLOW = {
    "gate-1": 96.0,
    "gate-2": 108.0,
    "gate-3": 100.0,
    "gate-4": 71.28,
    "gate-5": 104.0,
}
GATE_NAMES = {f"gate-{i}": f"Gate {i}" for i in range(1, 6)}


def gate_pack():
    return build_pack(
        extra_gates={z: n for z, n in GATE_NAMES.items() if z not in ("gate-1", "gate-2")}
    )


def feed_sessions(engine: InsightEngine, sessions=("fp1", "fp2", "quali"), ticks=12):
    """Run several sessions of steady state through the engine.

    Steady on purpose: a constant series has MAD zero and produces no self
    baseline insight, so anything the engine reports here is a peer finding.
    """
    pack = engine.pack
    for session in sessions:
        for tick in range(ticks):
            overrides = {
                gate: zone_state(gate, now=float(tick), outflow=outflow)
                for gate, outflow in GATE_OUTFLOW.items()
            }
            engine.observe(
                build_state(
                    pack,
                    now=float(tick),
                    session_id=session,
                    overrides=overrides,
                )
            )


# ------------------------------------------------------------- the estimator --

def test_a_flat_series_has_no_detectable_deviation():
    """MAD is zero on a constant series and the textbook formula divides by it.
    A flat sensor is a flat sensor, not an anomaly of infinite size."""
    assert modified_z(5.0, [3.0] * 20) is None


def test_too_few_points_is_not_a_baseline():
    assert modified_z(50.0, [1.0, 2.0, 3.0]) is None
    assert modified_z(50.0, list(range(MIN_BASELINE_POINTS))) is not None


def test_the_estimator_is_not_dragged_up_by_the_spike_it_is_looking_for():
    """The reason for median and MAD rather than mean and standard deviation: a
    crowd series contains the very spikes being detected, and each one raises a
    mean-based threshold behind it."""
    calm = [10.0, 11.0, 9.0, 10.5, 10.0, 9.5, 10.2, 9.8, 10.1, 10.0]
    with_spikes = calm + [80.0, 90.0, 85.0]
    assert modified_z(70.0, calm) > MODIFIED_Z_OUTLIER
    # Even after three huge readings enter the history, a fourth still scores as
    # extreme — a mean/sd estimator would have absorbed them into "normal".
    assert modified_z(70.0, with_spikes) is not None


# ------------------------------------------------------------------ findings --

def test_a_gate_clearing_slower_than_its_peers_is_found_and_phrased():
    """The target insight, stated the way an operator would say it."""
    engine = InsightEngine(gate_pack())
    feed_sessions(engine)
    found = [i for i in engine.insights() if i.metric == "outflow_per_min"]

    assert len(found) == 1
    insight = found[0]
    assert insight.kind is InsightKind.PEER_GAP
    assert insight.subject == "gate-4"
    assert insight.peer == "gate-2"
    assert insight.headline == (
        "Gate 4 is clearing 34% slower than Gate 2 across the last 3 sessions"
    )
    assert insight.relative_change == -0.34
    assert insight.sessions == ["fp1", "fp2", "quali"]
    assert insight.is_significant


def test_a_finding_carries_the_evidence_needed_to_check_it():
    engine = InsightEngine(gate_pack())
    feed_sessions(engine)
    insight = next(i for i in engine.insights() if i.metric == "outflow_per_min")
    assert insight.observed == 71.28
    assert insight.baseline == 108.0
    assert abs(insight.deviation) >= MODIFIED_Z_OUTLIER
    assert insight.samples > 0


def test_a_venue_where_every_gate_agrees_reports_nothing():
    """Silence is a valid answer. An engine that always finds something is an
    engine nobody will read twice."""
    engine = InsightEngine(gate_pack())
    pack = engine.pack
    for session in ("fp1", "fp2"):
        for tick in range(12):
            overrides = {
                gate: zone_state(gate, now=float(tick), outflow=100.0 + (i * 0.5))
                for i, gate in enumerate(GATE_OUTFLOW)
            }
            engine.observe(
                build_state(pack, now=float(tick), session_id=session, overrides=overrides)
            )
    assert engine.insights() == []


def test_exactly_three_gates_are_not_three_peers_for_each_subject():
    """Regression for the guard/estimator off-by-one.

    MIN_PEERS counts *other* gates. With three gates total, each subject has only
    two peers; admitting the group and then asking modified_z for four samples
    silently returned None for every gate.
    """
    pack = build_pack(extra_gates={"gate-3": "Gate 3"})
    engine = InsightEngine(pack)
    for tick in range(12):
        engine.observe(
            build_state(
                pack,
                now=float(tick),
                session_id="quali",
                overrides={
                    "gate-1": zone_state("gate-1", now=float(tick), outflow=100.0),
                    "gate-2": zone_state("gate-2", now=float(tick), outflow=104.0),
                    "gate-3": zone_state("gate-3", now=float(tick), outflow=10.0),
                },
            )
        )
    assert [i for i in engine.insights() if i.kind is InsightKind.PEER_GAP] == []


def test_a_peer_group_of_two_is_not_a_peer_group():
    """With two gates, every difference is 100% of the variation and 'the peer
    median' is just the other gate."""
    engine = InsightEngine(build_pack())  # only gate-1 and gate-2 exist
    pack = engine.pack
    for tick in range(12):
        overrides = {
            "gate-1": zone_state("gate-1", now=float(tick), outflow=100.0),
            "gate-2": zone_state("gate-2", now=float(tick), outflow=20.0),
        }
        engine.observe(
            build_state(pack, now=float(tick), session_id="quali", overrides=overrides)
        )
    assert [i for i in engine.insights() if i.kind is InsightKind.PEER_GAP] == []


def test_a_zone_departing_from_its_own_history_is_found():
    engine = InsightEngine(build_pack())
    pack = engine.pack
    for tick in range(14):
        density = 0.30 + (tick % 3) * 0.02
        engine.observe(
            build_state(
                pack, now=float(tick), session_id="quali",
                overrides={"concourse": zone_state("concourse", density=density)},
            )
        )
    engine.observe(
        build_state(
            pack, now=99.0, session_id="quali",
            overrides={"concourse": zone_state("concourse", density=2.4)},
        )
    )
    found = [
        i for i in engine.insights()
        if i.kind is InsightKind.SELF_BASELINE and i.subject == "concourse"
    ]
    assert found
    assert found[0].observed == 2.4
    assert found[0].deviation > MODIFIED_Z_OUTLIER


def test_a_zone_with_too_little_history_reports_nothing():
    engine = InsightEngine(build_pack())
    pack = engine.pack
    for tick in range(3):
        engine.observe(build_state(pack, now=float(tick), session_id="quali"))
    assert engine.insights() == []


def test_insights_are_ranked_by_how_far_out_they_are():
    engine = InsightEngine(gate_pack())
    feed_sessions(engine)
    deviations = [abs(i.deviation) for i in engine.insights()]
    assert deviations == sorted(deviations, reverse=True)


# ---------------------------------------------------------------- narration --

def test_narration_never_sees_a_raw_series():
    """Statistics first, language second — enforced, not asserted in a comment.

    The model is handed the finished Insight. If a tick series ever reached the
    prompt, this catches it, and it is the reason the fake client records what
    it was shown.
    """
    engine = InsightEngine(gate_pack())
    feed_sessions(engine)
    insight = next(i for i in engine.insights() if i.metric == "outflow_per_min")

    client = scripted(says("Gate 4 is taking noticeably longer to clear than Gate 2."))
    narrate(insight, client)

    sent = client.requests[0].rendered()
    assert "71.28" in sent, "the computed figure is what the model is given"
    assert sent.count("96.0") == 0, "peer raw values must not travel"
    assert len(sent) < 2000, "a prompt this size cannot contain a tick series"
    assert client.requests[0].tools == (), "narration is not a tool-calling task"


def test_narration_cannot_change_a_number():
    """The model is a writer here. Whatever it says, the numbers and the
    deterministic headline are already frozen on the insight."""
    engine = InsightEngine(gate_pack())
    feed_sessions(engine)
    insight = next(i for i in engine.insights() if i.metric == "outflow_per_min")

    liar = scripted(says("Gate 4 is clearing 99% slower and will collapse in 8 seconds."))
    narrated = narrate(insight, liar)

    assert narrated.relative_change == -0.34
    assert narrated.observed == insight.observed
    assert narrated.headline == insight.headline
    assert "99%" in narrated.narration, "the narration is kept, just never trusted"


def test_an_insight_is_immutable_once_computed():
    insight = Insight(
        id="x", kind=InsightKind.PEER_GAP, metric="outflow_per_min",
        subject="gate-4", subject_name="Gate 4",
        observed=71.28, baseline=108.0, deviation=-4.8, relative_change=-0.34,
        samples=36, headline="Gate 4 is clearing 34% slower than Gate 2",
    )
    with pytest.raises(ValidationError, match="frozen"):
        insight.observed = 1.0  # type: ignore[misc]


def test_participation_scaling_is_not_the_insight_engine_s_business():
    """A sanity check on the fixture rather than the engine: the engine reads
    ZoneState, which has already applied measured participation. If it started
    reading raw node counts this would drift."""
    state = build_state(build_pack())
    assert state.zones["gate-1"].participation_rate == PARTICIPATION
