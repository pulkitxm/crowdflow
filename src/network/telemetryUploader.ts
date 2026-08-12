import type { ConnectivityState, NodeTelemetry } from '../core/contracts';
import { TypedEvent } from '../core/events';
import { encodeTelemetryBatch } from '../protocol/telemetry';
import { OutageBuffer, type BufferedBatch } from '../storage/outageBuffer';
import type { SettingsStore } from '../storage/settings';

export interface UploadStats { successes: number; failures: number; buffered: number }

export interface TelemetryOutbox {
  add(body: string): void;
  peek(): BufferedBatch | undefined;
  removeFirst(): void;
  size(): number;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>;

export class TelemetryUploader {
  readonly connectivityChanged = new TypedEvent<ConnectivityState>();
  readonly statsChanged = new TypedEvent<UploadStats>();
  private timer?: ReturnType<typeof setInterval>;
  private restoreTimer?: ReturnType<typeof setTimeout>;
  private activeRequest?: AbortController;
  private uploading = false;
  private running = false;
  private wasOffline = false;
  private connectivity?: ConnectivityState;
  private readonly pending = new Map<string, NodeTelemetry>();
  private stats: UploadStats = { successes: 0, failures: 0, buffered: 0 };

  constructor(
    private readonly settings: SettingsStore,
    private readonly buffer: TelemetryOutbox = new OutageBuffer(),
    private readonly fetcher: FetchLike = fetch,
    private readonly requestTimeoutMs = 5_000,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const buffered = this.buffer.size();
    this.wasOffline ||= buffered > 0;
    this.updateStats({ buffered });
    void this.flush();
    this.timer = setInterval(() => void this.flush(), 1_000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.timer = undefined; this.restoreTimer = undefined;
    this.activeRequest?.abort(); this.activeRequest = undefined;
    this.connectivity = undefined;
  }

  offer(value: NodeTelemetry): void { this.pending.set(value.node_id, value); }
  snapshot(): UploadStats { return { ...this.stats }; }
  async flushNow(): Promise<void> { await this.flush(); }

  private async flush(): Promise<void> {
    if (!this.running || this.uploading) return;
    this.uploading = true;
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
    const controller = new AbortController();
    this.activeRequest = controller;
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetcher(`${this.settings.backendUrl}/ingest/telemetry`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CrowdFlow-Source': 'expo-mesh' },
        body, signal: controller.signal,
      });
      if (!response.ok) throw new Error(`backend returned ${response.status}`);
      this.updateStats({ successes: this.stats.successes + 1 });
      this.reportSuccess();
      return true;
    } catch {
      if (!this.running && controller.signal.aborted) return false;
      this.updateStats({ failures: this.stats.failures + 1 });
      this.wasOffline = true;
      if (this.restoreTimer) clearTimeout(this.restoreTimer);
      this.restoreTimer = undefined;
      this.emitConnectivity('local-only');
      return false;
    } finally {
      clearTimeout(timeout);
      if (this.activeRequest === controller) this.activeRequest = undefined;
    }
  }

  private reportSuccess(): void {
    if (this.wasOffline) {
      this.wasOffline = false;
      this.emitConnectivity('restored');
      if (this.restoreTimer) clearTimeout(this.restoreTimer);
      this.restoreTimer = setTimeout(() => {
        this.restoreTimer = undefined;
        if (this.running && !this.wasOffline) this.emitConnectivity('online');
      }, 2_000);
    } else if (!this.restoreTimer) {
      this.emitConnectivity('online');
    }
  }

  private emitConnectivity(value: ConnectivityState): void {
    if (this.connectivity === value) return;
    this.connectivity = value; this.connectivityChanged.emit(value);
  }

  private updateStats(update: Partial<UploadStats>): void {
    this.stats = { ...this.stats, ...update }; this.statsChanged.emit(this.snapshot());
  }
}
