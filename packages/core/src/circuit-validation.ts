import type { CircuitPack, Position } from '@crowdflow/contracts';
import { VenueGraph } from './routing/graph.js';
import { pointToPolylineDistanceM, polylineLengthM, segmentToPolylineClearanceM } from './track-safety.js';

export interface CircuitValidationReport {
  problems: string[];
  warnings: string[];
}

export function validateCircuitGeometry(pack: CircuitPack, track: Position[]): CircuitValidationReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  const clearance = pack.track_clearance_m.value;
  if (track.length < 4 || track.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    problems.push('track must contain at least four finite positions');
    return { problems, warnings };
  }
  if (pointDistance(track[0]!, track.at(-1)!) > Math.max(2, clearance)) problems.push('track centreline is not closed');
  const crossingByEdge = new Map(Object.values(pack.crossings ?? {}).map((crossing) => [crossing.edge_id, crossing]));
  for (const edge of Object.values(pack.edges ?? {})) {
    const source = pack.zones?.[edge.source];
    const destination = pack.zones?.[edge.destination];
    if (!source || !destination || edge.geometry.length < 2) continue;
    if (pointDistance(edge.geometry[0]!, source.position) > 2)
      problems.push(`edge ${edge.id}: geometry does not start at source`);
    if (pointDistance(edge.geometry.at(-1)!, destination.position) > 2)
      problems.push(`edge ${edge.id}: geometry does not end at destination`);
    const geometryLength = polylineLengthM(edge.geometry);
    if (Math.abs(geometryLength - edge.length_m) > Math.max(2, edge.length_m * 0.05))
      problems.push(`edge ${edge.id}: geometry length differs from declared length`);
    const minimum = Math.min(
      ...edge.geometry.slice(1).map((point, index) => segmentToPolylineClearanceM(edge.geometry[index]!, point, track)),
    );
    const crossing = crossingByEdge.get(edge.id);
    if (minimum < clearance && !crossing) problems.push(`edge ${edge.id}: enters track exclusion without a crossing`);
    if (crossing && minimum >= clearance) problems.push(`crossing ${crossing.id}: does not intersect track exclusion`);
    if (crossing?.kind === 'at_grade') {
      const availability = crossing.availability;
      if (!availability || availability.always_open === true || !availability.closed_when?.length)
        problems.push(`crossing ${crossing.id}: at-grade availability is not fail-closed`);
    }
  }
  for (const zone of Object.values(pack.zones ?? {})) {
    if (pointToPolylineDistanceM(zone.position, track) < clearance)
      problems.push(`zone ${zone.id}: inside track exclusion`);
  }
  const graph = new VenueGraph(pack);
  const exits = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'exit' || zone.kind === 'parking');
  const views = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'viewing');
  const gates = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'gate');
  if (!views.length) problems.push('no viewing zones');
  if (!gates.length) problems.push('no gates');
  if (!exits.length) problems.push('no exits or parking zones');
  for (const zone of views)
    if (!exits.some((exit) => graph.route(zone.id, exit.id).path.length > 1))
      problems.push(`viewing zone ${zone.id}: no egress route`);
  for (const zone of gates)
    if (!views.some((view) => graph.route(zone.id, view.id).path.length > 1))
      warnings.push(`gate ${zone.id}: no viewing route`);
  if (pack.capability === 'venue_imported') {
    const assumed = Object.values(pack.edges ?? {}).filter((edge) => edge.width_m.provenance === 'assumed').length;
    if (assumed) warnings.push(`${assumed} edge widths are assumed`);
  }
  return { problems: [...new Set(problems)].sort(), warnings: [...new Set(warnings)].sort() };
}

function pointDistance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
