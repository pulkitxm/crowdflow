
import type { CrowdNode, IngestAck, NodeReport, PositionSource } from '@crowdflow/contracts';
import { ASSUMED_UPLINK_BATCH_MAX, ASSUMED_UPLINK_INTERVAL_S, LOCATION_DISCLOSURE_VERSION } from '@crowdflow/contracts';

const QUEUE_MAX = 300;
const SAMPLE_MAX_AGE_S = 60;

export interface UplinkOptions {
  baseUrl: string;
  circuitId: string;
  onStop?: (reason: string) => void;
  onResult?: (result: UplinkResult) => void;
  batchMax?: number;
  intervalS?: number;
}

export interface UplinkResult {
  ok: boolean;
  sent: number;
  queued: number;
  ack?: IngestAck;
  problem?: string;
}

export class Uplink {
  private queue: CrowdNode[] = [];
  private sources = new Set<PositionSource>();
  private lastFlush = 0;
  private inFlight = false;
  private dropped = 0;
  readonly batchMax: number;
  readonly intervalS: number;

  constructor(private readonly options: UplinkOptions) {
    this.batchMax = Math.min(options.batchMax ?? ASSUMED_UPLINK_BATCH_MAX, QUEUE_MAX);
    this.intervalS = options.intervalS ?? ASSUMED_UPLINK_INTERVAL_S;
  }

  get depth(): number { return this.queue.length; }
  get droppedCount(): number { return this.dropped; }

  enqueue(node: CrowdNode, source: PositionSource): void {
    this.queue.push(node);
    this.sources.add(source);
    while (this.queue.length > QUEUE_MAX) { this.queue.shift(); this.dropped += 1; }
  }

  clear(): void {
    this.queue = [];
    this.sources.clear();
  }

  due(now: number): boolean { return !this.inFlight && this.queue.length > 0 && now - this.lastFlush >= this.intervalS; }

  async flush(now: number, nodeId: string, epoch: number): Promise<UplinkResult> {
    if (this.inFlight) return { ok: false, sent: 0, queued: this.queue.length, problem: 'an upload is already in flight' };
    this.dropStale(now);
    if (!this.queue.length) return { ok: true, sent: 0, queued: 0 };

    const batch = this.queue.slice(0, this.batchMax);
    this.queue = this.queue.slice(batch.length);
    const report: NodeReport = {
      node_id: nodeId,
      epoch,
      circuit_id: this.options.circuitId,
      consent_version: LOCATION_DISCLOSURE_VERSION,
      nodes: batch,
      sources: [...this.sources],
    };

    if (!this.options.baseUrl) {
      this.queue = [...batch, ...this.queue];
      const result: UplinkResult = { ok: false, sent: 0, queued: this.queue.length, problem: 'no venue is configured for this build' };
      this.options.onResult?.(result);
      return result;
    }

    this.inFlight = true;
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/api/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
      });
      if (!response.ok) {
        if (response.status >= 500) this.queue = [...batch, ...this.queue];
        const result: UplinkResult = { ok: false, sent: 0, queued: this.queue.length, problem: `venue replied ${response.status}` };
        this.options.onResult?.(result);
        return result;
      }
      const ack = await response.json() as IngestAck;
      this.lastFlush = now;
      this.sources.clear();
      if (ack.stop) this.options.onStop?.(ack.problems?.[0] ?? 'the venue asked this phone to stop sensing');
      const result: UplinkResult = { ok: true, sent: ack.accepted, queued: this.queue.length, ack };
      this.options.onResult?.(result);
      return result;
    } catch (error) {
      this.queue = [...batch, ...this.queue];
      const result: UplinkResult = {
        ok: false, sent: 0, queued: this.queue.length,
        problem: error instanceof Error ? error.message : 'the venue could not be reached',
      };
      this.options.onResult?.(result);
      return result;
    } finally {
      this.inFlight = false;
    }
  }

  private dropStale(now: number): void {
    const before = this.queue.length;
    this.queue = this.queue.filter((node) => now - node.timestamp <= SAMPLE_MAX_AGE_S);
    this.dropped += before - this.queue.length;
  }
}
