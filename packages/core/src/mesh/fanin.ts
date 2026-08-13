import type { MeshClass, MeshMessage } from '@crowdflow/contracts';
import { ASSUMED_SKEW_WINDOW_S } from '@crowdflow/contracts';
import type { MessageKey } from './policy.js';

export interface Delivery { key: MessageKey; traffic_class: MeshClass; message: MeshMessage; uplink_id: string; hops: number; origin_timestamp: number; delivered_at: number }
export interface UplinkReport { uplink_id: string; sent_at: number; deliveries: Delivery[] }
export interface Observation { key: MessageKey; message: MeshMessage; origin_timestamp: number; hops: number; via: string; received_at: number; reported_by: Set<string> }
export function observationAge(observation: Observation, now: number): number { return now - observation.origin_timestamp; }

export class ClockSkew {
  private samples = new Map<string, Array<[number, number]>>();
  constructor(readonly windowS = ASSUMED_SKEW_WINDOW_S) {}
  observe(uplinkId: string, sentAt: number, receivedAt: number): number { const values = this.samples.get(uplinkId) ?? []; values.push([receivedAt, receivedAt - sentAt]); this.samples.set(uplinkId, values.filter(([at]) => receivedAt - at <= this.windowS)); return this.offset(uplinkId); }
  offset(uplinkId: string): number { const values = this.samples.get(uplinkId) ?? []; return values.length ? Math.min(...values.map(([, delta]) => delta)) : 0; }
  correct(uplinkId: string, remoteTime: number): number { return remoteTime + this.offset(uplinkId); }
}

export class FanIn {
  readonly skew: ClockSkew; readonly observations = new Map<MessageKey, Observation>(); duplicates = 0; reports = 0; private receiptAges: number[] = [];
  constructor(skewWindowS = ASSUMED_SKEW_WINDOW_S) { this.skew = new ClockSkew(skewWindowS); }
  receive(report: UplinkReport, receivedAt: number): Observation[] {
    this.reports += 1; this.skew.observe(report.uplink_id, report.sent_at, receivedAt); const fresh: Observation[] = [];
    for (const delivery of report.deliveries) { const existing = this.observations.get(delivery.key); if (existing) { existing.reported_by.add(report.uplink_id); this.duplicates += 1; continue; } const observation: Observation = { key: delivery.key, message: delivery.message, origin_timestamp: this.skew.correct(report.uplink_id, delivery.origin_timestamp), hops: delivery.hops, via: report.uplink_id, received_at: receivedAt, reported_by: new Set([report.uplink_id]) }; this.observations.set(delivery.key, observation); this.receiptAges.push(observationAge(observation, receivedAt)); fresh.push(observation); }
    return fresh;
  }
  ages(now: number): number[] { return [...this.observations.values()].map((value) => observationAge(value, now)); }
  get mean_age_at_receipt_s(): number { return mean(this.receiptAges); }
  get p95_age_at_receipt_s(): number { if (!this.receiptAges.length) return 0; const sorted = this.receiptAges.slice().sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.trunc(0.95 * sorted.length))]!; }
  get redundancy(): number { return this.observations.size ? [...this.observations.values()].reduce((sum, value) => sum + value.reported_by.size, 0) / this.observations.size : 0; }
}
function mean(values: number[]): number { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
