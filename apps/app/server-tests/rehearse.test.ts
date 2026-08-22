import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planAnchors } from '@crowdflow/core/positioning';
import { readPack } from '@crowdflow/cli/ingest';
import { rehearseLivePhones } from '@crowdflow/cli/rehearse';
import { CrowdFlowServer } from '../server/index.js';

/**
 * The whole loop, in one test: simulated radio → anchor resolution → solve →
 * fusion ladder → rotating pseudonym → HTTP → state engine → live snapshot.
 *
 * This is the test that would catch the failures no unit test can see, because
 * each of them is a disagreement BETWEEN two layers that are individually
 * correct — a venue frame projected one way and un-projected the other, an
 * epoch the server derives differently from the handset, a position rounded to
 * decimetres and then rejected for being outside bounds it was inside before
 * rounding. All of those pass every unit test and produce a console with no dots
 * on it.
 *
 * It runs against a real HTTP server on a real port, because "it works when I
 * call the method directly" is exactly the class of bug this is for.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const anchorsPath = join(root, 'circuits/silverstone/pack/anchors.json');

let server: CrowdFlowServer | null = null;
let wroteAnchors = false;

afterEach(async () => {
  await server?.close();
  server = null;
  // The anchor plan is a generated artefact and gitignored. If this test made
  // one, it takes it away again — a 1.8 MB file of assumed hardware positions
  // left behind in a circuit pack reads as a survey to anyone who does not open
  // it.
  if (wroteAnchors && existsSync(anchorsPath)) { rmSync(anchorsPath); wroteAnchors = false; }
});

describe('live sensing, end to end', () => {
  it('carries a simulated crowd from radio scans to the console picture', async () => {
    if (!existsSync(anchorsPath)) {
      writeFileSync(anchorsPath, `${JSON.stringify(planAnchors(readPack(root, 'silverstone'), { spacing_m: 30 }), null, 2)}\n`);
      wroteAnchors = true;
    }

    server = new CrowdFlowServer(root);
    server.startLive({ circuit_id: 'silverstone', participation: 0.18 });
    await server.listen(0);
    const address = server.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const run = await rehearseLivePhones({
      api: `http://127.0.0.1:${port}`,
      circuitId: 'silverstone',
      phones: 12,
      ticks: 3,
      // Sub-second ticks keep the suite fast. The server's reporting window is
      // thirty seconds, so every sample stays inside it.
      intervalS: 0.4,
      seed: 42,
      sigmaDb: 6,
      gnssSigmaM: 9,
      radios: ['wifi', 'ble', 'gnss'],
    });

    expect(run.accepted).toBeGreaterThan(20);
    expect(run.rejected).toBe(0);
    expect(run.problems).toEqual([]);
    // The Wi-Fi rung solved at all, which is the thing an anchor pack is for.
    expect(run.wifi_solves).toBeGreaterThan(10);
    // And the ladder actually arbitrated rather than pinning one source: with a
    // 9 m GNSS control against a trilateration of comparable quality, both rungs
    // should win somewhere.
    expect(Object.keys(run.by_source).length).toBeGreaterThan(1);
    // Ground truth the console cannot know. A p50 above a zone's scale would
    // mean the dots are in the wrong places even though everything "worked".
    expect(run.p50_error_m).toBeLessThan(25);

    const snapshot = server.live!.snapshot(Date.now() / 1000);
    expect(snapshot.reporting_devices).toBe(12);
    expect(snapshot.coverage.observed).toBeGreaterThan(0);
    // Zones a handset reported from are observed; the remaining 1,800-odd are
    // unknown, not empty — the distinction the whole coverage report exists for.
    expect(snapshot.coverage.observed).toBeLessThan(snapshot.coverage.zones_total);
    expect(Object.values(snapshot.by_source ?? {}).reduce((sum, count) => sum + (count ?? 0), 0)).toBe(run.accepted);
    // Every dot the console would draw carries an error bar, because a fix with
    // no sigma is a point and a fix is never a point.
    for (const mark of snapshot.nodes ?? []) expect(mark.accuracy_m).toBeGreaterThan(0);
  }, 30_000);
});
