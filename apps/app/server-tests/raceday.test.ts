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

  it('reports the clock as before the event rather than leaving the reader to guess', () => {
    const status = run().status();
    expect(status.day_state).toBe('pre_event');
    expect(status.crowd.walking + status.crowd.dwelling).toBe(0);
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
