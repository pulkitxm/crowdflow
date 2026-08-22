import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CrowdNode, NodeReport } from '@crowdflow/contracts';
import { ASSUMED_ID_ROTATION_S, LOCATION_DISCLOSURE_VERSION } from '@crowdflow/contracts';
import { LiveIngest } from '../server/live.js';
import { PeopleStore } from '../server/people.js';
import { loadCircuit } from '../server/packs.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const INSIDE = { x: 120, y: 240 };

function armed(): { live: LiveIngest; people: PeopleStore } {
  const people = new PeopleStore(':memory:');
  const live = new LiveIngest(loadCircuit(root, 'silverstone'), { participation: 1 }, people);
  return { live, people };
}

function report(personId: number, now: number, index: number): NodeReport {
  const epoch = Math.floor(now / ASSUMED_ID_ROTATION_S);
  const id = `nd-${personId}`;
  const node: CrowdNode = {
    node_id: id, epoch, timestamp: Math.round(now),
    position: { x: INSIDE.x + (index % 5), y: INSIDE.y + (index % 3) },
    speed_ms: 0.8, heading_deg: 45, accuracy_m: 6,
  };
  return { person_id: personId, node_id: id, epoch, circuit_id: 'silverstone', consent_version: LOCATION_DISCLOSURE_VERSION, sources: ['gnss'], nodes: [node] };
}

describe('live ingest forecasting', () => {
  it('produces no forecast until the trend has enough samples', () => {
    const { live, people } = armed();
    const start = 1_800_000;
    people.login(1, 'silverstone', start);
    live.report(report(1, start, 0), start);
    expect(live.snapshot(start).forecasts ?? []).toHaveLength(0);
    expect(live.snapshot(start + 1).forecasts ?? []).toHaveLength(0);
  });

  it('forecasts live zones once the trend spans enough samples, naming the model', () => {
    const { live, people } = armed();
    const start = 1_800_000;
    for (let step = 0; step < 5; step++) {
      const now = start + step * 6;
      for (let n = 0; n <= step * 3; n++) {
        const personId = 1 + n;
        people.login(personId, 'silverstone', now);
        live.report(report(personId, now, n), now);
      }
      live.snapshot(now);
    }
    const snapshot = live.snapshot(start + 30);
    expect((snapshot.forecasts ?? []).length).toBeGreaterThan(0);
    expect(snapshot.forecasts![0]!.model_id).toBe('baseline-v1');
    expect(snapshot.forecasts![0]!.horizon_s).toBeGreaterThan(0);
    expect(Array.isArray(snapshot.actionable)).toBe(true);
  });

  it('drops forecasts when the operator clears live ingest', () => {
    const { live, people } = armed();
    const start = 1_800_000;
    for (let step = 0; step < 5; step++) {
      const now = start + step * 6;
      people.login(1, 'silverstone', now);
      live.report(report(1, now, step), now);
      live.snapshot(now);
    }
    expect((live.snapshot(start + 30).forecasts ?? []).length).toBeGreaterThan(0);
    live.clear();
    expect(live.snapshot(start + 30).forecasts ?? []).toHaveLength(0);
  });
});
