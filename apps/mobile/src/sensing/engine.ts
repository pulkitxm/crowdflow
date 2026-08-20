/**
 * The loop. Radios in, one position, one queued sample.
 *
 * Nothing in this file decides anything. The path-loss curve is in
 * `pathloss.ts`, the geometry in `solve.ts`, the arbitration between radios in
 * `fuse.ts`, the pseudonym in `track.ts`, the retry policy in `uplink.ts` — all
 * pure, all tested against a simulated walk. What is left here is scheduling and
 * plumbing, which is the part that cannot be unit-tested meaningfully because it
 * is made of timers and platform calls. Keeping that part thin is the whole
 * design: a bug in the ladder is found in milliseconds on a laptop, and a bug in
 * this file is found by looking at fifty lines.
 *
 * Cadence is per sensor and imposed by the platform, not chosen. Wi-Fi is
 * throttled to four scans per two minutes on Android; BLE is a continuous
 * subscription drained on a short window; GNSS is a watch the OS paces itself.
 * A single interval for all three would mean either hammering the Wi-Fi throttle
 * into returning stale results, or sampling GNSS once every thirty seconds for
 * no reason.
 *
 * The engine reports its own state through `SensingStatus`, which is a CONTRACT
 * type rather than app state. The app must be able to answer "what are you doing
 * with my phone right now" in the same words the console uses; a status screen
 * that paraphrases is a status screen that drifts from the truth.
 */

import type {
  AnchorPack, CircuitPack, PositionFix, PositionSource, SensingStatus,
} from '@crowdflow/contracts';
import { ASSUMED_MIN_ANCHORS_FOR_FIX } from '@crowdflow/contracts';
import {
  AnchorMap, NodeIdentity, PositionFuser, crowdNodeFrom, fixFrom, trilaterate,
} from '@crowdflow/core/positioning';
import * as Crypto from 'expo-crypto';
import { BleSensor } from './ble';
import { GnssSensor } from './gnss';
import { RehearsalGnss, RehearsalRadio, Walk } from './rehearsal';
import { Uplink } from './uplink';
import { WifiSensor } from './wifi';
import { isAnchorScanner, isFixProvider, type AnchorScanner, type FixProvider, type Sensor } from './types';

/** How often the loop wakes. Sensors are sampled on their own intervals; this is
 *  only the granularity at which those intervals are checked. */
const TICK_MS = 2000;

export interface SensingConfig {
  baseUrl: string;
  pack: CircuitPack;
  anchors: AnchorPack;
  /**
   * `device` uses the real radios. `rehearsal` swaps them for the simulator in
   * `rehearsal.ts` and changes nothing else — same solve, same ladder, same
   * uplink, same server. It is how this is tested without a circuit.
   */
  mode?: 'device' | 'rehearsal';
  /** shadowing spread for rehearsal mode */
  sigma_db?: number;
  seed?: number;
}

export type StatusListener = (status: SensingStatus) => void;

export class SensingEngine {
  private sensors: Sensor[] = [];
  private lastSampled = new Map<PositionSource, number>();
  private available: PositionSource[] = [];
  private blockedBy: string[] = [];
  private fuser: PositionFuser;
  private identity: NodeIdentity;
  private uplink: Uplink;
  private map: AnchorMap;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<StatusListener>();
  private lastFix: PositionFix | null = null;
  private stopped: string | null = null;

  constructor(private readonly config: SensingConfig) {
    this.map = new AnchorMap(config.anchors);
    this.fuser = new PositionFuser(config.pack.frame);
    // The platform CSPRNG for the pseudonym. `Math.random` would do for
    // collision resistance, which is all a pseudonym needs, but this costs
    // nothing and removes the question.
    this.identity = new NodeIdentity(Date.now() / 1000, undefined, (bytes) =>
      [...Crypto.getRandomBytes(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
    this.uplink = new Uplink({
      baseUrl: config.baseUrl,
      circuitId: config.pack.id,
      onStop: (reason) => { this.stopped = reason; void this.stop(); },
      onResult: () => this.emit(),
    });
    this.sensors = this.build();
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status());
    return () => this.listeners.delete(listener);
  }

  /**
   * Seconds until the pseudonym changes.
   *
   * Surfaced for the app's own status screen. "Anonymous" is a claim, and a
   * countdown a person can watch is the only evidence for it an app can offer
   * without asking to be believed.
   */
  pseudonymExpiresIn(now = Date.now() / 1000): number {
    return Math.max(0, this.identity.expiresIn(now));
  }

  /** How much of the anchor map this venue actually has, for the status screen.
   *  A surveyed_at of null means the positions are planned, not walked. */
  get survey(): { anchors: number; wifi: number; ble: number; surveyedAt: string | null } {
    return {
      anchors: this.map.size,
      wifi: this.map.countOf('wifi_ap'),
      ble: this.map.countOf('ble_beacon'),
      surveyedAt: this.map.surveyedAt,
    };
  }

  status(): SensingStatus {
    return {
      active: this.timer != null,
      available: this.available,
      using: this.fuser.using,
      last_fix: this.lastFix,
      queued: this.uplink.depth,
      blocked_by: this.stopped ? [this.stopped, ...this.blockedBy] : this.blockedBy,
    };
  }

  /**
   * Start sensing.
   *
   * Availability is asked once here rather than on every tick: a person who
   * switches Bluetooth off mid-event is handled by that sensor returning nothing,
   * which the ladder already treats as a source that has gone quiet. Re-polling
   * three platform permission APIs every two seconds would cost more than it
   * tells us.
   */
  async start(): Promise<void> {
    if (this.timer) return;
    this.stopped = null;
    const available: PositionSource[] = [];
    const blocked: string[] = [];
    for (const sensor of this.sensors) {
      const availability = await sensor.availability();
      if (!availability.usable) {
        if (availability.reason) blocked.push(availability.reason);
        continue;
      }
      await sensor.start?.();
      available.push(sensor.source);
    }
    this.available = available;
    this.blockedBy = blocked;
    if (!available.length) { this.emit(); return; }
    this.timer = setInterval(() => void this.tick(Date.now() / 1000), TICK_MS);
    this.emit();
  }

  /**
   * Stop, and leave nothing running.
   *
   * The fuser is reset rather than merely paused. Resuming with a stale velocity
   * would dead-reckon a phone forward from wherever it was when sensing stopped,
   * which after a lunch break is a position in the wrong zone reported with
   * confidence.
   */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const sensor of this.sensors) await sensor.stop?.();
    this.fuser.reset();
    this.uplink.clear();
    this.lastFix = null;
    this.available = [];
    this.emit();
  }

  private async tick(now: number): Promise<void> {
    // The pseudonym first: everything after this must belong to one epoch.
    if (this.identity.refresh(now)) {
      this.fuser.reset();
      this.uplink.clear();
      this.lastFix = null;
    }

    for (const sensor of this.sensors) {
      if (!this.available.includes(sensor.source)) continue;
      const last = this.lastSampled.get(sensor.source) ?? 0;
      if (now - last < sensor.intervalS) continue;
      this.lastSampled.set(sensor.source, now);
      if (isAnchorScanner(sensor)) await this.sampleRadio(sensor, now);
      else if (isFixProvider(sensor)) await this.sampleFix(sensor, now);
    }

    const resolved = this.fuser.resolve(now);
    if (resolved.fix) {
      this.lastFix = resolved.fix;
      const node = crowdNodeFrom(resolved.fix, this.identity, this.config.pack);
      // Null means the fix cannot honestly become a report — outside the venue,
      // most often, which is the disclosure's promise being kept.
      if (node) this.uplink.enqueue(node, resolved.fix.source);
    }

    if (this.uplink.due(now)) await this.uplink.flush(now, this.identity.nodeId, this.identity.epoch);
    this.emit();
  }

  /**
   * One radio scan, solved on the handset.
   *
   * The observations do not leave this method. That is the privacy architecture,
   * not a courtesy: a list of the access points and beacons around somebody is a
   * location, and a far more identifying one than a coordinate — it names the
   * hardware in the room. `NodeReport` has nowhere to put it.
   */
  private async sampleRadio(sensor: AnchorScanner, now: number): Promise<void> {
    const observations = await sensor.scan(now).catch(() => []);
    if (!observations.length) return;
    const kinds = sensor.source === 'wifi' ? (['wifi_ap'] as const) : (['ble_beacon'] as const);
    const resolved = this.map.resolve(observations, now, [...kinds]);
    if (resolved.matched < ASSUMED_MIN_ANCHORS_FOR_FIX) return;
    const solution = trilaterate(resolved.ranges);
    this.fuser.offer(fixFrom(solution, sensor.source, now));
  }

  private async sampleFix(sensor: FixProvider, now: number): Promise<void> {
    const fix = await sensor.fix(now).catch(() => null);
    if (fix) this.fuser.offer(fix);
  }

  private build(): Sensor[] {
    if (this.config.mode === 'rehearsal') {
      const walk = new Walk(this.config.pack, Date.now() / 1000);
      const options = {
        ...(this.config.sigma_db == null ? {} : { sigma_db: this.config.sigma_db }),
        ...(this.config.seed == null ? {} : { seed: this.config.seed }),
      };
      return [
        new RehearsalRadio('wifi', this.config.anchors, walk, 30, options),
        new RehearsalRadio('ble', this.config.anchors, walk, 4, options),
        new RehearsalGnss(walk, 10),
      ];
    }
    // Order is presentation only — the ladder arbitrates on measured accuracy,
    // not on this list. It decides which reason appears first on the status
    // screen when a rung is unavailable.
    return [new WifiSensor(), new BleSensor(), new GnssSensor(this.config.pack.frame)];
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }
}
