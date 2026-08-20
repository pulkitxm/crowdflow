/**
 * A crowd of phones, without the phones.
 *
 * This is the headless end-to-end test for live sensing, and it exercises the
 * REAL path: it fetches the anchor pack the API actually serves, generates the
 * scan physics would produce at a known position, resolves it against the anchor
 * map, trilaterates, runs the fusion ladder, shapes a `CrowdNode` under a
 * rotating pseudonym and POSTs it to `/api/nodes`. Every layer between a radio
 * and the operator console is the shipping code. Only the radio is simulated.
 *
 * It exists because the alternative way to find out whether live ingest works is
 * twenty-five people with development builds walking around a circuit. Most of
 * what breaks in this pipeline is not radio-shaped — a venue frame applied in the
 * wrong direction, an epoch that never rolls, a queue that reorders a walk, a
 * zone lookup that silently rejects every position — and all of it is findable
 * from a terminal in a few seconds.
 *
 * It also reports the truth against the estimate, which a real walk test cannot:
 * the simulator knows where each phone was, so the p50/p95 error printed at the
 * end is the actual accuracy the console's dots were drawn with.
 */

import type { AnchorPack, CircuitPack, CrowdNode, IngestAck, Position, PositionSource, RadioAnchor } from '@crowdflow/contracts';
import { ASSUMED_MIN_ANCHORS_FOR_FIX, FREE_FLOW_SPEED_MS, LOCATION_DISCLOSURE_VERSION } from '@crowdflow/contracts';
import {
  AnchorMap, NodeIdentity, PositionFuser, crowdNodeFrom, distanceM, fixFrom, simulateScan, trilaterate,
} from '@crowdflow/core/positioning';
import { Random } from '@crowdflow/core/random';

export interface RehearsalRun {
  phones: number;
  ticks: number;
  /** scans where enough anchors were heard to trilaterate */
  wifi_solves: number;
  ble_solves: number;
  /** ticks where the ladder produced nothing usable — a real and expected outcome */
  no_fix: number;
  /** which rung the ladder actually chose, per accepted fix */
  by_source: Record<string, number>;
  accepted: number;
  rejected: number;
  problems: string[];
  /** true error of every reported position, against ground truth the console cannot know */
  p50_error_m: number;
  p95_error_m: number;
}

export interface RehearseOptions {
  api: string;
  circuitId: string;
  phones: number;
  ticks: number;
  /** wall seconds between ticks. Real cadence matters: the server's reporting
   *  window and the fuser's staleness tests are both in seconds. */
  intervalS: number;
  seed: number;
  sigmaDb: number;
  /** GNSS one-sigma, metres. The control rung. */
  gnssSigmaM: number;
  /** radios to rehearse; omit one to prove the ladder falls through */
  radios: ('wifi' | 'ble' | 'gnss')[];
  onTick?: (tick: number, run: RehearsalRun) => void;
}

interface Walker {
  identity: NodeIdentity;
  fuser: PositionFuser;
  from: Position;
  to: Position;
  progress: number;
  legM: number;
}

export async function rehearseLivePhones(options: RehearseOptions): Promise<RehearsalRun> {
  const api = options.api.replace(/\/$/, '');
  const pack = (await fetchJson<{ pack: CircuitPack }>(`${api}/api/circuits/${options.circuitId}/geometry`)).pack;
  const anchorPack = await fetchJson<AnchorPack>(`${api}/api/circuits/${options.circuitId}/anchors`);
  const anchors = Object.values(anchorPack.anchors ?? {});
  const wifiAnchors = anchors.filter((anchor) => anchor.kind === 'wifi_ap');
  const bleAnchors = anchors.filter((anchor) => anchor.kind === 'ble_beacon');
  const map = new AnchorMap(anchorPack);
  const rng = new Random(options.seed);

  const edges = Object.values(pack.edges ?? {});
  if (!edges.length) throw new Error(`${options.circuitId} has no walkable edges`);

  const walkers: Walker[] = [];
  for (let index = 0; index < options.phones; index++) {
    const edge = edges[Math.floor(rng.random() * edges.length)]!;
    const from = pack.zones?.[edge.source]?.position;
    const to = pack.zones?.[edge.destination]?.position;
    if (!from || !to) continue;
    walkers.push({
      // Each handset gets its own identity and its own ladder, which is what the
      // app builds per device — a shared fuser would arbitrate between phones.
      identity: new NodeIdentity(Date.now() / 1000, undefined, (bytes) => hex(rng, bytes)),
      fuser: new PositionFuser(pack.frame),
      from, to, progress: rng.random(), legM: Math.max(1, distanceM(from, to)),
    });
  }

  const run: RehearsalRun = {
    phones: walkers.length, ticks: options.ticks, wifi_solves: 0, ble_solves: 0, no_fix: 0,
    by_source: {}, accepted: 0, rejected: 0, problems: [], p50_error_m: Number.NaN, p95_error_m: Number.NaN,
  };
  const errors: number[] = [];
  const problems = new Set<string>();

  for (let tick = 0; tick < options.ticks; tick++) {
    const now = Date.now() / 1000;
    for (const walker of walkers) {
      // Walk at free-flow speed for the tick interval, then turn round at the end
      // of the leg rather than teleporting back — the fuser's jump test would
      // (correctly) reject a phone that reappeared at the other end of an edge.
      walker.progress += (FREE_FLOW_SPEED_MS * options.intervalS) / walker.legM;
      if (walker.progress > 1) { walker.progress = 0; const swap = walker.from; walker.from = walker.to; walker.to = swap; }
      const truth: Position = {
        x: walker.from.x + (walker.to.x - walker.from.x) * walker.progress,
        y: walker.from.y + (walker.to.y - walker.from.y) * walker.progress,
      };

      if (options.radios.includes('wifi') && wifiAnchors.length) {
        if (offerRadio(map, wifiAnchors, walker, truth, now, rng, options.sigmaDb, 'wifi', ['wifi_ap'])) run.wifi_solves += 1;
      }
      if (options.radios.includes('ble') && bleAnchors.length) {
        if (offerRadio(map, bleAnchors, walker, truth, now, rng, options.sigmaDb, 'ble', ['ble_beacon'])) run.ble_solves += 1;
      }
      if (options.radios.includes('gnss')) {
        walker.fuser.offer({
          position: { x: truth.x + rng.gauss(0, options.gnssSigmaM), y: truth.y + rng.gauss(0, options.gnssSigmaM) },
          accuracy_m: options.gnssSigmaM, source: 'gnss', timestamp: now,
          anchors_used: 0, residual_m: null, speed_ms: null, heading_deg: null,
        });
      }

      walker.identity.refresh(now);
      const fix = walker.fuser.resolve(now).fix;
      if (!fix) { run.no_fix += 1; continue; }
      const node = crowdNodeFrom(fix, walker.identity, pack);
      if (!node) { run.no_fix += 1; continue; }

      run.by_source[fix.source] = (run.by_source[fix.source] ?? 0) + 1;
      errors.push(distanceM(node.position, truth));

      const ack = await postReport(api, options.circuitId, walker.identity, node, fix.source);
      run.accepted += ack.accepted;
      run.rejected += ack.rejected;
      for (const problem of ack.problems ?? []) problems.add(problem);
    }
    run.problems = [...problems];
    options.onTick?.(tick + 1, run);
    if (tick + 1 < options.ticks) await sleep(options.intervalS * 1000);
  }

  errors.sort((a, b) => a - b);
  run.p50_error_m = quantile(errors, 0.5);
  run.p95_error_m = quantile(errors, 0.95);
  return run;
}

function offerRadio(
  map: AnchorMap, anchors: RadioAnchor[], walker: Walker, truth: Position, now: number,
  rng: Random, sigmaDb: number, source: 'wifi' | 'ble', kinds: ('wifi_ap' | 'ble_beacon')[],
): boolean {
  const scan = simulateScan(map, anchors, truth, now, rng, { sigma_db: sigmaDb, kinds });
  const resolved = map.resolve(scan, now, kinds);
  if (resolved.matched < ASSUMED_MIN_ANCHORS_FOR_FIX) return false;
  walker.fuser.offer(fixFrom(trilaterate(resolved.ranges), source, now));
  return true;
}

async function postReport(api: string, circuitId: string, identity: NodeIdentity, node: CrowdNode, source: PositionSource): Promise<IngestAck> {
  const response = await fetch(`${api}/api/nodes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      node_id: identity.nodeId, epoch: identity.epoch, circuit_id: circuitId,
      // The rung that produced this batch. Without it the console cannot tell a
      // zone that emptied from a zone whose phones all lost their anchor map.
      consent_version: LOCATION_DISCLOSURE_VERSION, nodes: [node], sources: [source],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    // 503 here means live ingest was never armed, which is the single most likely
    // way to run this and see nothing. Say so rather than counting a rejection.
    throw new Error(`POST /api/nodes → ${response.status}: ${detail}`);
  }
  return await response.json() as IngestAck;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return await response.json() as T;
}

function hex(rng: Random, bytes: number): string {
  let out = '';
  for (let index = 0; index < bytes; index++) out += Math.floor(rng.random() * 256).toString(16).padStart(2, '0');
  return out;
}

function quantile(sorted: number[], fraction: number): number {
  if (!sorted.length) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return Number(sorted[index]!.toFixed(2));
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
