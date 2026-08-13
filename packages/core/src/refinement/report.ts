import type { CircuitPack, Edge, TraceFragment } from '@crowdflow/contracts';
import { applyMeasurements, measureEdges, type EdgeMeasurement } from './capacity.js';
import { auditUsage, type EdgeUsage } from './staleness.js';
import { TraceMatcher, type MatchedFragment } from './trace.js';
import { desireLineEdges, proposeDesireLines, type DesireLine } from './desire.js';

export interface RefinementReport {
  circuit_id: string; fragments: number; matched_points: number; off_graph_points: number;
  measurements: Record<string, EdgeMeasurement>; usage: EdgeUsage[]; refined_edges: Record<string, Edge>; desire_lines: DesireLine[]; proposed_edges: Record<string, Edge>;
  off_graph_share: number; removal_candidates: EdgeUsage[]; unobserved_edges: EdgeUsage[];
  summary(): string[]; apply(pack: CircuitPack, adoptProposals?: boolean): CircuitPack;
}
export function refine(pack: CircuitPack, fragments: TraceFragment[], participation: number): RefinementReport {
  const matcher = new TraceMatcher(pack); const matched: MatchedFragment[] = fragments.map((fragment) => matcher.match(fragment));
  const on = matched.flatMap((item) => item.matches).filter((match) => match.edge_id != null).length;
  const off = matched.flatMap((item) => item.matches).filter((match) => match.edge_id == null).length;
  const measurements = measureEdges(pack, matched, participation); const usage = auditUsage(pack, matched); const refined = applyMeasurements(pack, measurements); const desireLines = proposeDesireLines(fragments, pack); const proposed = desireLineEdges(desireLines);
  const report: RefinementReport = {
    circuit_id: pack.id, fragments: fragments.length, matched_points: on, off_graph_points: off,
    measurements, usage, refined_edges: refined, desire_lines: desireLines, proposed_edges: proposed, off_graph_share: on + off ? off / (on + off) : 0,
    removal_candidates: usage.filter((item) => item.removal_candidate), unobserved_edges: usage.filter((item) => item.verdict === 'unobserved'),
    summary: () => [
      `${fragments.length} fragments, ${(report.off_graph_share * 100).toFixed(1)}% of points off-graph`,
      `${Object.keys(refined).length} edges refined from measurement`,
      `${report.removal_candidates.length} edges unused where neighbours were busy`,
      `${report.unobserved_edges.length} edges unobserved (no conclusion drawn)`,
      `${desireLines.length} desire-line findings; ${Object.keys(proposed).length} have measured support for operator adoption`,
    ],
    apply: (source, adoptProposals = false) => ({ ...source, edges: { ...(source.edges ?? {}), ...refined, ...(adoptProposals ? proposed : {}) } }),
  };
  return report;
}
