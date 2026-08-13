import type { Forecast, VenueState, ZoneState } from '@crowdflow/contracts';
import {
  DENSITY_BUILDING_MAX,
  DENSITY_NOMINAL_MAX,
  isActionable,
} from '@crowdflow/contracts';

export const MODEL_ID = 'baseline-v1';
export const MIN_HISTORY = 3;

export class BaselinePredictor {
  private density = new Map<string, Array<[number, number]>>();
  constructor(readonly horizonS = 300, readonly history = 8) {}

  observe(state: VenueState): void {
    for (const [id, zone] of Object.entries(state.zones ?? {})) {
      const series = this.density.get(id) ?? [];
      series.push([zone.timestamp, zone.density_persons_m2]);
      this.density.set(id, series.slice(-this.history));
    }
  }

  forecastZone(zone: ZoneState): Forecast | null {
    const series = this.density.get(zone.zone_id) ?? [];
    if (series.length < MIN_HISTORY) return null;
    const slope = leastSquaresSlope(series);
    const current = zone.density_persons_m2;
    const target = current >= DENSITY_NOMINAL_MAX ? DENSITY_BUILDING_MAX : DENSITY_NOMINAL_MAX;
    let time: number | null = null;
    if (slope > 1e-6 && current < target) {
      const projectedTime = (target - current) / slope;
      if (projectedTime <= this.horizonS) time = projectedTime;
    } else if (current >= target) time = 0;
    const causes: string[] = [];
    if (zone.net_flow_per_min > 0) causes.push(`inflow ${zone.inflow_per_min.toFixed(0)}/min against outflow ${zone.outflow_per_min.toFixed(0)}/min`);
    if (slope > 0) causes.push(`density rising ${(slope * 60).toFixed(2)} persons/m2 per minute`);
    if (zone.mean_speed_ms < 1) causes.push(`speed down to ${zone.mean_speed_ms.toFixed(2)} m/s`);
    const probability = time == null
      ? (slope <= 0 ? 0.05 : 0.25)
      : time <= 0 ? 0.95 : clamp(1 - (time / this.horizonS) * 0.7, 0.05, 0.95);
    const forecast: Forecast = {
      zone_id: zone.zone_id,
      issued_at: zone.timestamp,
      horizon_s: this.horizonS,
      target_band: target === DENSITY_BUILDING_MAX ? 'critical' : 'building',
      probability: round(probability, 3),
      time_to_threshold_s: time == null ? null : round(time, 1),
      projected_peak_density_persons_m2: round(Math.max(current, current + slope * this.horizonS), 2),
      confidence: zone.confidence.value,
      model_id: MODEL_ID,
      causes,
      actionable: false,
    };
    return { ...forecast, actionable: isActionable(forecast) };
  }

  forecast(state: VenueState): Forecast[] {
    this.observe(state);
    return Object.values(state.zones ?? {})
      .map((zone) => this.forecastZone(zone))
      .filter((forecast): forecast is Forecast => forecast != null)
      .sort((a, b) => (a.time_to_threshold_s ?? Infinity) - (b.time_to_threshold_s ?? Infinity));
  }
}

function leastSquaresSlope(series: Array<[number, number]>): number {
  const meanT = series.reduce((sum, [time]) => sum + time, 0) / series.length;
  const meanV = series.reduce((sum, [, value]) => sum + value, 0) / series.length;
  const numerator = series.reduce((sum, [time, value]) => sum + (time - meanT) * (value - meanV), 0);
  const denominator = series.reduce((sum, [time]) => sum + (time - meanT) ** 2, 0);
  return denominator === 0 ? 0 : numerator / denominator;
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function round(value: number, digits: number): number { return Number(value.toFixed(digits)); }
