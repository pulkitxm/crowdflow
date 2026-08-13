"""The baseline predictor: time-to-threshold, and when to stay quiet.

The output that matters is `time_to_threshold_s` — "2:47 until capacity" drives a
decision where "87% likely" does not — so the tests are about when that number
exists. It must appear when a zone is filling, and must NOT appear when a zone is
emptying, because a forecast that fires on both is a forecast of nothing.

The subtle one is `test_a_zone_past_capacity_still_warns_while_its_flow_falls`:
extrapolating flow instead of density reverses the sign of the trend exactly when
conditions get dangerous. That is invariant 3 as a prediction bug.
"""

from __future__ import annotations

import pytest
from crowdflow_contracts import (
    CAPACITY_DENSITY,
    DENSITY_BUILDING_MAX,
    DENSITY_NOMINAL_MAX,
    Confidence,
    LOSBand,
    VenueState,
    ZoneState,
)

from crowdflow_core.prediction import BaselinePredictor
from crowdflow_core.prediction.baseline import MIN_HISTORY, MODEL_ID
from crowdflow_core.state.flow import flow_rate, speed_at_density

TICK_S = 30.0
"""Spacing of the synthetic observations. Matches the state engine's default
window, so a series here is a series the loop could actually produce."""


def zone_state(density: float, t: float, zone_id: str = "hall") -> ZoneState:
    """A ZoneState with an internally consistent density/speed/flow triple."""
    speed = speed_at_density(density)
    return ZoneState(
        zone_id=zone_id,
        timestamp=t,
        observed_nodes=60,
        participation_rate=0.2,
        density_persons_m2=density,
        flow_ped_m_min=flow_rate(density, speed),
        mean_speed_ms=speed,
        inflow_per_min=30.0,
        outflow_per_min=10.0,
        confidence=Confidence(
            value=0.8, observed_nodes=60, freshness_s=1.0,
            mean_accuracy_m=8.0, stability=0.9,
        ),
    )


def feed(predictor: BaselinePredictor, densities: list[float], zone_id: str = "hall"):
    """Observe a density series, one tick apart. Returns the last forecast."""
    forecast = None
    for i, d in enumerate(densities):
        state = VenueState(
            circuit_id="testcircuit",
            timestamp=i * TICK_S,
            zones={zone_id: zone_state(d, i * TICK_S, zone_id)},
        )
        forecasts = predictor.forecast(state)
        forecast = forecasts[0] if forecasts else None
    return forecast


# ------------------------------------------------------------ rising --------

def test_rising_density_produces_a_time_to_threshold():
    """The headline. A filling zone gets a countdown to the band it will cross."""
    f = feed(BaselinePredictor(), [0.20, 0.30, 0.40, 0.50])

    assert f is not None
    assert f.time_to_threshold_s is not None and f.time_to_threshold_s > 0
    assert f.target_band is LOSBand.BUILDING
    assert f.model_id == MODEL_ID

    # 0.1 persons/m^2 per 30 s tick, currently 0.5, threshold at DENSITY_NOMINAL_MAX.
    expected = (DENSITY_NOMINAL_MAX - 0.50) / (0.10 / TICK_S)
    assert f.time_to_threshold_s == pytest.approx(expected, rel=0.02)


def test_a_faster_rise_gives_less_warning():
    slow = feed(BaselinePredictor(), [0.20, 0.25, 0.30, 0.35])
    fast = feed(BaselinePredictor(), [0.20, 0.35, 0.50, 0.65])
    assert fast.time_to_threshold_s < slow.time_to_threshold_s
    assert fast.probability > slow.probability


def test_the_forecast_names_its_causes():
    f = feed(BaselinePredictor(), [0.20, 0.40, 0.60, 0.80])
    assert any("rising" in c for c in f.causes)
    assert any("inflow" in c for c in f.causes), "net inflow is the operator's lever"


# ------------------------------------------------------------ falling -------

def test_falling_density_does_not_produce_a_time_to_threshold():
    """An emptying zone is not a warning. A predictor that fires on both
    directions is telling the operator nothing they can act on."""
    f = feed(BaselinePredictor(), [0.80, 0.60, 0.40, 0.20])

    assert f is not None, "the zone is still reported..."
    assert f.time_to_threshold_s is None, "...but it is not counting down to anything"
    assert not f.is_actionable
    assert f.probability <= 0.05


def test_a_flat_zone_does_not_produce_a_time_to_threshold():
    f = feed(BaselinePredictor(), [0.40, 0.40, 0.40, 0.40])
    assert f.time_to_threshold_s is None
    assert not f.is_actionable


def test_a_rise_too_slow_to_matter_within_the_horizon_is_not_reported():
    """Everything crosses eventually. Only the horizon makes a forecast useful."""
    predictor = BaselinePredictor(horizon_s=300.0)
    f = feed(predictor, [0.20, 0.201, 0.202, 0.203])
    assert f.time_to_threshold_s is None
    assert not f.is_actionable


# -------------------------------------------------- density, never flow -----

def test_a_zone_past_capacity_still_warns_while_its_flow_falls():
    """Invariant 3, as the prediction bug it would have been.

    Past capacity density, extra people mean LESS flow. This series rises in
    density on every tick while its flow rate falls on every tick — so a
    predictor extrapolating flow would report an improving corridor at the exact
    moment it collapses.
    """
    densities = [CAPACITY_DENSITY + 0.2 * i for i in range(4)]
    flows = [flow_rate(d, speed_at_density(d)) for d in densities]
    assert flows == sorted(flows, reverse=True), "flow falls across this series"

    f = feed(BaselinePredictor(), densities)
    assert f.target_band is LOSBand.CRITICAL
    assert f.time_to_threshold_s == 0.0, "already past the threshold: act now"
    assert f.probability >= 0.9
    assert f.projected_peak_density_persons_m2 > densities[-1], "projection is in density units"


def test_a_zone_above_the_nominal_band_counts_down_to_critical_not_to_building():
    f = feed(BaselinePredictor(), [DENSITY_NOMINAL_MAX + 0.1 * i for i in range(4)])
    assert f.target_band is LOSBand.CRITICAL
    assert 0 < f.time_to_threshold_s
    current = DENSITY_NOMINAL_MAX + 0.3
    assert f.time_to_threshold_s == pytest.approx(
        (DENSITY_BUILDING_MAX - current) / (0.1 / TICK_S), rel=0.02
    )


# ---------------------------------------------------------- evidence --------

def test_two_points_are_not_enough_history():
    """Two points give a slope but no evidence it is real."""
    predictor = BaselinePredictor()
    for n in range(1, MIN_HISTORY):
        assert feed(BaselinePredictor(), [0.2 + 0.1 * i for i in range(n)]) is None
    assert feed(predictor, [0.2 + 0.1 * i for i in range(MIN_HISTORY)]) is not None


def test_the_forecast_carries_the_state_s_confidence_not_its_own():
    """A dashboard must never be able to imply a learned model produced this."""
    f = feed(BaselinePredictor(), [0.20, 0.30, 0.40, 0.50])
    assert f.confidence == 0.8
    assert f.model_id == "baseline-v1"


def test_forecasts_are_ordered_worst_first():
    """The operator reads the top of the list under time pressure."""
    predictor = BaselinePredictor()
    for i in range(4):
        t = i * TICK_S
        predictor.forecast(
            VenueState(
                circuit_id="testcircuit",
                timestamp=t,
                zones={
                    "slow": zone_state(0.20 + 0.02 * i, t, "slow"),
                    "fast": zone_state(0.20 + 0.15 * i, t, "fast"),
                    "empty": zone_state(0.80 - 0.15 * i, t, "empty"),
                },
            )
        )
    ordered = predictor.forecast(
        VenueState(
            circuit_id="testcircuit",
            timestamp=4 * TICK_S,
            zones={
                "slow": zone_state(0.28, 4 * TICK_S, "slow"),
                "fast": zone_state(0.80, 4 * TICK_S, "fast"),
                "empty": zone_state(0.20, 4 * TICK_S, "empty"),
            },
        )
    )
    assert [f.zone_id for f in ordered][:2] == ["fast", "slow"]
    assert ordered[-1].zone_id == "empty", "zones with no countdown sort last"

    actionable = predictor.actionable(
        VenueState(circuit_id="testcircuit", timestamp=5 * TICK_S,
                   zones={"empty": zone_state(0.05, 5 * TICK_S, "empty")})
    )
    assert actionable == []
