import type { CircuitPack, CrowdNode, MeshMessage, TraceFragment } from './types.js';

export class ContractValidationError extends Error {}
export function validateCrowdNode(value: CrowdNode): CrowdNode {
  if (!value.node_id) fail('node_id is required');
  if (!Number.isInteger(value.epoch) || value.epoch < 0) fail('epoch must be non-negative');
  if (!(value.speed_ms >= 0)) fail('speed_ms must be non-negative');
  if (!(value.heading_deg >= 0 && value.heading_deg < 360)) fail('heading_deg must be in [0,360)');
  if (!(value.accuracy_m > 0)) fail('accuracy_m must be positive');
  validatePosition(value.position);
  return value;
}
export function validateTraceFragment(value: TraceFragment): TraceFragment {
  if (!value.fragment_id) fail('fragment_id is required');
  if (value.points.length < 2) fail('trace needs at least two points');
  if (!(value.t_end >= value.t_start)) fail('t_end precedes t_start');
  if (!(value.epsilon > 0) || !(value.noise_radius_m > 0)) fail('privacy parameters must be positive');
  value.points.forEach(validatePosition);
  return value;
}
export function validateMeshMessage(value: MeshMessage): MeshMessage {
  if (!['state', 'uplink', 'urgent'].includes(value.traffic_class)) fail('traffic_class is required');
  if (!Number.isInteger(value.sequence) || value.sequence < 0) fail('sequence must be non-negative');
  if (!Number.isInteger(value.ttl) || value.ttl < 0) fail('ttl must be non-negative');
  return value;
}
export function validateCircuitPack(pack: CircuitPack): CircuitPack {
  const problems = circuitIntegrityProblems(pack);
  if (problems.length) fail(problems.join('; '));
  return pack;
}
export function circuitIntegrityProblems(pack: CircuitPack): string[] {
  const zones = pack.zones ?? {};
  const edges = pack.edges ?? {};
  const problems: string[] = [];
  const degree = new Map(Object.keys(zones).map((id) => [id, 0]));
  if (!pack.id || !pack.name || !pack.geometry_source || !pack.layout_id)
    problems.push('circuit identity is incomplete');
  if (!['synthetic_simulation', 'venue_imported', 'venue_reviewed'].includes(pack.capability))
    problems.push('circuit capability is invalid');
  if (!(pack.track_length_m > 0) || !Number.isFinite(pack.track_length_m))
    problems.push('track length must be finite and positive');
  if (!Number.isFinite(pack.altitude_m)) problems.push('altitude must be finite');
  if (!(pack.track_clearance_m?.value > 0) || !Number.isFinite(pack.track_clearance_m?.value))
    problems.push('track clearance must be finite and positive');
  if (!Number.isFinite(pack.frame?.origin_lat) || !Number.isFinite(pack.frame?.origin_lon))
    problems.push('frame origin must be finite');
  const bounds = pack.frame?.venue_bounds_m;
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every((value) => Number.isFinite(Number(value))) ||
    Number(bounds[2]) <= Number(bounds[0]) ||
    Number(bounds[3]) <= Number(bounds[1])
  )
    problems.push('venue bounds must be four ordered finite values');
  for (const [key, zone] of Object.entries(zones)) {
    if (zone.id !== key) problems.push(`zone ${key}: id mismatch`);
    if (!Number.isFinite(zone.position.x) || !Number.isFinite(zone.position.y))
      problems.push(`zone ${key}: position must be finite`);
    if (
      Array.isArray(bounds) &&
      bounds.length === 4 &&
      (zone.position.x < Number(bounds[0]) ||
        zone.position.y < Number(bounds[1]) ||
        zone.position.x > Number(bounds[2]) ||
        zone.position.y > Number(bounds[3]))
    )
      problems.push(`zone ${key}: outside venue bounds`);
  }
  for (const [key, edge] of Object.entries(edges)) {
    if (edge.id !== key) problems.push(`edge ${key}: id mismatch`);
    if (
      !(edge.length_m > 0) ||
      !Number.isFinite(edge.length_m) ||
      !(edge.width_m.value > 0) ||
      !Number.isFinite(edge.width_m.value)
    )
      problems.push(`edge ${key}: dimensions must be finite and positive`);
    if (edge.source === edge.destination) problems.push(`edge ${key}: self edge`);
    if (!(edge.source in zones)) problems.push(`edge ${key}: unknown source`);
    else degree.set(edge.source, degree.get(edge.source)! + 1);
    if (!(edge.destination in zones)) problems.push(`edge ${key}: unknown destination`);
    else degree.set(edge.destination, degree.get(edge.destination)! + 1);
    if (
      !Array.isArray(edge.geometry) ||
      edge.geometry.length < 2 ||
      edge.geometry.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    )
      problems.push(`edge ${key}: geometry must contain finite positions`);
  }
  for (const [id, count] of degree) if (count === 0) problems.push(`zone ${id}: orphaned`);
  for (const [key, crossing] of Object.entries(pack.crossings ?? {})) {
    if (crossing.id !== key) problems.push(`crossing ${key}: id mismatch`);
    if (!(crossing.edge_id in edges)) problems.push(`crossing ${key}: unknown edge`);
  }
  for (const exit of pack.constraints?.emergency_exits ?? [])
    if (!(exit in zones)) problems.push(`emergency exit ${exit}: unknown zone`);
  for (const edge of pack.constraints?.never_route_edges ?? [])
    if (!(edge in edges)) problems.push(`forbidden edge ${edge}: unknown edge`);
  return problems;
}
function validatePosition(position: { x: number; y: number }): void {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) fail('position must be finite');
}
function fail(message: string): never {
  throw new ContractValidationError(message);
}
