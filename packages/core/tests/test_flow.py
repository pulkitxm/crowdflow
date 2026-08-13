"""The fundamental diagram, and the inversion that makes flow unusable as a class.

This is the physics the whole product rests on, so it is tested as physics: flow
rises with density, peaks, and then *collapses*. The consequence is that flow is
two-valued — for almost every flow rate there is a free-flowing density and a
jammed density that produce it — and a system that classified on flow would call
them the same thing.

If any assertion here fails, every band, forecast and intervention downstream is
measuring something other than what it claims to.
"""

from __future__ import annotations

import pytest
from crowdflow_contracts import (
    CAPACITY_DENSITY,
    DENSITY_BUILDING_MAX,
    DENSITY_NOMINAL_MAX,
    FREE_FLOW_SPEED_MS,
    JAM_DENSITY_PERSONS_M2,
    LOS_E_MAX,
    LOSBand,
    band_for_density,
    band_for_flow,
    density_for_flow,
)

from crowdflow_core.state.flow import (
    MIN_SPEED_MS,
    capacity_flow,
    density,
    flow_from_occupancy,
    flow_rate,
    queue_excess,
    speed_at_density,
)

STEP = 0.01
"""Density sweep resolution, persons/m^2. Fine enough to locate the peak to
within half a step of the analytic capacity density."""

SHUFFLE_FLOOR_DENSITY = JAM_DENSITY_PERSONS_M2 * (1.0 - MIN_SPEED_MS / FREE_FLOW_SPEED_MS)
"""Density at which the Greenshields speed hits MIN_SPEED_MS and stops falling.
Derived from the constants, not typed: above it the diagram is the floor, not
the model. See test_the_shuffle_floor_ticks_flow_up_at_the_very_top."""


def _sweep(lo: float = 0.0, hi: float = JAM_DENSITY_PERSONS_M2) -> list[tuple[float, float]]:
    """(density, flow) across a density range."""
    out = []
    for i in range(int((hi - lo) / STEP) + 1):
        d = lo + i * STEP
        out.append((d, flow_rate(d, speed_at_density(d))))
    return out


# ------------------------------------------------------- peak and collapse --

def test_flow_peaks_then_collapses():
    """The headline shape. Rising to a maximum, then collapsing."""
    sweep = _sweep(hi=SHUFFLE_FLOOR_DENSITY)
    peak_d, peak_flow = max(sweep, key=lambda p: p[1])

    assert peak_d == pytest.approx(CAPACITY_DENSITY, abs=STEP)

    rising = [f for d, f in sweep if d <= peak_d]
    falling = [f for d, f in sweep if d >= peak_d]
    assert rising == sorted(rising), "flow must rise monotonically up to capacity"
    assert falling == sorted(falling, reverse=True), "flow must fall beyond capacity"
    # By the time speed reaches the shuffle floor, throughput is a fraction of
    # what the same corridor carried at half the occupancy.
    assert falling[-1] < peak_flow * 0.2


def test_the_shuffle_floor_ticks_flow_up_at_the_very_top():
    """A known artefact, pinned so it cannot grow unnoticed.

    MIN_SPEED_MS exists because a jammed crowd still shuffles and a zero speed
    makes every travel-time estimate infinite. The price is that above ~3.85
    persons/m^2 speed stops falling, so flow = density * floor starts *rising*
    again — about 0.4 ped/m/min across the top of the range.

    It is harmless only because nothing classifies on flow: every density in
    this region is CRITICAL either way. If a flow threshold is ever reintroduced
    (invariant 3), this is the corner where it silently reads as improving.
    """
    tail = _sweep(lo=SHUFFLE_FLOOR_DENSITY, hi=JAM_DENSITY_PERSONS_M2)
    flows = [f for _, f in tail]
    assert flows == sorted(flows), "above the floor, flow is density * MIN_SPEED_MS"

    _, max_flow = capacity_flow()
    assert max(flows) < max_flow * 0.2, "the tick-up stays far below capacity flow"
    assert all(band_for_density(d) is LOSBand.CRITICAL for d, _ in tail)


def test_more_people_past_capacity_means_less_throughput():
    """The counter-intuitive fact the product rests on, stated as a test."""
    at_capacity = flow_rate(CAPACITY_DENSITY, speed_at_density(CAPACITY_DENSITY))
    denser = flow_rate(CAPACITY_DENSITY * 1.5, speed_at_density(CAPACITY_DENSITY * 1.5))
    assert denser < at_capacity


def test_flow_is_two_valued_so_it_cannot_classify():
    """THE inversion. One flow rate, two densities, opposite operational meanings.

    A free-flowing corridor at 0.5 persons/m^2 and a jammed one at 3.5 produce
    almost the same flow. Classifying on flow calls both of them NOMINAL; the
    density classifier separates them, which is invariant 3.
    """
    free_d = 0.5
    jam_d = JAM_DENSITY_PERSONS_M2 - free_d  # symmetric about capacity under Greenshields
    free_flow = flow_rate(free_d, speed_at_density(free_d))
    jam_flow = flow_rate(jam_d, speed_at_density(jam_d))

    assert free_flow == pytest.approx(jam_flow, rel=1e-9)
    assert band_for_flow(free_flow) is band_for_flow(jam_flow)  # flow cannot tell them apart

    assert band_for_density(free_d) is LOSBand.NOMINAL
    assert band_for_density(jam_d) is LOSBand.CRITICAL


def test_the_critical_flow_boundary_is_physically_unreachable():
    """Why the bands are defined on density at all.

    Fruin's LOS E/F boundary is 82 ped/m/min; the maximum this diagram can
    produce is ~80.4. A flow-defined CRITICAL band can therefore never be
    entered, which is how the discrepancy was found in the first place.
    """
    _, max_flow = capacity_flow()
    assert max_flow < LOS_E_MAX
    assert density_for_flow(LOS_E_MAX) is None
    assert density_for_flow(max_flow * 0.99) is not None


# ---------------------------------------------------------------- boundaries --

def test_band_boundaries_sit_where_the_standards_say():
    assert band_for_density(DENSITY_NOMINAL_MAX - 1e-9) is LOSBand.NOMINAL
    assert band_for_density(DENSITY_NOMINAL_MAX) is LOSBand.BUILDING
    assert band_for_density(DENSITY_BUILDING_MAX - 1e-9) is LOSBand.BUILDING
    assert band_for_density(DENSITY_BUILDING_MAX) is LOSBand.CRITICAL
    assert DENSITY_BUILDING_MAX == CAPACITY_DENSITY, "CRITICAL must start at capacity"


def test_critical_starts_at_the_peak_not_after_it():
    """A zone at capacity is already critical, however healthy its flow looks."""
    _, max_flow = capacity_flow()
    assert band_for_density(CAPACITY_DENSITY) is LOSBand.CRITICAL
    assert band_for_flow(max_flow) is not LOSBand.CRITICAL  # the flow view disagrees


# --------------------------------------------------------------- speed --------

def test_speed_falls_with_density_and_never_reaches_zero():
    assert speed_at_density(0.0) > speed_at_density(1.0) > speed_at_density(3.0)
    assert speed_at_density(JAM_DENSITY_PERSONS_M2) == MIN_SPEED_MS
    assert speed_at_density(JAM_DENSITY_PERSONS_M2 * 10) == MIN_SPEED_MS
    assert MIN_SPEED_MS > 0, "zero speed makes every travel-time estimate infinite"


# ------------------------------------------------------- the density cap ------

def test_occupancy_beyond_jam_density_becomes_queue_not_density():
    """The failure mode: without the cap an emptying node reports 30 persons/m^2.

    People beyond jam density have not vanished and have not compressed — they
    are queued along the approach, and `queue_excess` is where they go.
    """
    length, width = 100.0, 5.0
    area = length * width
    people = area * JAM_DENSITY_PERSONS_M2 * 3  # three times what fits

    raw = density(people, length, width)
    d, v, f = flow_from_occupancy(people, length, width)

    assert raw == pytest.approx(JAM_DENSITY_PERSONS_M2 * 3)
    assert d == JAM_DENSITY_PERSONS_M2, "density must be capped at what physically fits"
    assert queue_excess(people, length, width) == pytest.approx(
        people - JAM_DENSITY_PERSONS_M2 * area
    )
    assert f < capacity_flow()[1], "a jammed node cannot report a healthy flow"
    assert v == MIN_SPEED_MS


def test_no_queue_below_jam_density():
    assert queue_excess(100.0, 100.0, 5.0) == 0.0


def test_an_observed_speed_cannot_contradict_the_density():
    """A 1.3 m/s reading at jam density is a stale sample, not a fast crowd."""
    length, width = 100.0, 5.0
    people = length * width * JAM_DENSITY_PERSONS_M2
    _, v, _ = flow_from_occupancy(people, length, width, speed_ms=1.3)
    assert v == MIN_SPEED_MS


def test_an_observed_speed_is_used_when_it_is_slower_than_the_model():
    """Observation beats the model where physics permits — that is the point of
    measuring speed rather than inferring it from headcount."""
    _, v, f = flow_from_occupancy(50.0, 100.0, 5.0, speed_ms=0.4)
    assert v == pytest.approx(0.4)
    assert f == pytest.approx(density(50.0, 100.0, 5.0) * 0.4 * 60.0)
