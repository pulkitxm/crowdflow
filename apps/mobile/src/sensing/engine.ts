
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

const TICK_MS = 2000;

export interface SensingConfig {
  baseUrl: string;
  pack: CircuitPack;
  anchors: AnchorPack;
  mode?: 'device' | 'rehearsal';
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

  pseudonymExpiresIn(now = Date.now() / 1000): number {
    return Math.max(0, this.identity.expiresIn(now));
  }

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
      if (node) this.uplink.enqueue(node, resolved.fix.source);
    }

    if (this.uplink.due(now)) await this.uplink.flush(now, this.identity.nodeId, this.identity.epoch);
    this.emit();
  }

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
    return [new WifiSensor(), new BleSensor(), new GnssSensor(this.config.pack.frame)];
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }
}
