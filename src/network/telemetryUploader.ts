import type { ConnectivityState, NodeTelemetry } from '../core/contracts';
import { TypedEvent } from '../core/events';
import { encodeTelemetryBatch } from '../protocol/telemetry';
import { OutageBuffer } from '../storage/outageBuffer';
import type { SettingsStore } from '../storage/settings';

export interface UploadStats { successes: number; failures: number; buffered: number }

export class TelemetryUploader {
  readonly connectivityChanged = new TypedEvent<ConnectivityState>();
  readonly statsChanged = new TypedEvent<UploadStats>();
  private readonly buffer = new OutageBuffer();
  private readonly pending = new Map<string, NodeTelemetry>();
  private timer?: ReturnType<typeof setInterval>;
  private uploading = false;
  private wasOffline = false;
  private stats: UploadStats = { successes: 0, failures: 0, buffered: 0 };

  constructor(private readonly settings: SettingsStore) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), 1_000);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  offer(value: NodeTelemetry): void { this.pending.set(value.node_id, value); }
  snapshot(): UploadStats { return { ...this.stats }; }

  private async flush(): Promise<void> {
    if (this.uploading) return; this.uploading = true;
    try {
      for (let index = 0; index < 5; index += 1) {
        const entry = this.buffer.peek(); if (!entry) break;
        if (!(await this.post(entry.body))) return;
        this.buffer.removeFirst(); this.updateStats({ buffered: this.buffer.size() });
      }
      const batch = [...this.pending.values()]; this.pending.clear();
      if (batch.length === 0) return;
      const body = encodeTelemetryBatch(batch);
      if (!(await this.post(body))) {
        this.buffer.add(body); this.updateStats({ buffered: this.buffer.size() });
      }
    } finally { this.uploading = false; }
  }

  private async post(body: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.settings.backendUrl}/ingest/telemetry`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CrowdFlow-Source': 'expo-mesh' }, body,
      });
      if (!response.ok) throw new Error(`backend returned ${response.status}`);
      this.updateStats({ successes: this.stats.successes + 1 });
      this.connectivityChanged.emit(this.wasOffline ? 'restored' : 'online'); this.wasOffline = false;
      return true;
    } catch {
      this.updateStats({ failures: this.stats.failures + 1 });
      this.wasOffline = true; this.connectivityChanged.emit('local-only'); return false;
    }
  }

  private updateStats(update: Partial<UploadStats>): void {
    this.stats = { ...this.stats, ...update }; this.statsChanged.emit(this.snapshot());
  }
}
