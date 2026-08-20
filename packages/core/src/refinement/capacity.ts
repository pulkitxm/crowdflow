import type { CircuitPack, Edge, Sourced } from '@crowdflow/contracts';
import { GEOIND_PRIVACY_LEVEL, MEASURED_SAMPLE_FLOOR, isTrustworthy } from '@crowdflow/contracts';
import { capacityFlow } from '../state/flow.js';
import { traversalSpeed, type MatchedFragment, type Traversal } from './trace.js';
import { median, round, sampleStandardDeviation } from '../statistics.js';

export const BIN_S = 60; export const SUSTAINED_BINS = 3;
export interface EdgeMeasurement { edge_id: string; fragments: number; width: Sourced; capacity_flow_ped_m_min: Sourced | null; free_speed: Sourced | null; peak_bin_flow_ped_m_min: number; notes: string[] }

export function measureWidth(traversals: Traversal[], imported: Sourced | null, samples?: number): [Sourced | null, string | null] {
  const offsets = traversals.flatMap((item) => item.signed_offsets_m);
  const count = samples ?? new Set(traversals.map((item) => item.fragment_id)).size;
  if (offsets.length < 2) return [imported, 'too few matched points to estimate lateral spread'];
  const observed = sampleStandardDeviation(offsets);
  const radius = median(traversals.map((item) => item.noise_radius_m));
  const epsilons = traversals.map((item) => item.epsilon).filter((value): value is number => value != null);
  const sigma = epsilons.length ? Math.sqrt(3) / median(epsilons) : Math.sqrt(3) * radius / GEOIND_PRIVACY_LEVEL;
  const corrected = observed ** 2 - sigma ** 2;
  if (corrected <= 0) return [imported, 'lateral spread is within planar-Laplace axis sigma'];
  return [{ value: round(Math.sqrt(12) * Math.sqrt(corrected), 2), provenance: 'measured', samples: count, note: `lateral spread of ${count} trace fragments, privacy de-biased` }, null];
}

export function measureCapacity(traversals: Traversal[], widthM: number, participation: number): [Sourced | null, number, string[]] {
  if (!(participation > 0 && participation <= 1)) throw new Error('participation_rate must be measured and in (0, 1]');
  if (!traversals.length) return [null, 0, ['no traversals observed']];
  const start = Math.min(...traversals.map((item) => item.t_start));
  const bins = new Map<number, Set<string>>();
  for (const item of traversals) for (let bin = Math.trunc((item.t_start - start) / BIN_S); bin <= Math.trunc((item.t_end - start) / BIN_S); bin++) {
    const ids = bins.get(bin) ?? new Set(); ids.add(item.fragment_id); bins.set(bin, ids);
  }
  const span = Math.max(...bins.keys()) + 1;
  const flows = Array.from({ length: span }, (_, index) => (bins.get(index)?.size ?? 0) / participation / Math.max(widthM, Number.EPSILON));
  const peak = Math.max(...flows);
  if (span < SUSTAINED_BINS) return [null, round(peak, 2), ['too little observation to establish sustained flow']];
  let sustained = 0;
  for (let index = 0; index <= span - SUSTAINED_BINS; index++) sustained = Math.max(sustained, flows.slice(index, index + SUSTAINED_BINS).reduce((a, b) => a + b, 0) / SUSTAINED_BINS);
  if (sustained > capacityFlow()[1]) return [null, round(peak, 2), ['sustained flow exceeds physical maximum; width or participation is wrong']];
  return [{ value: round(sustained, 2), provenance: 'measured', samples: new Set(traversals.map((item) => item.fragment_id)).size, note: 'peak flow sustained over three consecutive minutes' }, round(peak, 2), []];
}

export function measureEdges(pack: CircuitPack, matched: MatchedFragment[], participation: number): Record<string, EdgeMeasurement> {
  const grouped: Record<string, Traversal[]> = {};
  for (const item of matched) for (const traversal of item.traversals) {
    const group = grouped[traversal.edge_id] ?? [];
    group.push(traversal);
    grouped[traversal.edge_id] = group;
  }
  const out: Record<string, EdgeMeasurement> = {};
  for (const [edgeId, traversals] of Object.entries(grouped)) {
    const edge = pack.edges?.[edgeId]; if (!edge) continue;
    const fragments = new Set(traversals.map((item) => item.fragment_id)).size;
    const [width, widthNote] = measureWidth(traversals, edge.width_m, fragments);
    const selectedWidth = width ?? edge.width_m;
    const [capacity, peak, notes] = measureCapacity(traversals, isTrustworthy(selectedWidth) ? selectedWidth.value : edge.width_m.value, participation);
    const speeds = traversals.map(traversalSpeed).filter((value): value is number => value != null && value > 0);
    const freeSpeed = speeds.length ? { value: round(median(speeds), 3), provenance: 'measured' as const, samples: speeds.length, note: 'median observed traversal speed' } : null;
    if (widthNote) notes.unshift(widthNote); if (fragments < MEASURED_SAMPLE_FLOOR) notes.push(`${fragments} fragments below sample floor`);
    out[edgeId] = { edge_id: edgeId, fragments, width: selectedWidth, capacity_flow_ped_m_min: capacity, free_speed: freeSpeed, peak_bin_flow_ped_m_min: peak, notes };
  }
  return out;
}

export function applyMeasurements(pack: CircuitPack, measurements: Record<string, EdgeMeasurement>): Record<string, Edge> {
  const refined: Record<string, Edge> = {};
  for (const [edgeId, measurement] of Object.entries(measurements)) {
    const edge = pack.edges?.[edgeId]; if (!edge) continue; const update: Partial<Edge> = {};
    if (isTrustworthy(measurement.width) && !isTrustworthy(edge.width_m)) update.width_m = measurement.width;
    if (measurement.free_speed && isTrustworthy(measurement.free_speed)) update.free_speed_ms = measurement.free_speed;
    if (measurement.capacity_flow_ped_m_min && isTrustworthy(measurement.capacity_flow_ped_m_min)) update.capacity_flow_ped_m_min = measurement.capacity_flow_ped_m_min;
    if (Object.keys(update).length) refined[edgeId] = { ...edge, ...update };
  }
  return refined;
}
