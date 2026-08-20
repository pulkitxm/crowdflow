import { describe, expect, it } from 'vitest';
import { ASSUMED_MIN_ANCHORS_FOR_FIX } from '@crowdflow/contracts';
import type { CircuitPack } from '@crowdflow/contracts';
import { AnchorMap, NodeIdentity, PositionFuser, crowdNodeFrom, distanceM, fixFrom, trilaterate } from '@crowdflow/core/positioning';

import { demoSource } from '../circuits/registry';
import { DEMO_GEOMETRY } from '../circuits/demo';
import { RehearsalGnss, RehearsalRadio, Walk } from './rehearsal';

/**
 * The app with NO server configured.
 *
 * This is the path somebody takes first — `bun run web`, no API, no venue — and
 * it is the one path where the anchor map is generated in the app rather than
 * downloaded. If it produces nothing, rehearsal mode shows "placed by nothing"
 * forever and looks like a broken feature rather than a missing server.
 *
 * The assertions are deliberately about the JOIN between layers: that the
 * bundled pack has enough zones for a plan, that the plan's spacing is tight
 * enough to solve against, that the walk stays inside the venue bounds the
 * fuser enforces, and that a fix survives `crowdNodeFrom`'s boundary and
 * rounding checks. Each layer passes its own tests; this is the seam.
 */

const pack = DEMO_GEOMETRY.pack as unknown as CircuitPack;
const START = 1_000_000;

describe('rehearsal with no server', () => {
  it('plans an anchor map from the bundled pack, and labels it unsurveyed', async () => {
    const anchors = await demoSource().anchors('silverstone');
    const all = Object.values(anchors.anchors ?? {});
    expect(all.length).toBeGreaterThan(50);
    expect(all.some((anchor) => anchor.kind === 'wifi_ap')).toBe(true);
    // A plan, not a survey — and every consumer reads this field to know which.
    expect(anchors.surveyed_at).toBeNull();
    expect(all.every((anchor) => anchor.path_loss_exponent.provenance === 'assumed')).toBe(true);
  });

  it('solves a walk end to end against that plan', async () => {
    const anchors = await demoSource().anchors('silverstone');
    const walk = new Walk(pack, START);
    const wifi = new RehearsalRadio('wifi', anchors, walk, 30, { seed: 3 });
    const gnss = new RehearsalGnss(walk, 10);
    const map = new AnchorMap(anchors);
    const fuser = new PositionFuser(pack.frame);
    const identity = new NodeIdentity(START, undefined, () => 'ab'.repeat(16));

    expect((await wifi.availability()).usable).toBe(true);

    let fixes = 0;
    let reportable = 0;
    const errors: number[] = [];
    for (let tick = 0; tick < 40; tick++) {
      const now = START + tick * 10;
      const truth = walk.at(now);
      const resolved = map.resolve(await wifi.scan(now), now, ['wifi_ap']);
      if (resolved.matched >= ASSUMED_MIN_ANCHORS_FOR_FIX) {
        fuser.offer(fixFrom(trilaterate(resolved.ranges), 'wifi', now));
      }
      const satellite = await gnss.fix(now);
      if (satellite) fuser.offer(satellite);

      const fix = fuser.resolve(now).fix;
      if (!fix) continue;
      fixes += 1;
      errors.push(distanceM(fix.position, truth));
      // Null here would mean the walk left the venue bounds, or the fix had no
      // usable accuracy — both are silent failures on a status screen.
      if (crowdNodeFrom(fix, identity, pack)) reportable += 1;
    }

    expect(fixes).toBeGreaterThan(30);
    expect(reportable).toBe(fixes);
    errors.sort((a, b) => a - b);
    expect(errors[Math.floor(errors.length / 2)]!).toBeLessThan(30);
  });

  it('keeps the rehearsed walk inside the venue the fuser will accept', () => {
    const walk = new Walk(pack, START);
    const [minX, minY, maxX, maxY] = pack.frame.venue_bounds_m as [number, number, number, number];
    for (let tick = 0; tick < 200; tick++) {
      const point = walk.at(START + tick * 10);
      expect(point.x).toBeGreaterThanOrEqual(minX);
      expect(point.x).toBeLessThanOrEqual(maxX);
      expect(point.y).toBeGreaterThanOrEqual(minY);
      expect(point.y).toBeLessThanOrEqual(maxY);
    }
  });
});
