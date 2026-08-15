import { describe, expect, it } from 'vitest';
import type { LOSBand, VenueState, ZoneState } from '@crowdflow/contracts';
import { labelStates } from '../src/index.js';

function zone(id: string, band: LOSBand): ZoneState {
  return {
    zone_id: id, timestamp: 0, observed_nodes: 20, participation_rate: 0.2,
    density_persons_m2: 0.5, flow_ped_m_min: 10, queue_excess: 0, mean_speed_ms: 1,
    dominant_heading_deg: null, inflow_per_min: 2, outflow_per_min: 1,
    confidence: { value: 0.8, observed_nodes: 20, freshness_s: 0, mean_accuracy_m: 5, stability: 1, reportable: true },
    estimated_population: 100, band, over_capacity: false, los_grade: 'A', net_flow_per_min: 1,
  };
}

function state(t: number, bands: Record<string, LOSBand>): VenueState {
  return { circuit_id: 'x', timestamp: t, zones: Object.fromEntries(Object.entries(bands).map(([id, band]) => [id, zone(id, band)])) };
}

describe('labelStates', () => {
  const states = [0, 2, 4, 6, 8, 10].map((t) => state(t, { a: t >= 10 ? 'critical' : 'nominal' }));

  it('labels each tick with seconds until the next critical band', () => {
    const rows = labelStates(states, { scenario: 's', seed: 1, horizonS: 10 });
    const byTick = new Map(rows.map((row) => [row.tick_s, row.congested_within_s]));
    expect(byTick.get(0)).toBe(10);
    expect(byTick.get(8)).toBe(2);
  });

  it('labels null once the zone is already critical or the horizon is empty', () => {
    const rows = labelStates(states, { scenario: 's', seed: 1, horizonS: 10 });
    expect(rows.find((row) => row.tick_s === 10)!.congested_within_s).toBeNull();
  });

  it('records scenario, seed and features on every row', () => {
    const rows = labelStates(states, { scenario: 's', seed: 7, horizonS: 10 });
    expect(rows[0]!.scenario).toBe('s');
    expect(rows[0]!.seed).toBe(7);
    expect(rows[0]!.features.density_persons_m2).toBe(0.5);
  });
});
