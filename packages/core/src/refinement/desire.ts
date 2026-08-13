import type { CircuitPack, Position, TraceFragment } from '@crowdflow/contracts';
import { VenueGraph } from '../routing/graph.js';

export interface DesireLine { id: string; start: Position; end: Position; observed_length_m: number; graph_walk_m: number; detour_ratio: number; fragments: string[]; evidence: number }
export interface DesireLineReview { desire: DesireLine; status: 'proposed' | 'accepted' | 'rejected'; note: string }
/** ASSUMED: triage thresholds only; proposals never create venue geometry without operator review. */
export const ASSUMED_DESIRE_LINE_DETOUR_MIN = 1.25;
export const ASSUMED_DESIRE_LINE_MIN_FRAGMENTS = 3;

export function proposeDesireLines(fragments: TraceFragment[], pack: CircuitPack, detourMin = ASSUMED_DESIRE_LINE_DETOUR_MIN, minimum = ASSUMED_DESIRE_LINE_MIN_FRAGMENTS): DesireLine[] {
  const graph = new VenueGraph(pack); const zones = Object.values(pack.zones ?? {}); const groups = new Map<string, { start: Position; end: Position; ids: string[]; lengths: number[] }>();
  for (const fragment of fragments) {
    const points = fragment.points ?? []; if (points.length < 2) continue; const start = points[0]!; const end = points[points.length - 1]!;
    const source = nearest(zones, start); const destination = nearest(zones, end); if (!source || !destination || source.id === destination.id) continue;
    let graphWalk: number; try { graphWalk = graph.route(source.id, destination.id).distance_m; } catch { continue; }
    const observed = polyline(points); if (observed <= 0 || graphWalk / observed < detourMin) continue;
    const key = `${source.id}:${destination.id}`; const group = groups.get(key) ?? { start, end, ids: [], lengths: [] }; group.ids.push(fragment.fragment_id); group.lengths.push(observed); groups.set(key, group);
  }
  return [...groups.entries()].filter(([, group]) => group.ids.length >= minimum).map(([id, group]) => {
    const [source, destination] = id.split(':'); const graphWalk = graph.route(source!, destination!).distance_m; const observed = median(group.lengths);
    return { id: `desire-${source}-${destination}`, start: group.start, end: group.end, observed_length_m: observed, graph_walk_m: graphWalk, detour_ratio: graphWalk / observed, fragments: [...group.ids].sort(), evidence: group.ids.length };
  }).sort((a, b) => b.detour_ratio - a.detour_ratio || a.id.localeCompare(b.id));
}
function nearest(zones: { id: string; position: Position }[], point: Position): { id: string; position: Position } | undefined { return zones.slice().sort((a, b) => distance(a.position, point) - distance(b.position, point) || a.id.localeCompare(b.id))[0]; }
function distance(a: Position, b: Position): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function polyline(points: Position[]): number { let total = 0; for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1]!, points[i]!); return total; }
function median(values: number[]): number { const sorted = values.slice().sort((a, b) => a - b); const middle = Math.trunc(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; }
