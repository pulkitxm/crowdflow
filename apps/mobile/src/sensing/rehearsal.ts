/**
 * A handset that walks the circuit without anybody walking the circuit.
 *
 * This is how the sensing stack is tested, and it is not a mock. The scans it
 * produces come from the same log-distance law, the same scan floor and the same
 * list cap as `@crowdflow/core/positioning`'s harness, against the same anchor
 * pack a real phone would download. Everything downstream of the radio — the
 * anchor resolution, the trilateration, the fusion ladder, the pseudonym
 * rotation, the uplink queue, the server's validation, the console's dots — runs
 * exactly as it does on a device. What is simulated is the radio and nothing
 * else.
 *
 * That matters because the alternative is testing this on hardware only. Radio
 * positioning has a lot of failure modes that are not about radios: a wrong
 * venue frame, a rotation applied in the wrong direction, an epoch that never
 * rolls, a queue that never drains. Every one of those is a bug you can find on
 * a laptop in a second, and would otherwise find at a circuit with a phone in
 * your hand and no debugger.
 *
 * What it cannot tell you is whether the log-distance law holds at your venue,
 * because it assumes it. It is the rehearsal, not the performance.
 */

import type { AnchorPack, CircuitPack, Position, PositionFix, RadioAnchor, RadioObservation } from '@crowdflow/contracts';
import { FREE_FLOW_SPEED_MS } from '@crowdflow/contracts';
import { AnchorMap, simulateScan } from '@crowdflow/core/positioning';
// The seeded MT19937 stream, from its own subpath. Not re-exported through
// `positioning` because the package root already exports it and two `export *`
// paths offering the same name silently cancel each other out in ES modules.
import { Random } from '@crowdflow/core/random';
import type { AnchorScanner, FixProvider, ScannerAvailability } from './types';

/**
 * A walk around the venue, as ground truth.
 *
 * Shared between the rehearsal sensors so that the Wi-Fi scan, the BLE scan and
 * the GNSS fix all describe the same person in the same place. Independent
 * sensors would each wander off separately, the fuser would arbitrate between
 * three different people, and the ladder would look like it was working while
 * measuring nothing.
 */
export class Walk {
  readonly path: Position[];
  constructor(pack: CircuitPack, readonly startedAt: number, readonly speedMs = FREE_FLOW_SPEED_MS) {
    // Zones in pack order, which for an imported pack is a tour of the venue
    // rather than a straight line — the point is to pass close to some anchors
    // and far from others, because a walk that stays in good coverage proves
    // nothing about the gaps.
    const zones = Object.values(pack.zones ?? {});
    this.path = zones.length > 1 ? zones.map((zone) => zone.position) : [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  }

  /** Where the walker is at `now`, looping back to the start at the end. */
  at(now: number): Position {
    const distance = Math.max(0, now - this.startedAt) * this.speedMs;
    const legs: number[] = [];
    let total = 0;
    for (let index = 0; index + 1 < this.path.length; index++) {
      const length = Math.hypot(this.path[index + 1]!.x - this.path[index]!.x, this.path[index + 1]!.y - this.path[index]!.y);
      legs.push(length);
      total += length;
    }
    if (total <= 0) return this.path[0]!;
    let remaining = distance % total;
    for (let index = 0; index < legs.length; index++) {
      if (remaining <= legs[index]!) {
        const t = legs[index]! === 0 ? 0 : remaining / legs[index]!;
        const from = this.path[index]!;
        const to = this.path[index + 1]!;
        return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      }
      remaining -= legs[index]!;
    }
    return this.path.at(-1)!;
  }
}

export interface RehearsalOptions {
  /** shadowing spread, dB. Six is the conventional built-environment figure. */
  sigma_db?: number;
  seed?: number;
}

/** A rehearsed Wi-Fi or BLE radio. */
export class RehearsalRadio implements AnchorScanner {
  readonly intervalS: number;
  private readonly rng: Random;
  private readonly map: AnchorMap;
  private readonly anchors: RadioAnchor[];

  constructor(
    readonly source: 'wifi' | 'ble',
    anchorPack: AnchorPack,
    private readonly walk: Walk,
    intervalS: number,
    private readonly options: RehearsalOptions = {},
  ) {
    this.intervalS = intervalS;
    this.rng = new Random(options.seed ?? 1);
    this.map = new AnchorMap(anchorPack);
    this.anchors = Object.values(anchorPack.anchors ?? {}).filter(
      (anchor) => anchor.kind === (source === 'wifi' ? 'wifi_ap' : 'ble_beacon'),
    );
  }

  async availability(): Promise<ScannerAvailability> {
    if (!this.anchors.length) {
      return { usable: false, reason: `Rehearsal has no ${this.source === 'wifi' ? 'Wi-Fi' : 'Bluetooth'} anchors in this pack.` };
    }
    return { usable: true };
  }

  async scan(now: number): Promise<RadioObservation[]> {
    const options = this.options.sigma_db == null ? {} : { sigma_db: this.options.sigma_db };
    return simulateScan(this.map, this.anchors, this.walk.at(now), now, this.rng, options);
  }
}

/**
 * A rehearsed GNSS receiver.
 *
 * Noise is added in metres directly rather than through a path-loss model,
 * because that is how GNSS error behaves: a roughly circular scatter around the
 * truth whose radius depends on sky view, not on distance to anything. The
 * `accuracy_m` it reports is the sigma it actually used, which makes this the one
 * sensor in the system whose error bar is guaranteed honest — useful as the
 * control when the radio rungs are being judged.
 */
export class RehearsalGnss implements FixProvider {
  readonly source = 'gnss' as const;
  private readonly rng: Random;

  constructor(
    private readonly walk: Walk,
    readonly intervalS: number,
    private readonly sigmaM = 8,
    seed = 2,
  ) {
    this.rng = new Random(seed);
  }

  async availability(): Promise<ScannerAvailability> { return { usable: true }; }

  async fix(now: number): Promise<PositionFix | null> {
    const truth = this.walk.at(now);
    return {
      position: { x: truth.x + this.rng.gauss(0, this.sigmaM), y: truth.y + this.rng.gauss(0, this.sigmaM) },
      accuracy_m: this.sigmaM,
      source: 'gnss',
      timestamp: now,
      anchors_used: 0,
      residual_m: null,
      speed_ms: null,
      heading_deg: null,
    };
  }
}
