/**
 * Real phones, as opposed to simulated ones.
 *
 * `ScenarioSession` drives the loop from a simulation: it owns a clock, steps a
 * crowd of agents forward and reads their positions out. This is the other
 * input — the same `StateEngine`, fed by handsets that report when they feel
 * like it, from wherever they happen to be, over whatever uplink they found.
 *
 * It is deliberately a SEPARATE object rather than a mode flag on the session,
 * for three reasons that all point the same way:
 *
 *   The clock is not ours. A simulation's `now` is the tick count. Here it is
 *   whatever a handset's clock said, which may be minutes off, so every
 *   timestamp is checked against the server clock and the skew is reported back
 *   in `IngestAck.server_time` for the phone to correct.
 *
 *   Coverage is not a parameter. In simulation, participation is an input and
 *   every zone has agents in it. Here, a zone with no reading is genuinely
 *   unknown, and the distinction between "empty" and "unobserved" is the whole
 *   point of `VenueState.unobserved_zones`.
 *
 *   Participation cannot be assumed away. `estimated_population` is observed
 *   devices divided by the participation rate, and it is the most load-bearing
 *   number the console displays. In simulation it is known. Here it is not, and
 *   this class refuses to invent it — it takes the operator's estimate and
 *   reports what it was told, so a screenshot of the console says whether the
 *   population figure rests on a measurement or on somebody's guess.
 *
 * What this class will not do is keep a trail. Reports go into the state
 * engine's rolling window and are aggregated to zones; nothing indexes a
 * `node_id` to a sequence of positions, and there is no store to sweep later.
 * That is a stronger promise than a retention period, and it is enforced by
 * there being nowhere for a trail to live.
 */

import type { CrowdNode, Forecast, IngestAck, NodeReport, PositionSource, VenueState } from '@crowdflow/contracts';
import { ASSUMED_ID_ROTATION_S, SERVED_DISCLOSURE_VERSIONS, validateCrowdNode } from '@crowdflow/contracts';
import { BaselinePredictor, DEFAULT_WINDOW_S, StateEngine } from '@crowdflow/core';
import { insidePack } from '@crowdflow/core/positioning';
import type { LoadedCircuit } from './packs.js';
import type { PeopleStore } from './people.js';
import type { LiveSnapshot, NodeMark } from './wire.js';

/**
 * How far a handset's clock may be out before its samples are refused.
 *
 * Not a courtesy. The state engine's window is thirty seconds, so a phone two
 * minutes fast contributes samples that are always in the future and never
 * expire, and a phone two minutes slow contributes samples that are stale on
 * arrival. Both quietly distort the density in whichever zone they are standing
 * in. Rejecting with the server clock attached lets the handset fix itself.
 */
const MAX_CLOCK_SKEW_S = 90;

/** Samples per batch. A phone that has been out of coverage for an hour must
 *  not be able to arrive as a single enormous request. */
const MAX_BATCH = 240;

const FORECAST_SAMPLE_S = 5;

export interface LiveIngestOptions {
  /**
   * The operator's participation estimate — the share of people present who are
   * running the app. ASSUMED until a capture-recapture measurement exists (see
   * `estimateParticipation` in core); reported as-is so the console can label it.
   */
  participation: number;
  window_s?: number;
}

export class LiveIngest {
  private engine: StateEngine;
  private predictor: BaselinePredictor;
  private forecasts: Forecast[] = [];
  private lastForecastAt = -Infinity;
  private marks = new Map<number, { node: CrowdNode; received: number; source: PositionSource }>();
  private sourceCounts = new Map<PositionSource, number>();
  private listeners = new Set<(snapshot: LiveSnapshot) => void>();
  private accepted = 0;
  private rejected = 0;
  private problemCounts = new Map<string, number>();
  private lastReportAt: number | null = null;

  constructor(readonly circuit: LoadedCircuit, readonly options: LiveIngestOptions, private readonly people: PeopleStore) {
    this.engine = new StateEngine(circuit.pack, options.participation, options.window_s);
    this.predictor = new BaselinePredictor();
  }

  subscribe(listener: (snapshot: LiveSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Take one batch.
   *
   * Every rejection is counted and named. A silent drop here is indistinguishable
   * on the console from a quiet venue, and the two call for opposite responses.
   */
  report(report: NodeReport, now: number): IngestAck {
    const ack = this.process(report, now);
    this.emit(now);
    return ack;
  }

  reportMany(reports: NodeReport[], now: number, emit = true): IngestAck {
    if (!reports.length || reports.length > 1000) throw new Error('reports must contain from 1 to 1000 items');
    const acknowledgements = this.people.transaction(() => reports.map((report) => this.process(report, now)));
    if (emit) this.emit(now);
    return {
      accepted: acknowledgements.reduce((sum, ack) => sum + ack.accepted, 0),
      rejected: acknowledgements.reduce((sum, ack) => sum + ack.rejected, 0),
      problems: [...new Set(acknowledgements.flatMap((ack) => ack.problems ?? []))],
      server_time: now,
      stop: acknowledgements.some((ack) => ack.stop),
    };
  }

  private process(report: NodeReport, now: number): IngestAck {
    const problems: string[] = [];
    const fail = (reason: string, count = 1): IngestAck => {
      this.rejected += count;
      this.problemCounts.set(reason, (this.problemCounts.get(reason) ?? 0) + count);
      return { accepted: 0, rejected: count, problems: [reason], server_time: now, stop: reason.startsWith('disclosure') };
    };

    if (!SERVED_DISCLOSURE_VERSIONS.includes(report.consent_version as typeof SERVED_DISCLOSURE_VERSIONS[number])) {
      // The one rejection that also tells the handset to stop. A disclosure that
      // is no longer served is a disclosure that has been withdrawn, and a phone
      // still sensing under it must stop sensing, not merely stop uploading.
      return fail(`disclosure ${report.consent_version} is not served`, Math.max(1, report.nodes?.length ?? 1));
    }
    if (report.circuit_id !== this.circuit.pack.id) {
      return fail(`circuit ${report.circuit_id} is not the live circuit`, Math.max(1, report.nodes?.length ?? 1));
    }
    if (!this.people.exists(report.person_id, report.circuit_id)) {
      return fail(`person ${report.person_id} is not logged in to ${report.circuit_id}`, Math.max(1, report.nodes?.length ?? 1));
    }

    const batch = report.nodes ?? [];
    if (!batch.length) return { accepted: 0, rejected: 0, problems: [], server_time: now, stop: false };
    if (batch.length > MAX_BATCH) return fail(`batch of ${batch.length} exceeds ${MAX_BATCH}`, batch.length);

    const usable: CrowdNode[] = [];
    let dropped = 0;
    for (const node of batch) {
      const problem = this.problemWith(node, report, now);
      if (problem) {
        dropped += 1;
        if (!problems.includes(problem)) problems.push(problem);
        this.problemCounts.set(problem, (this.problemCounts.get(problem) ?? 0) + 1);
        continue;
      }
      // The epoch is folded into the key the state engine sees. Two epochs of
      // the same handset are two nodes by construction, so nothing downstream
      // can join them however it iterates — the rotation is enforced here rather
      // than trusted to every consumer.
      usable.push({ ...node, node_id: `${node.node_id}@${node.epoch}` });
    }

    const kept = usable.length ? this.engine.ingest(usable, now) : 0;
    const source = report.sources?.[0] ?? 'fused';
    for (const node of usable) {
      this.marks.set(report.person_id, { node, received: now, source });
      this.people.updateLocation(report.person_id, report.circuit_id, node.position, node.speed_ms, node.accuracy_m, source, now, report.gate_id ?? null);
    }
    for (const reportedSource of report.sources ?? []) this.sourceCounts.set(reportedSource, (this.sourceCounts.get(reportedSource) ?? 0) + 1);

    this.accepted += kept;
    this.rejected += dropped + (usable.length - kept);
    if (usable.length > kept) problems.push('outside the reporting window');
    this.lastReportAt = now;
    return { accepted: kept, rejected: dropped + (usable.length - kept), problems, server_time: now, stop: false };
  }

  private emit(now: number): void {
    const snapshot = this.snapshot(now, false);
    for (const listener of this.listeners) listener(snapshot);
  }

  /**
   * Why one sample cannot be used.
   *
   * Returns a reason rather than a boolean so the console can show a phone
   * developer what is wrong with their build, and an operator what is wrong with
   * their venue. "3,400 rejected" is not actionable; "3,400 rejected: position
   * outside venue bounds" is a wrong circuit id in a config file.
   */
  private problemWith(node: CrowdNode, report: NodeReport, now: number): string | null {
    try {
      validateCrowdNode(node);
    } catch (error) {
      return `invalid node: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (Math.abs(now - node.timestamp) > MAX_CLOCK_SKEW_S) return 'device clock skew beyond the reporting window';
    if (node.epoch !== report.epoch || node.node_id !== report.node_id) return 'sample does not belong to the reporting node';
    // An epoch far from the one the server would derive means a handset whose
    // rotation schedule has drifted, which is the failure that makes two
    // pseudonyms linkable by when they went quiet.
    if (Math.abs(node.epoch - Math.floor(now / ASSUMED_ID_ROTATION_S)) > 1) return 'epoch is not the current rotation';
    if (!insidePack(this.circuit.pack, node.position)) return 'position outside venue bounds';
    return null;
  }

  /** The live picture. Mirrors what a scenario tick carries, minus everything
   *  that only exists in simulation — there is no ground truth here to compare
   *  the estimate against, and the snapshot does not pretend otherwise. */
  snapshot(now: number, includeNodes = true): LiveSnapshot {
    for (const [id, held] of this.marks) if (now - held.received > (this.options.window_s ?? DEFAULT_WINDOW_S)) this.marks.delete(id);
    const state: VenueState = this.engine.snapshot(now, null);
    const forecasts = this.forecastFor(state, now);
    const zones = Object.keys(this.circuit.pack.zones ?? {});
    const observed = Object.keys(state.zones ?? {});
    const unknown = state.unobserved_zones ?? [];
    const silent = zones.filter((id) => !observed.includes(id) && !unknown.includes(id));
    const lowConfidence = observed.filter((id) => !state.zones?.[id]?.confidence.reportable);
    return {
      circuit_id: this.circuit.pack.id,
      server_time: now,
      last_report_age_s: this.lastReportAt == null ? null : Number((now - this.lastReportAt).toFixed(1)),
      participation: this.options.participation,
      participation_provenance: 'assumed',
      window_s: this.options.window_s ?? DEFAULT_WINDOW_S,
      state,
      forecasts,
      actionable: forecasts.filter((forecast) => forecast.actionable).map((forecast) => forecast.zone_id),
      nodes: includeNodes ? [...this.marks.entries()].map(([personId, { node, source }]): NodeMark => ({
        person_id: personId, x: node.position.x, y: node.position.y, speed_ms: node.speed_ms, accuracy_m: node.accuracy_m,
        timestamp: node.timestamp, source,
      })) : [],
      reporting_devices: this.marks.size,
      by_source: Object.fromEntries(this.sourceCounts) as Partial<Record<PositionSource, number>>,
      accepted_total: this.accepted,
      rejected_total: this.rejected,
      problems: Object.fromEntries([...this.problemCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
      coverage: {
        zones_total: zones.length, observed: observed.length, unknown: unknown.length, silent: silent.length,
        low_confidence: lowConfidence.length, fraction_observed: zones.length ? observed.length / zones.length : 0,
      },
    };
  }

  private forecastFor(state: VenueState, now: number): Forecast[] {
    if (now - this.lastForecastAt >= FORECAST_SAMPLE_S) {
      this.lastForecastAt = now;
      this.forecasts = this.predictor.forecast(state);
    }
    return this.forecasts;
  }

  /** Drop every sample and every counter. The operator-facing half of consent
   *  withdrawal: a person can stop their phone reporting, and this is how a
   *  venue stops holding what was already reported. */
  clear(): void {
    this.engine = new StateEngine(this.circuit.pack, this.options.participation, this.options.window_s);
    this.predictor = new BaselinePredictor();
    this.forecasts = [];
    this.lastForecastAt = -Infinity;
    this.marks.clear();
    this.sourceCounts.clear();
    this.problemCounts.clear();
    this.accepted = 0;
    this.rejected = 0;
    this.lastReportAt = null;
  }
}
