import type { CircuitPack, Position, TraceFragment } from '@crowdflow/contracts';

export interface Match { index: number; point: Position; t: number; edge_id: string | null; offset_m: number; signed_offset_m: number }
export interface Traversal {
  edge_id: string; fragment_id: string; t_start: number; t_end: number;
  distance_m: number; noise_radius_m: number; epsilon: number | null; signed_offsets_m: number[];
}
export interface MatchedFragment { fragment_id: string; matches: Match[]; traversals: Traversal[] }

export class TraceMatcher {
  constructor(readonly pack: CircuitPack) {}
  match(fragment: TraceFragment): MatchedFragment {
    const matches = fragment.points.map((point, index) => this.matchPoint(point, index, fragment.noise_radius_m));
    return { fragment_id: fragment.fragment_id, matches, traversals: this.traversals(fragment, matches) };
  }
  private matchPoint(point: Position, index: number, noise: number): Match {
    let best: Match = { index, point, t: 0, edge_id: null, offset_m: 0, signed_offset_m: 0 };
    let distance = Infinity;
    for (const [edgeId, edge] of Object.entries(this.pack.edges ?? {})) {
      const source = this.pack.zones?.[edge.source]; const destination = this.pack.zones?.[edge.destination];
      if (!source || !destination) continue;
      const [t, offset, signed] = project(point, source.position, destination.position);
      if (offset <= edge.width_m.value / 2 + noise && offset < distance) {
        distance = offset; best = { index, point, t, edge_id: edgeId, offset_m: offset, signed_offset_m: signed };
      }
    }
    return best;
  }
  private traversals(fragment: TraceFragment, matches: Match[]): Traversal[] {
    const out: Traversal[] = []; let current: Traversal | null = null;
    const time = (index: number) => fragment.t_start + (fragment.t_end - fragment.t_start) * index / Math.max(1, matches.length - 1);
    for (const match of matches) {
      if (!match.edge_id) { current = null; continue; }
      if (!current || current.edge_id !== match.edge_id) {
        current = { edge_id: match.edge_id, fragment_id: fragment.fragment_id, t_start: time(match.index), t_end: time(match.index), distance_m: 0, noise_radius_m: fragment.noise_radius_m, epsilon: fragment.epsilon, signed_offsets_m: [match.signed_offset_m] };
        out.push(current);
      } else {
        const previous = matches[match.index - 1]!;
        current.t_end = time(match.index);
        current.distance_m += Math.hypot(previous.point.x - match.point.x, previous.point.y - match.point.y);
        current.signed_offsets_m.push(match.signed_offset_m);
      }
    }
    return out;
  }
}

export function offGraphRuns(matched: MatchedFragment): Match[][] {
  const runs: Match[][] = []; let current: Match[] = [];
  for (const match of matched.matches) {
    if (match.edge_id) { if (current.length) runs.push(current); current = []; }
    else current.push(match);
  }
  if (current.length) runs.push(current);
  return runs;
}

export function matchAll(pack: CircuitPack, fragments: TraceFragment[]): MatchedFragment[] {
  const matcher = new TraceMatcher(pack); return fragments.map((fragment) => matcher.match(fragment));
}

export function traversalSpeed(traversal: Traversal): number | null {
  const duration = Math.max(0, traversal.t_end - traversal.t_start);
  return duration > 0 && traversal.distance_m > 0 ? traversal.distance_m / duration : null;
}

export function project(point: Position, source: Position, destination: Position): [number, number, number] {
  const dx = destination.x - source.x; const dy = destination.y - source.y; const span = dx * dx + dy * dy;
  if (span <= 0) { const d = Math.hypot(point.x - source.x, point.y - source.y); return [0, d, d]; }
  const raw = ((point.x - source.x) * dx + (point.y - source.y) * dy) / span;
  const t = Math.max(0, Math.min(1, raw)); const x = source.x + t * dx; const y = source.y + t * dy;
  const offset = Math.hypot(point.x - x, point.y - y); const cross = dx * (point.y - source.y) - dy * (point.x - source.x);
  return [t, offset, Math.sign(cross || 1) * offset];
}
