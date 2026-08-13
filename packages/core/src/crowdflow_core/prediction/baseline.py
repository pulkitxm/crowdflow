"""Rule baseline predictor.

Ships first and always works. Deterministic time-to-threshold from the observed
flow trend — no training, no model file, nothing to go wrong on stage. A learned
model is an upgrade that must beat this, not a replacement for it.

The headline output is time_to_threshold_s, not a probability: "2:47 until
capacity" drives a decision, "87% likely" does not.
"""

from __future__ import annotations

from collections import defaultdict

from crowdflow_contracts import (
    DENSITY_BUILDING_MAX,
    DENSITY_NOMINAL_MAX,
    Forecast,
    LOSBand,
    VenueState,
    ZoneState,
)

MODEL_ID = "baseline-v1"
MIN_HISTORY = 3
"""Two points give a slope but no evidence it is real. Three is the floor."""


class BaselinePredictor:
    """Linear extrapolation of flow, per zone.

    Deliberately simple and deliberately honest about it: the forecast carries
    the model id, so a dashboard can never imply a learned model produced a
    baseline number.
    """

    def __init__(self, horizon_s: float = 300.0, history: int = 8) -> None:
        self.horizon_s = horizon_s
        self.history = history
        self._flow: dict[str, list[tuple[float, float]]] = defaultdict(list)

    def observe(self, state: VenueState) -> None:
        for zid, z in state.zones.items():
            series = self._flow[zid]
            series.append((z.timestamp, z.density_persons_m2))
            del series[: -self.history]

    def _slope(self, series: list[tuple[float, float]]) -> float:
        """Least-squares slope in ped/m/min per second."""
        n = len(series)
        mean_t = sum(t for t, _ in series) / n
        mean_f = sum(f for _, f in series) / n
        num = sum((t - mean_t) * (f - mean_f) for t, f in series)
        den = sum((t - mean_t) ** 2 for t, _ in series)
        return num / den if den else 0.0

    def forecast_zone(self, zone: ZoneState) -> Forecast | None:
        series = self._flow.get(zone.zone_id, [])
        if len(series) < MIN_HISTORY:
            return None

        # Extrapolate DENSITY, not flow. Flow is non-monotonic, so a rising flow
        # trend reverses sign exactly when conditions get dangerous.
        slope = self._slope(series)
        current = zone.density_persons_m2
        target = (
            DENSITY_BUILDING_MAX if current >= DENSITY_NOMINAL_MAX else DENSITY_NOMINAL_MAX
        )
        band = LOSBand.CRITICAL if target == DENSITY_BUILDING_MAX else LOSBand.BUILDING

        causes: list[str] = []
        time_to: float | None = None
        if slope > 1e-6 and current < target:
            time_to = (target - current) / slope
            if time_to > self.horizon_s:
                time_to = None
        elif current >= target:
            time_to = 0.0

        projected = max(current, current + slope * self.horizon_s)

        if zone.net_flow_per_min > 0:
            causes.append(
                f"inflow {zone.inflow_per_min:.0f}/min against outflow "
                f"{zone.outflow_per_min:.0f}/min"
            )
        if slope > 0:
            causes.append(f"density rising {slope * 60:.2f} persons/m2 per minute")
        if zone.mean_speed_ms < 1.0:
            causes.append(f"speed down to {zone.mean_speed_ms:.2f} m/s")

        # Probability from how fast it is closing on the threshold, tempered by
        # how much of the horizon is left. Confidence is the state's, not ours.
        if time_to is None:
            probability = 0.05 if slope <= 0 else 0.25
        elif time_to <= 0:
            probability = 0.95
        else:
            probability = max(0.05, min(0.95, 1.0 - (time_to / self.horizon_s) * 0.7))

        return Forecast(
            zone_id=zone.zone_id,
            issued_at=zone.timestamp,
            horizon_s=self.horizon_s,
            target_band=band,
            probability=round(probability, 3),
            time_to_threshold_s=None if time_to is None else round(time_to, 1),
            projected_peak_density_persons_m2=round(projected, 2),
            confidence=zone.confidence.value,
            model_id=MODEL_ID,
            causes=causes,
        )

    def forecast(self, state: VenueState) -> list[Forecast]:
        """All actionable forecasts, worst first."""
        self.observe(state)
        out = []
        for zone in state.zones.values():
            f = self.forecast_zone(zone)
            if f is not None:
                out.append(f)
        out.sort(key=lambda f: (f.time_to_threshold_s is None,
                                f.time_to_threshold_s or 0.0))
        return out

    def actionable(self, state: VenueState) -> list[Forecast]:
        return [f for f in self.forecast(state) if f.is_actionable]
