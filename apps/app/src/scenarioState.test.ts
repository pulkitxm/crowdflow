import { describe, expect, it } from 'vitest';
import type { ScenarioSnapshot } from '@crowdflow/contracts/wire';
import { acceptScenarioSnapshot } from './scenarioState.js';

function snapshot(revision: number): ScenarioSnapshot {
  return { revision, lifecycle: 'idle', circuit_id: null, session: null, active_hazards: [], hazard_history: [], gates: [], evacuation: { enabled: false, total_population: 0, evacuated: 0, remaining: 0, awaiting_safe_route: 0, throughput_per_minute: 0, congestion: 'nominal', estimated_clearance_s: null }, event_history: [], operational_warning: null };
}

describe('scenario snapshot ordering', () => {
  it('rejects stale updates and accepts equal or newer revisions', () => {
    const current = snapshot(7);
    expect(acceptScenarioSnapshot(current, snapshot(6))).toBe(current);
    expect(acceptScenarioSnapshot(current, snapshot(7)).revision).toBe(7);
    expect(acceptScenarioSnapshot(current, snapshot(8)).revision).toBe(8);
  });
});
