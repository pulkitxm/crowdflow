/**
 * The anchor map: which radios are where, and what to do about the ones that
 * are not in it.
 *
 * Everything in this file runs on a handset, which sets two constraints that
 * shaped it. There are no Node built-ins — no `node:crypto`, no `Buffer` — because
 * this module is imported by React Native through the `@crowdflow/core/positioning`
 * subpath and Metro would resolve them into a bundle that cannot start. And the
 * work is per-scan, several times a minute, in the background, on a battery
 * somebody wants to last a race weekend: a Map lookup per observation and
 * nothing more.
 *
 * The unmatched count is a first-class return value rather than a discarded
 * else-branch. A phone that hears twenty access points and recognises none of
 * them is not in a dead spot — it is somewhere the survey never walked, or the
 * venue re-cabled since. Those look identical from a fix ("no position") and
 * completely different from a coverage report ("the map is stale here"), and
 * only the unmatched count separates them.
 */

import type { AnchorKind, AnchorPack, RadioAnchor, RadioObservation } from '@crowdflow/contracts';
import { ASSUMED_ANCHOR_OBSERVATION_TTL_S } from '@crowdflow/contracts';
import { rangeFrom, type Range } from './pathloss.js';

/**
 * A stable digest of a hardware identifier.
 *
 * Two 32-bit FNV-1a passes with different offset bases, concatenated. Not a
 * cryptographic hash and not claimed as one: the MAC space is small enough that
 * any digest of a BSSID is reversible by brute force, and pretending otherwise
 * would be the kind of privacy theatre that gets believed. What it actually buys
 * is that a committed anchor pack is not a published inventory of a venue's
 * network hardware, and that identifiers are fixed-width and case-insensitive
 * so `AA:BB` and `aa-bb` are the same anchor.
 *
 * The real protection is architectural and lives elsewhere: anchor ids never
 * leave the handset (see `NodeReport`, which carries positions only).
 */
export function anchorIdFor(kind: AnchorKind, hardwareId: string): string {
  const normalised = `${kind}:${hardwareId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  return `${fnv1a(normalised, 0x811c9dc5)}${fnv1a(normalised, 0x01000193)}`;
}

function fnv1a(value: string, offset: number): string {
  let hash = offset >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    // The FNV prime, as shifts: Math.imul keeps this in 32-bit integer maths
    // instead of drifting into doubles, which is what makes the digest stable
    // across engines.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export interface ResolvedScan {
  ranges: Range[];
  /** heard, and in the map */
  matched: number;
  /** heard, and not in the map. See the note at the top of this file. */
  unmatched: number;
  /** dropped for being older than the TTL */
  stale: number;
}

export interface AnchorMapOptions {
  /** spread of a single RSSI reading, dB. A survey measures it; until then it is the conventional shadowing figure. */
  rssi_sigma_db?: number;
  observation_ttl_s?: number;
}

/**
 * An indexed anchor map.
 *
 * Constructed once per circuit and then read-only. It holds no scan state and
 * no clock: `resolve` is given `now` rather than reading one, so the same scan
 * resolves identically in a test, in the simulator and on a handset whose clock
 * is four minutes fast.
 */
export class AnchorMap {
  private readonly byId: Map<string, RadioAnchor>;
  readonly circuitId: string;
  readonly surveyedAt: string | null;
  readonly options: Required<AnchorMapOptions>;

  constructor(pack: AnchorPack, options: AnchorMapOptions = {}) {
    this.circuitId = pack.circuit_id;
    this.surveyedAt = pack.surveyed_at ?? null;
    this.byId = new Map(Object.entries(pack.anchors ?? {}).map(([id, anchor]) => [anchor.anchor_id || id, anchor]));
    this.options = {
      rssi_sigma_db: options.rssi_sigma_db ?? 6,
      observation_ttl_s: options.observation_ttl_s ?? ASSUMED_ANCHOR_OBSERVATION_TTL_S,
    };
  }

  get size(): number { return this.byId.size; }

  countOf(kind: AnchorKind): number {
    let count = 0;
    for (const anchor of this.byId.values()) if (anchor.kind === kind) count += 1;
    return count;
  }

  get(anchorId: string): RadioAnchor | null { return this.byId.get(anchorId) ?? null; }

  /**
   * Resolve a scan into ranges.
   *
   * Duplicates are collapsed to the STRONGEST reading per anchor, not the
   * newest. A dual-band AP answers on both radios and a scan list contains both;
   * averaging them would range a phone against a signal that no single antenna
   * ever sent, and taking the newest would pick by scan order, which is
   * arbitrary. The strongest reading is the one with the least shadowing between
   * it and the phone, which is the one the log-distance model describes best.
   */
  resolve(observations: RadioObservation[], now: number, kinds?: AnchorKind[]): ResolvedScan {
    const strongest = new Map<string, RadioObservation>();
    let unmatched = 0;
    let stale = 0;

    for (const observation of observations) {
      if (kinds && !kinds.includes(observation.kind)) continue;
      if (now - observation.timestamp > this.options.observation_ttl_s) { stale += 1; continue; }
      if (!this.byId.has(observation.anchor_id)) { unmatched += 1; continue; }
      const held = strongest.get(observation.anchor_id);
      if (!held || observation.rssi_dbm > held.rssi_dbm) strongest.set(observation.anchor_id, observation);
    }

    const ranges: Range[] = [];
    for (const observation of strongest.values()) {
      const anchor = this.byId.get(observation.anchor_id)!;
      ranges.push(rangeFrom(anchor, observation, this.options.rssi_sigma_db));
    }
    // Nearest first. The solver does not require an order, but a caller that
    // wants to cap the anchor count should be dropping the far ones, and this
    // makes the obvious slice the correct one.
    ranges.sort((a, b) => a.distance_m - b.distance_m);
    return { ranges, matched: ranges.length, unmatched, stale };
  }
}

/** An empty map, for a venue with no survey. Resolves nothing and says so —
 *  which lets the fusion ladder fall through to GNSS without a null check at
 *  every call site. */
export function emptyAnchorMap(circuitId: string): AnchorMap {
  return new AnchorMap({ circuit_id: circuitId, anchors: {} });
}
