/**
 * Getting samples to the venue, given that the venue is often unreachable.
 *
 * At a full circuit the cell network is saturated — that is the premise the whole
 * mesh design rests on (decision D7) — so "POST and hope" is not a transport. A
 * phone that drops a sample because the request failed contributes nothing from
 * exactly the periods that matter most: the gate rush and the egress, which are
 * when the network is worst and the crowd picture is most needed.
 *
 * So samples queue. Three bounds keep the queue from becoming a liability of its
 * own:
 *
 *   SIZE. Oldest first out when full. A phone that has been out of coverage for
 *   an hour must not arrive as one enormous request, and the recent samples are
 *   the ones with operational value — a density reading from forty minutes ago
 *   is history, not state.
 *
 *   AGE. Samples older than the state engine's window are dropped rather than
 *   sent, because the server will reject them anyway and the upload cost is
 *   real. This is done here, before the request, rather than discovered in the
 *   ack.
 *
 *   THE EPOCH. `clear()` on rotation, and it is not an optimisation. A queue that
 *   survives a pseudonym rotation is uploaded under the new id while describing
 *   the old id's walk, which links the two and defeats the rotation entirely.
 *
 * The ack is acted on, not logged. `stop: true` means the disclosure this phone
 * cites is no longer served, and the correct response is to stop sensing — not to
 * keep sensing and stop uploading.
 */

import type { CrowdNode, IngestAck, NodeReport, PositionSource } from '@crowdflow/contracts';
import { ASSUMED_UPLINK_BATCH_MAX, ASSUMED_UPLINK_INTERVAL_S, LOCATION_DISCLOSURE_VERSION } from '@crowdflow/contracts';

/** Ten minutes of samples at the reporting cadence. Past this the queue is
 *  holding history nothing will act on. */
const QUEUE_MAX = 300;
/** Matches the state engine's reporting window with room for one hop of uplink
 *  latency; beyond it the server rejects the sample as skewed. */
const SAMPLE_MAX_AGE_S = 60;

export interface UplinkOptions {
  baseUrl: string;
  circuitId: string;
  /** Called when the server says stop. The engine shuts the radios down. */
  onStop?: (reason: string) => void;
  /** Called after every attempt, for the status screen. */
  onResult?: (result: UplinkResult) => void;
  batchMax?: number;
  intervalS?: number;
}

export interface UplinkResult {
  ok: boolean;
  sent: number;
  queued: number;
  ack?: IngestAck;
  /** One sentence, for the status screen. Never a stack trace. */
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

  /** Everything, on epoch rotation. See the note at the top of this file. */
  clear(): void {
    this.queue = [];
    this.sources.clear();
  }

  due(now: number): boolean { return !this.inFlight && this.queue.length > 0 && now - this.lastFlush >= this.intervalS; }

  /**
   * Send one batch.
   *
   * On failure the batch goes back to the FRONT of the queue, in order. Appending
   * it would reorder samples, and the state engine keeps the latest sample per
   * node — so a retry that arrived after newer samples would move a phone
   * backwards to where it was a minute ago.
   */
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
      // No venue configured — a demo build, or an app started before anyone told
      // it where to report. Samples keep queueing so the status screen shows a
      // rising number rather than a silent zero, but there is nothing to fetch
      // and pretending to try would log a network error every thirty seconds.
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
        // 503 means the venue is not listening yet — worth keeping the samples
        // for. A 4xx means this batch is wrong and resending it will fail the
        // same way, so it is dropped rather than retried forever.
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
