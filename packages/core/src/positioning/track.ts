/**
 * From a fused fix to the thing that gets uploaded — and to the pseudonym it
 * gets uploaded under.
 *
 * `CrowdNode` is a narrow contract and the narrowness is the point. A fix knows
 * which radio produced it, how many anchors it used and what the solve residual
 * was; a report carries none of that per sample. What leaves the handset is a
 * position, a speed, a heading, an accuracy and a rotating pseudonym: enough to
 * count a crowd and predict where it will jam, not enough to follow a person.
 *
 * The rotation is the other half. An identifier that lasts the whole day is a
 * trail whatever it is called, so it expires on a fixed schedule and the new one
 * is unrelated to the old. Two rules make that worth anything, and both are
 * enforced here rather than trusted to callers:
 *
 *   - The epoch boundary is a hard cut. Velocity, the fuser's history and the
 *     unsent queue are all dropped, because a sample that spans the boundary
 *     joins the two pseudonyms and undoes the rotation.
 *   - Epochs are never comparable. `epoch` travels beside `node_id` so a server
 *     can reject a join across them instead of relying on nobody trying.
 */

import type { CircuitPack, CrowdNode, PositionFix } from '@crowdflow/contracts';
import { ASSUMED_FIX_ACCURACY_FLOOR_M, ASSUMED_ID_ROTATION_S } from '@crowdflow/contracts';
import { insidePack } from './geo.js';

/** Source of the random bytes behind a pseudonym. Injected so a test is
 *  deterministic and a handset can supply the platform CSPRNG. */
export type RandomHex = (bytes: number) => string;

/**
 * The default generator, which is `Math.random` and says so.
 *
 * Not a CSPRNG. That is acceptable here for one reason and it is worth stating
 * rather than assuming: a `node_id` is not a credential and grants nothing — the
 * server accepts any id — so predicting one buys an attacker no access. What the
 * id must do is not collide, because two handsets sharing an id are merged into
 * one implausibly fast node and the state engine believes it. Sixteen bytes is
 * far past that. On a handset, pass `expo-crypto`'s generator anyway: it costs
 * nothing and removes the need for this paragraph to stay true.
 */
export const mathRandomHex: RandomHex = (bytes) => {
  let out = '';
  for (let index = 0; index < bytes; index++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return out;
};

/**
 * A rotating pseudonym with its epoch.
 *
 * The epoch is derived from the clock — `floor(now / rotation)` — rather than
 * counted from first use. Two phones that started the app an hour apart
 * therefore rotate at the same instants, which matters: staggered rotations
 * would let an observer link an old id to a new one by nothing more than the
 * moment the old one went quiet.
 */
export class NodeIdentity {
  private epochIndex: number;
  private id: string;

  constructor(now: number, readonly rotationS = ASSUMED_ID_ROTATION_S, private readonly randomHex: RandomHex = mathRandomHex) {
    if (!(rotationS > 0)) throw new Error('rotation period must be positive');
    this.epochIndex = Math.floor(now / rotationS);
    this.id = this.mint();
  }

  get epoch(): number { return this.epochIndex; }
  get nodeId(): string { return this.id; }

  /** Seconds until the pseudonym changes. Shown on the app's own status screen:
   *  "anonymous" is a claim, and a countdown is the evidence for it. */
  expiresIn(now: number): number {
    return (this.epochIndex + 1) * this.rotationS - now;
  }

  /**
   * Roll the pseudonym if the clock has crossed a boundary.
   *
   * Returns true when it rotated, and the caller MUST treat that as a reset:
   * drop the fuser's velocity history and discard anything queued but unsent.
   * A queue that survives a rotation is uploaded under the new id while
   * describing the old id's walk, which links them.
   */
  refresh(now: number): boolean {
    const index = Math.floor(now / this.rotationS);
    if (index === this.epochIndex) return false;
    this.epochIndex = index;
    this.id = this.mint();
    return true;
  }

  private mint(): string { return `nd-${this.randomHex(16)}`; }
}

/**
 * A fix, as a report.
 *
 * Returns null rather than a degraded node when the fix cannot honestly become
 * one — outside the venue, or with no usable accuracy. A caller that wants a dot
 * on a map badly enough to fabricate the fields it lacks is exactly what the
 * null is there to stop.
 *
 * `zone_id` is deliberately left unset. The contract says the state engine
 * assigns it, and it means it: a handset that nominated its own zone would be
 * asserting a venue geometry it may hold a stale copy of, and two phones
 * standing together could report different zones for the same spot.
 */
export function crowdNodeFrom(fix: PositionFix, identity: NodeIdentity, pack: CircuitPack): CrowdNode | null {
  if (!insidePack(pack, fix.position, 0)) return null;
  if (!(fix.accuracy_m > 0) || !Number.isFinite(fix.accuracy_m)) return null;
  return {
    node_id: identity.nodeId,
    epoch: identity.epoch,
    timestamp: Math.round(fix.timestamp),
    position: { x: roundToTenth(fix.position.x), y: roundToTenth(fix.position.y) },
    speed_ms: Math.max(0, roundToTenth(fix.speed_ms ?? 0)),
    heading_deg: fix.heading_deg == null ? 0 : normaliseDegrees(fix.heading_deg),
    accuracy_m: Math.max(ASSUMED_FIX_ACCURACY_FLOOR_M, roundToTenth(fix.accuracy_m)),
  };
}

/**
 * Decimetres, and no further.
 *
 * Not cosmetic. The best fix this system will ever see has a sigma of a few
 * metres, so the digits past the first decimal are noise — and noise that is
 * uploaded is noise that is stored, indexed, and eventually joined against
 * something. Rounding at the boundary is the cheapest data-minimisation there
 * is: the trailing digits of a coordinate are more identifying than the leading
 * ones, and they carry no information about where anybody is.
 */
function normaliseDegrees(value: number): number {
  const wrapped = ((value % 360) + 360) % 360;
  return roundToTenth(wrapped);
}

function roundToTenth(value: number): number { return Math.round(value * 10) / 10; }
