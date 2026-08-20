/**
 * The ladder: several radios offer a position, one answer comes out.
 *
 * Wi-Fi, BLE and GNSS all produce a `PositionFix` and they disagree constantly.
 * Selecting between them is not a preference order — it is measured accuracy
 * with three corrections applied, and each correction exists because the naive
 * version has a specific failure that shows up on a console:
 *
 *   HYSTERESIS      Two sources of similar quality trade the lead every tick,
 *                   and the position jumps between two answers that are each
 *                   defensible. On a map that is a person vibrating in place.
 *                   A challenger must be materially better, not marginally.
 *
 *   A CEILING       A fix with a sixty-metre sigma is not a position, it is a
 *                   zone name with extra steps. It is rejected rather than
 *                   reported wide, because the state engine will assign it to
 *                   whichever zone the centre lands in and then count a person
 *                   who might be in any of four.
 *
 *   DEAD RECKONING  Android throttles Wi-Fi scans to four per two minutes, so a
 *                   Wi-Fi-only phone has thirty-second holes by design. Carrying
 *                   the last velocity across the hole is better than going
 *                   silent, and it is bounded because it is extrapolation:
 *                   given long enough it will walk a phone through a wall.
 *
 * And one thing that is not a correction but a promise. The disclosure screen
 * tells people the trail stops when they leave the circuit. `insideVenue` is
 * where that sentence is enforced, on every fix, before anything else looks at
 * it — not as a filter somewhere upstream that a later refactor could route
 * around.
 */

import type { CoordinateFrame, Position, PositionFix, PositionSource } from '@crowdflow/contracts';
import {
  ASSUMED_DEAD_RECKONING_MAX_S,
  ASSUMED_FIX_ACCURACY_CEILING_M,
  ASSUMED_FIX_STALE_S,
  ASSUMED_HEADING_SPEED_FLOOR_MS,
  ASSUMED_SOURCE_SWITCH_HYSTERESIS,
  ASSUMED_VELOCITY_SMOOTHING,
  FREE_FLOW_SPEED_MS,
} from '@crowdflow/contracts';
import { distanceM, insideVenue } from './geo.js';

/** Why a candidate fix was not used. Words a support screen can show, and a
 *  reason a developer can act on — never a bare rejection. */
export type RejectReason = 'too_wide' | 'stale' | 'outside_venue' | 'not_better' | 'implausible_jump';

export interface FuseOptions {
  accuracy_ceiling_m?: number;
  stale_s?: number;
  hysteresis?: number;
  dead_reckoning_max_s?: number;
  /** Slack on the venue bounding box, so someone standing on the boundary does
   *  not flicker in and out as their accuracy breathes. */
  venue_margin_m?: number;
  /** Fastest a walking crowd plausibly moves, for the jump test. Spectators in
   *  a car park are in vehicles, so this is generous rather than tight. */
  max_speed_ms?: number;
}

export interface FuseResult {
  fix: PositionFix | null;
  /** what was rejected and why, this call */
  rejected: { source: PositionSource; reason: RejectReason }[];
}

/**
 * One handset's position, fused.
 *
 * Holds no clock and no timer: `offer` and `resolve` both take `now`. That is
 * what makes a thirty-minute walk testable in a millisecond, and it is the same
 * discipline the rest of the engines follow.
 */
export class PositionFuser {
  private candidates = new Map<PositionSource, PositionFix>();
  private accepted: PositionFix | null = null;
  private velocity: { vx: number; vy: number } | null = null;
  readonly options: Required<FuseOptions>;

  constructor(readonly frame: CoordinateFrame, options: FuseOptions = {}) {
    this.options = {
      accuracy_ceiling_m: options.accuracy_ceiling_m ?? ASSUMED_FIX_ACCURACY_CEILING_M,
      stale_s: options.stale_s ?? ASSUMED_FIX_STALE_S,
      hysteresis: options.hysteresis ?? ASSUMED_SOURCE_SWITCH_HYSTERESIS,
      dead_reckoning_max_s: options.dead_reckoning_max_s ?? ASSUMED_DEAD_RECKONING_MAX_S,
      venue_margin_m: options.venue_margin_m ?? 50,
      // Four times free-flow walking speed: a shuttle bus, not a sprint.
      max_speed_ms: options.max_speed_ms ?? FREE_FLOW_SPEED_MS * 4,
    };
  }

  /** The most recent fix this fuser stood behind. */
  get last(): PositionFix | null { return this.accepted; }

  /** Which source is currently leading, for a status screen. */
  get using(): PositionSource | null { return this.accepted?.source ?? null; }

  /** Drop everything. Called when consent is withdrawn and when the pseudonym
   *  rotates — an epoch boundary that carried velocity across it would link the
   *  two epochs, which is the one thing the rotation exists to prevent. */
  reset(): void {
    this.candidates.clear();
    this.accepted = null;
    this.velocity = null;
  }

  /** Offer a fix from one radio. Latest per source wins; the ladder decides
   *  between sources in `resolve`. */
  offer(fix: PositionFix): void {
    const held = this.candidates.get(fix.source);
    if (held && held.timestamp > fix.timestamp) return;
    this.candidates.set(fix.source, fix);
  }

  /**
   * The answer, or nothing.
   *
   * Nothing is a legitimate outcome and callers must handle it: a phone under a
   * grandstand with no anchor map and no sky genuinely does not know where it
   * is, and a system that invents a position there will report a crowd in the
   * wrong place.
   */
  resolve(now: number): FuseResult {
    const rejected: { source: PositionSource; reason: RejectReason }[] = [];
    const usable: PositionFix[] = [];

    for (const [source, fix] of this.candidates) {
      if (now - fix.timestamp > this.options.stale_s) { rejected.push({ source, reason: 'stale' }); continue; }
      // Positions only move forward in time. Without this, the source that lost
      // last tick is still sitting in the map and wins the next one unopposed,
      // moving the node back to where it was ten seconds ago.
      if (this.accepted && fix.timestamp <= this.accepted.timestamp) { rejected.push({ source, reason: 'stale' }); continue; }
      if (fix.accuracy_m > this.options.accuracy_ceiling_m) { rejected.push({ source, reason: 'too_wide' }); continue; }
      if (!insideVenue(this.frame, fix.position, this.options.venue_margin_m)) {
        rejected.push({ source, reason: 'outside_venue' });
        continue;
      }
      if (this.isJump(fix)) { rejected.push({ source, reason: 'implausible_jump' }); continue; }
      usable.push(fix);
    }

    // Selection in three named steps rather than a running comparison. The
    // running version is order-dependent — whichever source happened to be
    // first in the map became the thing hysteresis protected, so the ladder's
    // behaviour depended on the sequence radios woke up in.
    const leading = this.accepted?.source ?? null;
    const incumbent = usable.find((fix) => fix.source === leading) ?? null;
    const challenger = usable
      .filter((fix) => fix.source !== leading)
      .reduce<PositionFix | null>((tightest, fix) => (!tightest || fix.accuracy_m < tightest.accuracy_m ? fix : tightest), null);

    let best: PositionFix | null;
    if (!incumbent) {
      // Nothing from the source in the lead this tick, so there is nothing to
      // protect: the tightest live fix wins outright.
      best = challenger;
    } else if (challenger && challenger.accuracy_m * this.options.hysteresis < incumbent.accuracy_m) {
      best = challenger;
      rejected.push({ source: incumbent.source, reason: 'not_better' });
    } else {
      best = incumbent;
      if (challenger) rejected.push({ source: challenger.source, reason: 'not_better' });
    }
    for (const fix of usable) {
      if (fix !== best && fix !== incumbent && fix !== challenger) rejected.push({ source: fix.source, reason: 'not_better' });
    }

    if (best) {
      // Consumed. A fix describes one moment; re-serving it on the next tick
      // would report a phone as freshly located when nothing new has been heard
      // from it, and would suppress the dead reckoning that exists to cover
      // exactly that gap.
      this.candidates.delete(best.source);
      return { fix: this.accept(best), rejected };
    }
    const reckoned = this.deadReckon(now);
    return { fix: reckoned, rejected };
  }

  /**
   * Is this fix somewhere a walking person could not have reached?
   *
   * The test is against the accepted position and allows for both fixes' error
   * bars, because two fixes that are each uncertain to twenty metres can differ
   * by forty without anybody having moved. Without the error term this rejects
   * every legitimate source switch; without the test at all, one wild
   * multipath reading teleports a dot across the paddock and the operator sees
   * a crowd appear where there is nobody.
   */
  private isJump(fix: PositionFix): boolean {
    const previous = this.accepted;
    if (!previous) return false;
    const elapsed = fix.timestamp - previous.timestamp;
    if (elapsed <= 0) return false;
    const slack = previous.accuracy_m + fix.accuracy_m;
    return distanceM(previous.position, fix.position) > this.options.max_speed_ms * elapsed + slack;
  }

  /**
   * Accept a fix and attach velocity to it.
   *
   * Velocity comes from displacement between accepted fixes, smoothed. It is not
   * taken from the platform's own speed field even where one exists, because
   * that field is GNSS Doppler and there is no equivalent from a Wi-Fi solve —
   * a speed that changes meaning when the radio changes would make the density
   * engine's mean-speed figure a comparison between two different quantities.
   *
   * Heading is null below the speed floor. The heading of a stationary phone is
   * noise, and `dominant_heading_deg` averaged over a crowd of stationary
   * phones is noise pointing somewhere with great authority.
   */
  private accept(fix: PositionFix): PositionFix {
    const previous = this.accepted;
    let speed: number | null = null;
    let heading: number | null = null;

    if (previous) {
      const elapsed = fix.timestamp - previous.timestamp;
      if (elapsed > 0) {
        const vx = (fix.position.x - previous.position.x) / elapsed;
        const vy = (fix.position.y - previous.position.y) / elapsed;
        const alpha = ASSUMED_VELOCITY_SMOOTHING;
        this.velocity = this.velocity
          ? { vx: alpha * vx + (1 - alpha) * this.velocity.vx, vy: alpha * vy + (1 - alpha) * this.velocity.vy }
          : { vx, vy };
        speed = Math.hypot(this.velocity.vx, this.velocity.vy);
        if (speed >= ASSUMED_HEADING_SPEED_FLOOR_MS) heading = bearingOf(this.velocity.vx, this.velocity.vy);
        else speed = 0;
      }
    }

    this.accepted = { ...fix, speed_ms: speed, heading_deg: heading };
    return this.accepted;
  }

  /**
   * Carry the last position forward on its last velocity.
   *
   * The accuracy grows by the distance travelled, which is the honest bound: an
   * extrapolation is wrong by however far it guessed. Beyond
   * `dead_reckoning_max_s` it stops rather than degrading gracefully, because a
   * gracefully degrading dead-reckoned dot is indistinguishable on a map from a
   * real one and will be counted as a person.
   */
  private deadReckon(now: number): PositionFix | null {
    const previous = this.accepted;
    if (!previous || !this.velocity) return null;
    const elapsed = now - previous.timestamp;
    if (elapsed <= 0) return previous;
    if (elapsed > this.options.dead_reckoning_max_s) return null;
    const speed = Math.hypot(this.velocity.vx, this.velocity.vy);
    const position: Position = {
      x: previous.position.x + this.velocity.vx * elapsed,
      y: previous.position.y + this.velocity.vy * elapsed,
    };
    if (!insideVenue(this.frame, position, this.options.venue_margin_m)) return null;
    return {
      position,
      accuracy_m: previous.accuracy_m + speed * elapsed,
      source: 'dead_reckoning',
      timestamp: now,
      anchors_used: 0,
      residual_m: null,
      speed_ms: speed,
      heading_deg: speed >= ASSUMED_HEADING_SPEED_FLOOR_MS ? bearingOf(this.velocity.vx, this.velocity.vy) : null,
    };
  }
}

/**
 * A venue-frame velocity as a bearing in [0, 360).
 *
 * Clockwise from the frame's +y axis, which is venue north. `atan2(x, y)` rather
 * than the usual `atan2(y, x)`: compass bearings are measured from north
 * clockwise, mathematical angles from east anticlockwise, and swapping the
 * arguments is the whole conversion.
 */
export function bearingOf(vx: number, vy: number): number {
  const degrees = (Math.atan2(vx, vy) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}
