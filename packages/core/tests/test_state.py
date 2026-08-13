"""The state engine: devices in, population out — without inflating either.

Every test here guards a way of counting the same person twice. The engine's job
is to turn an opportunistic, partial, duplicated sample of devices into a
population estimate, and each of the following would silently multiply that
estimate by a different factor:

  * counting observations instead of devices     x sampling rate
  * bucketing a walker in every zone they touch  x zones crossed
  * accepting the same uplinked report twice     x number of uplinks
  * treating an unreported zone as empty         (the opposite error, and worse)

The last one is invariant 5, and it is the one an operator would act on.
"""

from __future__ import annotations

import pytest
from crowdflow_contracts import CrowdNode, JAM_DENSITY_PERSONS_M2, LOSBand, Position

from crowdflow_core.state import StateEngine
from crowdflow_core.state.engine import STALE_S

PARTICIPATION = 0.2
"""Stand-in for a MEASURED participation rate. One in five, so the arithmetic in
these tests is exact rather than approximate."""


def node(node_id: str, zone: str, t: float, speed: float = 1.2, accuracy: float = 8.0):
    return CrowdNode(
        node_id=node_id,
        epoch=0,
        timestamp=t,
        position=Position(x=0.0, y=0.0),
        speed_ms=speed,
        heading_deg=0.0,
        accuracy_m=accuracy,
        zone_id=zone,
    )


def engine(pack) -> StateEngine:
    return StateEngine(pack, participation_rate=PARTICIPATION)


# ------------------------------------------------- population from a sample --

def test_population_is_recovered_from_a_partial_sample(corridor_pack):
    """Twenty devices at 20% participation is a hundred people, and the state
    carries the rate it was scaled by so nothing downstream can forget."""
    e = engine(corridor_pack)
    e.ingest([node(f"d{i}", "hall", 10.0) for i in range(20)], now=10.0)
    state = e.snapshot(now=10.0)

    hall = state.zones["hall"]
    assert hall.observed_nodes == 20
    assert hall.participation_rate == PARTICIPATION
    assert hall.estimated_population == 100
    assert state.estimated_present == 100


def test_density_follows_from_the_zone_area_not_the_headcount(corridor_pack):
    """`hall` owns half of each incident 100 m x 5 m edge: 500 m^2.

    100 people over 500 m^2 is 0.2 persons/m^2 — comfortably NOMINAL. If the
    engine attributed a whole edge, or a single stub, this number moves by a
    factor that changes the band.
    """
    e = engine(corridor_pack)
    e.ingest([node(f"d{i}", "hall", 10.0) for i in range(20)], now=10.0)
    hall = e.snapshot(now=10.0).zones["hall"]

    assert hall.density_persons_m2 == pytest.approx(100 / 500.0, abs=1e-4)
    assert hall.band is LOSBand.NOMINAL


def test_a_crush_reads_as_critical_and_reports_its_queue(corridor_pack):
    """400 devices is 2,000 people in 500 m^2 — four times what fits."""
    e = engine(corridor_pack)
    e.ingest([node(f"d{i}", "hall", 10.0, speed=0.1) for i in range(400)], now=10.0)
    hall = e.snapshot(now=10.0).zones["hall"]

    assert hall.density_persons_m2 == JAM_DENSITY_PERSONS_M2
    assert hall.band is LOSBand.CRITICAL
    assert hall.over_capacity
    assert hall.queue_excess == pytest.approx(2000 - JAM_DENSITY_PERSONS_M2 * 500.0)


# ----------------------------------------------- devices, not observations ---

def test_a_device_reporting_fifteen_times_is_one_device(corridor_pack):
    """A phone reports every two seconds into a thirty-second window.

    Counting observations would make one spectator into fifteen, and then into
    seventy-five people after the participation scaling.
    """
    e = engine(corridor_pack)
    kept = e.ingest([node("phone", "hall", t) for t in range(0, 30, 2)], now=30.0)
    state = e.snapshot(now=30.0)

    assert kept == 15, "all fifteen observations are accepted..."
    assert state.zones["hall"].observed_nodes == 1, "...and they describe one device"
    assert state.zones["hall"].estimated_population == 5


def test_the_newest_observation_wins(corridor_pack):
    """Out-of-order arrival is normal on an opportunistic mesh."""
    e = engine(corridor_pack)
    e.ingest([node("phone", "hall", 20.0, speed=0.3)], now=20.0)
    e.ingest([node("phone", "hall", 10.0, speed=1.3)], now=20.0)  # older, arrives later
    assert e.snapshot(now=20.0).zones["hall"].mean_speed_ms == pytest.approx(0.3)


def test_a_device_that_moves_is_counted_once_in_its_current_zone(corridor_pack):
    """The compounding error: a walker crossing three zones becomes three people.

    Both reports are real and both are inside the window. The device is still in
    exactly one place, so it appears in exactly one zone.
    """
    e = engine(corridor_pack)
    e.ingest([node("walker", "gate", 10.0)], now=10.0)
    e.ingest([node("walker", "hall", 20.0)], now=20.0)
    state = e.snapshot(now=20.0)

    assert state.total_observed_nodes == 1
    assert "gate" not in state.zones
    assert state.zones["hall"].observed_nodes == 1
    assert "gate" in state.unobserved_zones or state.zones.get("gate") is None


def test_a_moving_device_is_counted_as_flow_through_the_zone_it_left(corridor_pack):
    """It leaves a trace in the counters even though it leaves the bucket."""
    e = engine(corridor_pack)
    e.ingest([node("walker", "gate", 10.0)], now=10.0)
    e.snapshot(now=10.0)
    e.ingest([node("walker", "hall", 20.0)], now=20.0)
    state = e.snapshot(now=20.0)

    assert state.zones["hall"].inflow_per_min > 0


def test_the_same_report_arriving_by_two_uplinks_is_counted_once(corridor_pack):
    """Under D7 a report reaches the dashboard by whichever path finds a gateway
    first — often several. Dedupe is on (node_id, timestamp)."""
    e = engine(corridor_pack)
    duplicated = [node("phone", "hall", 10.0), node("phone", "hall", 10.0)]
    assert e.ingest(duplicated, now=10.0) == 1


def test_observations_older_than_the_window_are_dropped(corridor_pack):
    e = engine(corridor_pack)
    assert e.ingest([node("phone", "hall", 0.0)], now=1000.0) == 0
    assert e.snapshot(now=1000.0).zones == {}


def test_a_device_that_stops_reporting_expires_from_the_estimate(corridor_pack):
    e = engine(corridor_pack)
    e.ingest([node(f"d{i}", "hall", 10.0) for i in range(20)], now=10.0)
    assert e.snapshot(now=10.0).zones["hall"].observed_nodes == 20
    assert e.snapshot(now=10.0 + STALE_S + 1).zones == {}


# ----------------------------------------------- unobserved is not empty -----

def test_a_zone_nobody_reports_from_is_unknown_not_quiet(corridor_pack):
    """Invariant 5. Silence is the normal state of an opportunistic mesh, and a
    zone rendered as empty is an operator being told it is safe."""
    e = engine(corridor_pack)
    e.ingest([node("phone", "hall", 10.0)], now=10.0)
    state = e.snapshot(now=10.0)

    assert set(state.unobserved_zones) == {"gate", "stand"}
    assert "gate" not in state.zones, "an unobserved zone has no ZoneState at all"
    assert state.coverage == pytest.approx(1 / 3)


def test_coverage_is_reported_even_when_it_is_total(corridor_pack):
    e = engine(corridor_pack)
    e.ingest([node("a", "gate", 10.0), node("b", "hall", 10.0), node("c", "stand", 10.0)],
             now=10.0)
    state = e.snapshot(now=10.0)
    assert state.unobserved_zones == []
    assert state.coverage == 1.0


def test_a_recently_seen_zone_is_not_yet_declared_unobserved(corridor_pack):
    """Between the observation window and STALE_S a zone is stale-but-known: it
    drops out of the estimate without being announced as a coverage gap."""
    e = engine(corridor_pack)
    e.ingest([node("phone", "hall", 10.0)], now=10.0)
    just_stale = e.snapshot(now=10.0 + STALE_S / 2)
    assert "hall" not in just_stale.zones
    assert "hall" not in just_stale.unobserved_zones

    long_gone = e.snapshot(now=10.0 + STALE_S + 1)
    assert "hall" in long_gone.unobserved_zones


# -------------------------------------------------------------- confidence ---

def test_participation_must_be_measured_and_in_range(corridor_pack):
    """A participation rate of zero or one is not a measurement, it is a default."""
    for bad in (0.0, -0.1, 1.5):
        with pytest.raises(ValueError):
            StateEngine(corridor_pack, participation_rate=bad)
    StateEngine(corridor_pack, participation_rate=1.0)  # a full census is legal


def test_a_handful_of_devices_cannot_produce_a_confident_claim(corridor_pack):
    """Three nodes and four hundred give the same flow number, and must not give
    the same confidence."""
    few = engine(corridor_pack)
    few.ingest([node(f"d{i}", "hall", 10.0) for i in range(3)], now=10.0)
    many = engine(corridor_pack)
    many.ingest([node(f"d{i}", "hall", 10.0) for i in range(400)], now=10.0)

    thin = few.snapshot(now=10.0).zones["hall"].confidence
    thick = many.snapshot(now=10.0).zones["hall"].confidence
    assert thin.value < thick.value
    assert thin.observed_nodes == 3 and thick.observed_nodes == 400
    assert thick.is_reportable


def test_three_devices_clear_the_actionable_floor_KNOWN_DEFECT(corridor_pack):
    """Recorded, not endorsed. The sample-size term does not dominate.

    StateEngine._confidence says it is "deliberately conservative on sample size:
    ... a handful of devices cannot produce a confident claim". The arithmetic
    disagrees. Sample size carries 0.4 of the score and its log term is only 0.26
    at three nodes, while freshness (0.2) and accuracy (0.2) are both near full
    marks for any live report. Three phones therefore score ~0.57 — above the 0.5
    floor Forecast.is_actionable uses, so three devices in a 500 m^2 hall can
    put an intervention in front of an operator.

    Left as-is here because changing it changes the A/B numbers this branch is
    required to hold fixed. Pinned so the fix shows up as a deliberate diff.
    """
    e = engine(corridor_pack)
    e.ingest([node(f"d{i}", "hall", 10.0) for i in range(3)], now=10.0)
    confidence = e.snapshot(now=10.0).zones["hall"].confidence

    assert confidence.observed_nodes == 3
    assert confidence.value == pytest.approx(0.571, abs=0.01)
    assert confidence.value >= 0.5, "the floor Forecast.is_actionable applies"
    assert confidence.is_reportable


def test_confidence_degrades_with_stale_and_inaccurate_observations(corridor_pack):
    fresh = engine(corridor_pack)
    fresh.ingest([node(f"d{i}", "hall", 30.0, accuracy=5.0) for i in range(50)], now=30.0)
    stale = engine(corridor_pack)
    stale.ingest([node(f"d{i}", "hall", 5.0, accuracy=45.0) for i in range(50)], now=30.0)

    assert (
        stale.snapshot(now=30.0).zones["hall"].confidence.value
        < fresh.snapshot(now=30.0).zones["hall"].confidence.value
    )


def test_a_jumping_estimate_is_a_weak_one(corridor_pack):
    """Stability is agreement with recent estimates for the same zone."""
    steady = engine(corridor_pack)
    swinging = engine(corridor_pack)
    for tick, (n_steady, n_swinging) in enumerate(
        [(40, 4), (40, 120), (40, 4), (40, 120), (40, 4)]
    ):
        t = tick * 10.0
        steady.ingest([node(f"s{i}", "hall", t) for i in range(n_steady)], now=t)
        swinging.ingest([node(f"w{i}", "hall", t) for i in range(n_swinging)], now=t)
        steady_state = steady.snapshot(now=t)
        swinging_state = swinging.snapshot(now=t)

    assert (
        swinging_state.zones["hall"].confidence.stability
        < steady_state.zones["hall"].confidence.stability
    )


def test_an_unassigned_observation_is_bound_to_the_nearest_zone(corridor_pack):
    """Zone assignment is the engine's job, never the device's — a self-reported
    zone would let a stale client place people wherever it last knew about."""
    e = engine(corridor_pack)
    loose = CrowdNode(
        node_id="phone", epoch=0, timestamp=10.0,
        position=Position(x=190.0, y=5.0),  # nearest 'stand' at (200, 0)
        speed_ms=1.0, heading_deg=0.0, accuracy_m=8.0, zone_id=None,
    )
    e.ingest([loose], now=10.0)
    assert "stand" in e.snapshot(now=10.0).zones
