import { createHash, createHmac } from 'node:crypto';
import {
  ASSUMED_PRIVATE_SKETCH_EPSILON,
  ASSUMED_PRIVATE_SKETCH_K,
  CAPTURE_RECAPTURE_MIN_OVERLAP,
  CAPTURE_RECAPTURE_MIN_SAMPLE,
} from '@crowdflow/contracts';

const HASH_SPACE = 2 ** 64;
export interface PrivateCountConfig { k: number; epsilon: number }
export const DEFAULT_PRIVATE_COUNT_CONFIG = { k: ASSUMED_PRIVATE_SKETCH_K, epsilon: ASSUMED_PRIVATE_SKETCH_EPSILON };

export class PrivateBottomK {
  private values = new Set<bigint>();
  private phantomHashes = new Set<bigint>();
  private readonly keyId: string;
  readonly config: PrivateCountConfig;

  private constructor(readonly epoch: string, secret: Uint8Array, config: Partial<PrivateCountConfig>) {
    this.config = { ...DEFAULT_PRIVATE_COUNT_CONFIG, ...config };
    if (this.config.k < CAPTURE_RECAPTURE_MIN_SAMPLE) throw new Error('k must retain at least two hashes');
    if (this.config.epsilon <= 0) throw new Error('epsilon must be positive');
    this.keyId = fingerprint(secret);
  }

  static create(secret: Uint8Array, epoch: string, config: Partial<PrivateCountConfig> = {}): PrivateBottomK {
    if (!secret.length) throw new Error('a non-empty per-epoch sketch secret is required');
    const sketch = new PrivateBottomK(epoch, secret, config);
    for (let index = 0; index < sketch.phantomCount; index++) {
      const hash = sketch.addIdentifier(secret, `crowdflow-private-count-phantom:${epoch}:${index}`, true);
      if (hash != null) sketch.phantomHashes.add(hash);
    }
    return sketch;
  }

  get sampleProbability(): number { return 1 - Math.exp(-this.config.epsilon); }
  get phantomCount(): number { return Math.ceil(this.config.k / this.sampleProbability); }
  get hashes(): bigint[] { return [...this.values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0); }

  add(secret: Uint8Array, identifier: string | Uint8Array): void {
    if (fingerprint(secret) !== this.keyId) throw new Error('secret does not belong to this sketch epoch');
    this.addIdentifier(secret, identifier, false);
  }

  merge(other: PrivateBottomK): PrivateBottomK {
    if (this.epoch !== other.epoch || this.keyId !== other.keyId || this.config.k !== other.config.k || this.config.epsilon !== other.config.epsilon) throw new Error('private sketches from different epochs/configs cannot merge');
    const merged = Object.create(PrivateBottomK.prototype) as PrivateBottomK;
    Object.assign(merged, { epoch: this.epoch, config: { ...this.config }, keyId: this.keyId, values: new Set<bigint>(), phantomHashes: new Set([...this.phantomHashes, ...other.phantomHashes]) });
    for (const value of new Set([...this.values, ...other.values])) merged.addHash(value);
    return merged;
  }

  get estimate(): number {
    const sampled = this.values.size < this.config.k
      ? this.values.size
      : (this.config.k - 1) / (Number(this.hashes.at(-1)!) / HASH_SPACE);
    return Math.max(0, sampled / this.sampleProbability - this.phantomCount);
  }

  intersectionEstimate(other: PrivateBottomK): number {
    const merged = this.merge(other);
    if (!this.values.size || !other.values.size) return 0;
    const threshold = this.hashes.at(-1)! < other.hashes.at(-1)! ? this.hashes.at(-1)! : other.hashes.at(-1)!;
    const phantoms = new Set([...this.phantomHashes, ...other.phantomHashes]);
    const left = new Set([...this.values].filter((value) => value <= threshold && !phantoms.has(value)));
    const right = new Set([...other.values].filter((value) => value <= threshold && !phantoms.has(value)));
    const union = new Set([...left, ...right]);
    if (!union.size) return 0;
    const overlap = [...left].filter((value) => right.has(value)).length;
    return overlap / union.size * merged.estimate;
  }

  private addIdentifier(secret: Uint8Array, value: string | Uint8Array, phantom: boolean): bigint | null {
    const domain = phantom ? 'phantom' : 'real';
    const sampling = hash64(secret, `sample-${domain}`, value);
    if (Number(sampling) / HASH_SPACE >= this.sampleProbability) return null;
    const ranked = hash64(secret, `rank-${domain}`, value);
    this.addHash(ranked); return ranked;
  }

  private addHash(value: bigint): void {
    if (this.values.has(value)) return;
    this.values.add(value);
    if (this.values.size > this.config.k) this.values.delete(this.hashes.at(-1)!);
  }
}

export interface ParticipationEstimate {
  population: number; participation_rate: number; first_capture: number;
  second_capture: number; overlap: number; app_nodes: number; method: string;
}
export function estimateParticipation(first: PrivateBottomK, second: PrivateBottomK, appNodes: PrivateBottomK | number): ParticipationEstimate | null {
  const n1 = first.estimate; const n2 = second.estimate; const overlap = first.intersectionEstimate(second);
  if (n1 < CAPTURE_RECAPTURE_MIN_SAMPLE || n2 < CAPTURE_RECAPTURE_MIN_SAMPLE || overlap < CAPTURE_RECAPTURE_MIN_OVERLAP) return null;
  const population = (n1 + 1) * (n2 + 1) / (overlap + 1) - 1;
  const app = typeof appNodes === 'number' ? appNodes : appNodes.estimate;
  if (population <= 0 || app < 0) return null;
  return { population, participation_rate: Math.min(1, app / population), first_capture: n1, second_capture: n2, overlap, app_nodes: app, method: 'chapman-capture-recapture/private-bottom-k' };
}

function fingerprint(secret: Uint8Array): string { return createHash('sha256').update(secret).digest('hex').slice(0, 16); }
function hash64(secret: Uint8Array, purpose: string, value: string | Uint8Array): bigint {
  const digest = createHmac('sha256', secret).update(purpose).update('\0').update(value).digest();
  return digest.readBigUInt64BE(0);
}
