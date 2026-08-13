import type { CircuitPack, Edge, TraceFragment } from '@crowdflow/contracts';
import { applyMeasurements, measureEdges, type EdgeMeasurement } from './capacity.js';
import { auditUsage, type EdgeUsage } from './staleness.js';
import { TraceMatcher, type MatchedFragment } from './trace.js';

export interface RefinementReport {
  circuit_id: string; fragments: number; matched_points: number; off_graph_points: number;
  measurements: Record<string, EdgeMeasurement>; usage: EdgeUsage[]; refined_edges: Record<string, Edge>;
  off_graph_share: number; removal_candidates: EdgeUsage[]; unobserved_edges: EdgeUsage[];
  summary(): string[]; apply(pack: CircuitPack): CircuitPack;
}
export function refine(pack: CircuitPack, fragments: TraceFragment[], participation: number): RefinementReport {
  const matcher = new TraceMatcher(pack); const matched: MatchedFragment[] = fragments.map((fragment) => matcher.match(fragment));
  const on = matched.flatMap((item) => item.matches).filter((match) => match.edge_id != null).length;
  const off = matched.flatMap((item) => item.matches).filter((match) => match.edge_id == null).length;
  const measurements = measureEdges(pack, matched, participation); const usage = auditUsage(pack, matched); const refined = applyMeasurements(pack, measurements);
  const report: RefinementReport = {
    circuit_id: pack.id, fragments: fragments.length, matched_points: on, off_graph_points: off,
    measurements, usage, refined_edges: refined, off_graph_share: on + off ? off / (on + off) : 0,
    removal_candidates: usage.filter((item) => item.removal_candidate), unobserved_edges: usage.filter((item) => item.verdict === 'unobserved'),
    summary: () => [
      `${fragments.length} fragments, ${(report.off_graph_share * 100).toFixed(1)}% of points off-graph`,
      `${Object.keys(refined).length} edges refined from measurement`,
      `${report.removal_candidates.length} edges unused where neighbours were busy`,
      `${report.unobserved_edges.length} edges unobserved (no conclusion drawn)`,
    ],
    apply: (source) => ({ ...source, edges: { ...(source.edges ?? {}), ...refined } }),
  };
  return report;
}
