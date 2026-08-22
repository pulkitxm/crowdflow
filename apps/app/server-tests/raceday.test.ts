import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DAY_S } from '@crowdflow/core';
import { CrowdFlowServer } from '../server/app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function run(population = 300) {
  return new CrowdFlowServer(root).startRaceDay({ population, seed: 7 });
}

describe('race day status', () => {
  it('names every zone kind in the venue even while the venue is empty', () => {
    const status = run().status();
    expect(status.by_area.length).toBeGreaterThan(0);
    for (const area of status.by_area) {
      expect(area.label).not.toHaveLength(0);
      expect(area.count).toBeGreaterThanOrEqual(0);
    }
  });

  it('opens shortly before the first arrival instead of at an empty midnight', () => {
    const day = run();
    const earliest = day.session.sim.agents.reduce((first, agent) => Math.min(first, agent.depart_at_s), Infinity);
    expect(day.openAtS).toBeGreaterThan(0);
    expect(day.openAtS).toBeLessThanOrEqual(earliest);
    expect(day.status().crowd.walking + day.status().crowd.dwelling).toBe(0);
  });

  it('never skips past a spectator who was due to set off', () => {
    const day = new CrowdFlowServer(root).startRaceDay({ population: 300, seed: 7, start_at_s: DAY_S });
    const earliest = day.session.sim.agents.reduce((first, agent) => Math.min(first, agent.depart_at_s), Infinity);
    expect(day.openAtS).toBe(earliest);
  });

  it('honours an explicit opening time so a demo can jump to a moment', () => {
    const day = new CrowdFlowServer(root).startRaceDay({ population: 300, seed: 7, start_at_s: 0 });
    expect(day.openAtS).toBe(0);
    expect(day.status().day_state).toBe('pre_event');
  });

  it('distinguishes a finished day from a broken one', () => {
    const day = run();
    day.session.sim.timeS = DAY_S;
    const status = day.status();
    expect(status.day_state).toBe('complete');
    expect(status.clock_local).toBe('24:00:00');
    expect(status.by_area.length).toBeGreaterThan(0);
  });
});
