import type { CircuitPack } from '@crowdflow/contracts';
import type { MatchedFragment } from './trace.js';
export type UsageVerdict = 'used' | 'unused' | 'unobserved';
export interface EdgeUsage { edge_id: string; traversals: number; neighbourhood_traversals: number; verdict: UsageVerdict; removal_candidate: boolean }
export function auditUsage(pack: CircuitPack, matched: MatchedFragment[]): EdgeUsage[] {
  const counts: Record<string, number> = {};
  for (const item of matched) for (const traversal of item.traversals) counts[traversal.edge_id] = (counts[traversal.edge_id] ?? 0) + 1;
  const byZone: Record<string, string[]> = {};
  for (const [id, edge] of Object.entries(pack.edges ?? {})) { (byZone[edge.source] ??= []).push(id); (byZone[edge.destination] ??= []).push(id); }
  return Object.entries(pack.edges ?? {}).map(([id, edge]) => {
    const neighbours = new Set([...(byZone[edge.source] ?? []), ...(byZone[edge.destination] ?? [])]); neighbours.delete(id);
    const nearby = [...neighbours].reduce((sum, neighbour) => sum + (counts[neighbour] ?? 0), 0); const mine = counts[id] ?? 0;
    const verdict: UsageVerdict = mine > 0 ? 'used' : nearby > 0 ? 'unused' : 'unobserved';
    return { edge_id: id, traversals: mine, neighbourhood_traversals: nearby, verdict, removal_candidate: verdict === 'unused' };
  }).sort((a, b) => Number(a.verdict !== 'unused') - Number(b.verdict !== 'unused') || a.edge_id.localeCompare(b.edge_id));
}
