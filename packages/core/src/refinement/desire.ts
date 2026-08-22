import {
  MEASURED_SAMPLE_FLOOR,
  type CircuitPack,
  type Edge,
  type Position,
  type TraceFragment,
} from '@crowdflow/contracts';
import { VenueGraph } from '../routing/graph.js';
import { median } from '../statistics.js';
import { distanceM as distance } from '../positioning/geo.js';

export interface DesireLine {
  id: string;
  from_zone: string;
  to_zone: string;
  start: Position;
  end: Position;
  observed_length_m: number;
  graph_walk_m: number;
  detour_ratio: number;
  fragments: string[];
  evidence: number;
  width_m: number | null;
}
export interface DesireLineReview {
  desire: DesireLine;
  status: 'proposed' | 'accepted' | 'rejected';
  note: string;
}
/** ASSUMED: triage thresholds only; proposals never create venue geometry without operator review. */
export const ASSUMED_DESIRE_LINE_DETOUR_MIN = 1.25;
export const ASSUMED_DESIRE_LINE_MIN_FRAGMENTS = 3;

export function proposeDesireLines(
  fragments: TraceFragment[],
  pack: CircuitPack,
  detourMin = ASSUMED_DESIRE_LINE_DETOUR_MIN,
  minimum = ASSUMED_DESIRE_LINE_MIN_FRAGMENTS,
): DesireLine[] {
  const graph = new VenueGraph(pack);
  const zones = Object.values(pack.zones ?? {});
  const groups = new Map<string, { start: Position; end: Position; ids: string[]; lengths: number[] }>();
  for (const fragment of fragments) {
    const points = fragment.points ?? [];
    if (points.length < 2) continue;
    const start = points[0]!;
    const end = points[points.length - 1]!;
    const source = nearest(zones, start);
    const destination = nearest(zones, end);
    if (!source || !destination || source.id === destination.id) continue;
    let graphWalk: number;
    try {
      graphWalk = graph.route(source.id, destination.id).distance_m;
    } catch {
      continue;
    }
    const observed = polyline(points);
    if (observed <= 0 || graphWalk / observed < detourMin) continue;
    const key = `${source.id}:${destination.id}`;
    const group = groups.get(key) ?? { start, end, ids: [], lengths: [] };
    group.ids.push(fragment.fragment_id);
    group.lengths.push(observed);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.ids.length >= minimum)
    .map(([id, group]) => {
      const [source, destination] = id.split(':');
      const graphWalk = graph.route(source!, destination!).distance_m;
      const observed = median(group.lengths);
      return {
        id: `desire-${source}-${destination}`,
        from_zone: source!,
        to_zone: destination!,
        start: group.start,
        end: group.end,
        observed_length_m: observed,
        graph_walk_m: graphWalk,
        detour_ratio: graphWalk / observed,
        fragments: [...group.ids].sort(),
        evidence: group.ids.length,
        width_m: lateralWidth(
          fragments.filter((fragment) => group.ids.includes(fragment.fragment_id)),
          group.start,
          group.end,
        ),
      };
    })
    .sort((a, b) => b.detour_ratio - a.detour_ratio || a.id.localeCompare(b.id));
}
export function desireLineEdges(lines: DesireLine[]): Record<string, Edge> {
  return Object.fromEntries(
    lines
      .filter((line) => line.evidence >= MEASURED_SAMPLE_FLOOR && line.width_m != null)
      .map((line) => [
        line.id,
        {
          id: line.id,
          source: line.from_zone,
          destination: line.to_zone,
          length_m: line.observed_length_m,
          width_m: {
            value: line.width_m!,
            provenance: 'measured' as const,
            samples: line.evidence,
            note: 'operator-reviewed desire line from independent private fragments',
          },
          bidirectional: true,
          geometry: [line.start, line.end],
        },
      ]),
  );
}
function lateralWidth(fragments: TraceFragment[], source: Position, destination: Position): number | null {
  const dx = destination.x - source.x;
  const dy = destination.y - source.y;
  const span = Math.hypot(dx, dy);
  if (!span) return null;
  const offsets = fragments.flatMap((fragment) =>
    fragment.points.map((point) => Math.abs(dx * (point.y - source.y) - dy * (point.x - source.x)) / span),
  );
  if (offsets.length < 2) return null;
  const sorted = offsets.sort((a, b) => a - b);
  return Number((2 * sorted[Math.trunc(0.9 * (sorted.length - 1))]!).toFixed(2));
}
function nearest(
  zones: { id: string; position: Position }[],
  point: Position,
): { id: string; position: Position } | undefined {
  return zones
    .slice()
    .sort((a, b) => distance(a.position, point) - distance(b.position, point) || a.id.localeCompare(b.id))[0];
}
function polyline(points: Position[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1]!, points[i]!);
  return total;
}
