import { ASSUMED_UPLINK_BATTERY_RESERVE, MESH_TTL_MAX } from '@crowdflow/contracts';

export interface UplinkCandidate { node_id: string; online: boolean; battery: number; throughput_kbps: number; peer_degree: number }
export interface Election { assignments: Record<string, string>; uplinks: string[]; unserved: Set<string>[]; served_fraction: number }

export function radioNeighbours(nodes: { id: string; position: { x: number; y: number } }[], rangeM: number): Record<string, Set<string>> {
  const adjacency: Record<string, Set<string>> = Object.fromEntries(nodes.map((node) => [node.id, new Set<string>()]));
  for (let i = 0; i < nodes.length; i += 1) for (let j = i + 1; j < nodes.length; j += 1) {
    const a = nodes[i]!; const b = nodes[j]!; const dx = a.position.x - b.position.x; const dy = a.position.y - b.position.y;
    if (dx * dx + dy * dy <= rangeM * rangeM) { adjacency[a.id]!.add(b.id); adjacency[b.id]!.add(a.id); }
  }
  return adjacency;
}

export function components(adjacency: Record<string, Set<string>>): Set<string>[] {
  const remaining = new Set(Object.keys(adjacency)); const result: Set<string>[] = [];
  while (remaining.size) {
    const first = [...remaining].sort()[0]!; remaining.delete(first); const island = new Set([first]); const frontier = [first];
    while (frontier.length) { const current = frontier.pop()!; for (const peer of [...(adjacency[current] ?? [])].sort()) if (!island.has(peer)) { island.add(peer); remaining.delete(peer); frontier.push(peer); } }
    result.push(island);
  }
  return result;
}

export function electUplinks(candidates: UplinkCandidate[], adjacency: Record<string, Set<string>>): Election {
  const byId = new Map(candidates.map((candidate) => [candidate.node_id, candidate])); const assignments: Record<string, string> = {}; const uplinks: string[] = []; const unserved: Set<string>[] = [];
  for (const island of components(adjacency)) {
    const eligible = [...island].map((id) => byId.get(id)).filter((candidate): candidate is UplinkCandidate => Boolean(candidate?.online && candidate.battery >= ASSUMED_UPLINK_BATTERY_RESERVE));
    eligible.sort((a, b) => b.throughput_kbps - a.throughput_kbps || b.peer_degree - a.peer_degree || b.battery - a.battery || a.node_id.localeCompare(b.node_id));
    const winner = eligible[0]; if (!winner) { unserved.push(island); continue; } uplinks.push(winner.node_id); for (const id of island) assignments[id] = winner.node_id;
  }
  const total = Object.keys(assignments).length + unserved.reduce((sum, island) => sum + island.size, 0);
  return { assignments, uplinks, unserved, served_fraction: total ? Object.keys(assignments).length / total : 0 };
}

export interface Coverage { covered_nodes: Set<string>; uncovered_nodes: Set<string>; covered_zones: Set<string>; uncovered_zones: Set<string>; node_fraction: number; zone_fraction: number; max_hops: number }
export function meshCoverage(adjacency: Record<string, Set<string>>, uplinks: Iterable<string>, zoneOf: Record<string, string> = {}, maxHops = MESH_TTL_MAX): Coverage {
  const queue: [string, number][] = [...uplinks].filter((id) => id in adjacency).map((id) => [id, 0]); const covered = new Set(queue.map(([id]) => id));
  while (queue.length) { const [current, depth] = queue.shift()!; if (depth >= maxHops) continue; for (const peer of adjacency[current] ?? []) if (!covered.has(peer)) { covered.add(peer); queue.push([peer, depth + 1]); } }
  const all = new Set(Object.keys(adjacency)); const uncovered = new Set([...all].filter((id) => !covered.has(id))); const coveredZones = new Set([...covered].map((id) => zoneOf[id]).filter((id): id is string => id != null)); const allZones = new Set([...all].map((id) => zoneOf[id]).filter((id): id is string => id != null)); const uncoveredZones = new Set([...allZones].filter((id) => !coveredZones.has(id)));
  return { covered_nodes: covered, uncovered_nodes: uncovered, covered_zones: coveredZones, uncovered_zones: uncoveredZones, node_fraction: all.size ? covered.size / all.size : 0, zone_fraction: allZones.size ? coveredZones.size / allZones.size : 0, max_hops: maxHops };
}
