
import type { AnchorPack, CircuitPack, Position, PositionFix, RadioAnchor, RadioObservation } from '@crowdflow/contracts';
import { FREE_FLOW_SPEED_MS } from '@crowdflow/contracts';
import { simulateScan } from '@crowdflow/core/positioning';
import { Random } from '@crowdflow/core/random';
import type { AnchorScanner, FixProvider, ScannerAvailability } from './types';

export class Walk {
  readonly path: Position[];
  constructor(pack: CircuitPack, readonly startedAt: number, readonly speedMs = FREE_FLOW_SPEED_MS) {
    const zones = Object.values(pack.zones ?? {});
    this.path = zones.length > 1 ? zones.map((zone) => zone.position) : [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  }

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
  sigma_db?: number;
  seed?: number;
}

export class RehearsalRadio implements AnchorScanner {
  readonly intervalS: number;
  private readonly rng: Random;
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
    return simulateScan(this.anchors, this.walk.at(now), now, this.rng, options);
  }
}

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
