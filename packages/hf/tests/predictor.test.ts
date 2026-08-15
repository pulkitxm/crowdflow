import { describe, expect, it } from 'vitest';
import type { LOSBand, VenueState, ZoneState } from '@crowdflow/contracts';
import { composeForecast, FEATURE_NAMES, HfPredictor, toTabularData, zoneFeatureRow, zoneFeatures } from '../src/index.js';

function zone(id: string, density: number, band: LOSBand = 'nominal'): ZoneState {
  return {
    zone_id: id, timestamp: 100, observed_nodes: 20, participation_rate: 0.2,
    density_persons_m2: density, flow_ped_m_min: 10, queue_excess: 0, mean_speed_ms: 1,
    dominant_heading_deg: null, inflow_per_min: 2, outflow_per_min: 1,
    confidence: { value: 0.8, observed_nodes: 20, freshness_s: 0, mean_accuracy_m: 5, stability: 1, reportable: true },
    estimated_population: 100, band, over_capacity: false, los_grade: 'A', net_flow_per_min: 1,
  };
}

describe('feature extraction', () => {
  it('produces one value per documented feature, in order', () => {
    const row = zoneFeatureRow(zone('a', 0.5));
    expect(row).toHaveLength(FEATURE_NAMES.length);
    const named = zoneFeatures(zone('a', 0.5));
    expect(Object.keys(named).sort()).toEqual([...FEATURE_NAMES].sort());
    expect(named.over_capacity).toBe(0);
    expect(named.capacity_utilization).toBeGreaterThan(0);
  });

  it('builds a columnar tabular payload aligned to row order', () => {
    const data = toTabularData([
      { zone_id: 'a', features: zoneFeatureRow(zone('a', 0.5)) },
      { zone_id: 'b', features: zoneFeatureRow(zone('b', 2.0)) },
    ]);
    expect(data['density_persons_m2']).toEqual(['0.5', '2']);
  });
});

describe('composeForecast', () => {
  it('maps a crossing time to an actionable forecast', () => {
    const forecast = composeForecast(zone('a', 0.5), 180, 'hf:test', 300);
    expect(forecast.time_to_threshold_s).toBe(180);
    expect(forecast.probability).toBeGreaterThan(0.05);
    expect(forecast.model_id).toBe('hf:test');
  });

  it('treats an out-of-horizon output as no crossing', () => {
    const forecast = composeForecast(zone('a', 0.5), 999, 'hf:test', 300);
    expect(forecast.time_to_threshold_s).toBeNull();
    expect(forecast.probability).toBe(0.05);
  });
});

describe('HfPredictor', () => {
  it('forecasts every observed zone in one batch and sorts by urgency', async () => {
    const model = { model_id: 'hf:test', infer: async () => [180, 999] };
    const state: VenueState = { circuit_id: 'x', timestamp: 100, zones: { a: zone('a', 0.5), b: zone('b', 0.5) } };
    const forecasts = await new HfPredictor(model, { horizonS: 300 }).forecast(state);
    expect(forecasts.map((f) => f.zone_id)).toEqual(['a', 'b']);
    expect(forecasts[0]!.time_to_threshold_s).toBe(180);
    expect(forecasts[1]!.time_to_threshold_s).toBeNull();
  });

  it('returns no forecasts when nothing is observed', async () => {
    const model = { model_id: 'hf:test', infer: async () => [] };
    const forecasts = await new HfPredictor(model).forecast({ circuit_id: 'x', timestamp: 0, zones: {} });
    expect(forecasts).toEqual([]);
  });
});
