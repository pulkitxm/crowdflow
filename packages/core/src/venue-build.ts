import type {
  CircuitCapability,
  CircuitPack,
  Crossing,
  CrossingKind,
  Edge,
  Position,
  Provenance,
  Sourced,
  Zone,
  ZoneKind,
} from '@crowdflow/contracts';
import { distanceM as distance } from './positioning/geo.js';
import { round } from './statistics.js';
import {
  pointToPolylineDistanceM,
  pointToSegmentDistanceM,
  segmentToPolylineClearanceM,
  segmentToSegmentDistanceM,
} from './track-safety.js';
import { Frame, widthFor, type OsmNode, type OsmWay } from './venue.js';

export const ASSUMED_OSM_SNAP_M = 8;
export const ASSUMED_GATE_TOLERANCE_M = 12;
export const ASSUMED_MIN_EDGE_M = 3;
export const ASSUMED_SEMANTIC_ATTACH_MAX_M = 120;
export const ASSUMED_ACCESS_STUB_WIDTH_M = 4;
export const ASSUMED_TRACK_CLEARANCE_M = 12;
export const ASSUMED_TRACK_ALIGNMENT_TOLERANCE_M = 4;

export interface BuildStats {
  ways_in: number;
  ways_clipped: number;
  raw_edges: number;
  barrier_removed: number;
  gate_preserved: number;
  track_removed: number;
  grade_separated_crossings: number;
  edges_out: number;
  zones_out: number;
  simplified_away: number;
  assumed_widths: number;
  unattached: number;
}

interface BuildInput {
  circuit_id: string;
  name: string;
  geometry_source: string;
  layout_id?: string;
  capability?: CircuitCapability;
  track_length_m: number;
  altitude_m: number;
  track_clearance_m?: number;
  track_latlon: Array<[number, number]>;
  ways: OsmWay[];
  nodes: OsmNode[];
  venue_buffer_m?: number;
}

interface RawEdge {
  source: number;
  destination: number;
  length: number;
  way: OsmWay;
  geometry: Position[];
  crossing: CrossingKind | null;
}

class Snapper {
  readonly points: Position[] = [];
  private cells = new Map<string, number[]>();
  private identities = new Map<string, number>();

  constructor(readonly tolerance = ASSUMED_OSM_SNAP_M) {}

  snap(point: Position, level: string, identity?: number): number {
    const identityKey = identity == null ? null : `${level}:${identity}`;
    const identified = identityKey == null ? undefined : this.identities.get(identityKey);
    if (identified != null) return identified;
    const [cx, cy] = this.cell(point);
    if (identity == null) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const index of this.cells.get(`${level}:${cx + dx}:${cy + dy}`) ?? []) {
            if (distance(point, this.points[index]!) <= this.tolerance) return index;
          }
        }
      }
    }
    const index = this.points.length;
    this.points.push(point);
    const key = `${level}:${cx}:${cy}`;
    const values = this.cells.get(key) ?? [];
    values.push(index);
    this.cells.set(key, values);
    if (identityKey != null) this.identities.set(identityKey, index);
    return index;
  }

  private cell(point: Position): [number, number] {
    return [Math.floor(point.x / this.tolerance), Math.floor(point.y / this.tolerance)];
  }
}

export function buildPack(input: BuildInput): { pack: CircuitPack; stats: BuildStats; track: Position[] } {
  if (input.track_latlon.length < 2) throw new Error('track geometry needs at least two points');
  const stats: BuildStats = {
    ways_in: input.ways.length,
    ways_clipped: 0,
    raw_edges: 0,
    barrier_removed: 0,
    gate_preserved: 0,
    track_removed: 0,
    grade_separated_crossings: 0,
    edges_out: 0,
    zones_out: 0,
    simplified_away: 0,
    assumed_widths: 0,
    unattached: 0,
  };
  const originLat = Math.min(...input.track_latlon.map(([lat]) => lat));
  const originLon = Math.min(...input.track_latlon.map(([, lon]) => lon));
  const frame = new Frame(originLat, originLon);
  const project = ([lat, lon]: [number, number]): Position => {
    const [x, y] = frame.toXY(lat, lon);
    return { x, y };
  };
  const track = closePolyline(input.track_latlon.map(project));
  const venueBuffer = input.venue_buffer_m ?? 900;
  const trackClearance = input.track_clearance_m ?? ASSUMED_TRACK_CLEARANCE_M;
  const projected = input.ways
    .filter((way) => pedestrianAllowed(way.tags))
    .map((way) => ({ way, points: way.coords.map(project) }))
    .filter(({ points }) => {
      const keep = polylineClearance(points, track) <= venueBuffer;
      if (!keep) stats.ways_clipped += 1;
      return keep;
    });
  const gates = input.nodes.filter((node) => node.kind === 'gate').map((node) => project(node.coord));
  const barriers = projected.filter(({ way }) => way.kind === 'barrier').flatMap(({ points }) => segments(points));
  const snapper = new Snapper();
  const raw: RawEdge[] = [];

  for (const { way, points } of projected) {
    if (way.kind !== 'walkable') continue;
    const level = levelKey(way.tags);
    const ids = points.map((point, index) => snapper.snap(point, level, way.node_ids?.[index]));
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const source = ids[index]!;
      const destination = ids[index + 1]!;
      const length = distance(start, end);
      if (source === destination || length < ASSUMED_MIN_EDGE_M) continue;
      stats.raw_edges += 1;
      let preservedByGate = false;
      const blocked = barriers.some(([a, b]) => {
        if (segmentToSegmentDistanceM(start, end, a, b) !== 0) return false;
        const open = gates.some((gate) => pointToSegmentDistanceM(gate, start, end) <= ASSUMED_GATE_TOLERANCE_M);
        if (open) preservedByGate = true;
        return !open;
      });
      if (blocked) {
        stats.barrier_removed += 1;
        continue;
      }
      if (preservedByGate) stats.gate_preserved += 1;
      const clearance = segmentToPolylineClearanceM(start, end, track);
      const separated = gradeSeparation(way.tags);
      const approvedCrossing = separated != null && clearance <= ASSUMED_TRACK_ALIGNMENT_TOLERANCE_M;
      if (clearance < trackClearance && !approvedCrossing) {
        stats.track_removed += 1;
        continue;
      }
      if (approvedCrossing) stats.grade_separated_crossings += 1;
      raw.push({
        source,
        destination,
        length,
        way,
        geometry: [start, end],
        crossing: approvedCrossing ? separated : null,
      });
    }
  }

  const used = new Set(raw.flatMap((edge) => [edge.source, edge.destination]));
  const zones: Record<string, Zone> = {};
  for (const index of [...used].sort((a, b) => a - b)) {
    zones[`n${index}`] = { id: `n${index}`, kind: 'concourse', position: roundPosition(snapper.points[index]!) };
  }
  const edges: Record<string, Edge> = {};
  const crossings: Record<string, Crossing> = {};
  raw.forEach((candidate, index) => {
    const width = widthFor(candidate.way.tags);
    const id = `e${index}`;
    edges[id] = {
      id,
      source: `n${candidate.source}`,
      destination: `n${candidate.destination}`,
      length_m: round(candidate.length),
      width_m: width,
      bidirectional: true,
      geometry: candidate.geometry.map(roundPosition),
    };
    if (candidate.crossing) {
      crossings[`crossing_${id}`] = {
        id: `crossing_${id}`,
        kind: candidate.crossing,
        edge_id: id,
        throughput_per_min: {
          value: round(width.value * 60),
          provenance: 'assumed',
          note: `${candidate.crossing} capacity pending venue measurement`,
        },
        availability: { always_open: true },
      };
    }
  });

  const attach = (position: Position, id: string, kind: ZoneKind, name?: string, osmId?: string) => {
    if (!used.size || pointToPolylineDistanceM(position, track) < trackClearance) {
      stats.unattached += 1;
      return;
    }
    const candidates = [...used]
      .map((index) => ({ index, gap: distance(position, snapper.points[index]!) }))
      .filter(
        ({ index, gap }) =>
          gap <= ASSUMED_SEMANTIC_ATTACH_MAX_M &&
          segmentToPolylineClearanceM(position, snapper.points[index]!, track) >= trackClearance &&
          barriers.every(([a, b]) => segmentToSegmentDistanceM(position, snapper.points[index]!, a, b) > 0),
      )
      .sort((a, b) => a.gap - b.gap || a.index - b.index);
    const nearest = candidates[0];
    if (!nearest) {
      stats.unattached += 1;
      return;
    }
    zones[id] = {
      id,
      kind,
      position: roundPosition(position),
      ...(name ? { name } : {}),
      ...(osmId ? { osm_id: osmId } : {}),
    };
    edges[`a${id}`] = {
      id: `a${id}`,
      source: id,
      destination: `n${nearest.index}`,
      length_m: Math.max(ASSUMED_MIN_EDGE_M, round(nearest.gap)),
      width_m: { value: ASSUMED_ACCESS_STUB_WIDTH_M, provenance: 'assumed', note: 'access stub to nearest path node' },
      bidirectional: true,
      geometry: [roundPosition(position), roundPosition(snapper.points[nearest.index]!)],
    };
  };

  for (const { way, points } of projected) {
    if (way.kind !== 'grandstand' && way.kind !== 'parking') continue;
    attach(
      centroid(points),
      `${way.kind === 'grandstand' ? 'stand' : 'park'}_${way.osm_id}`,
      way.kind === 'grandstand' ? 'viewing' : 'parking',
      way.name ?? (way.kind === 'grandstand' ? 'Grandstand' : 'Car park'),
      String(way.osm_id),
    );
  }
  for (const node of input.nodes) {
    if (node.kind !== 'gate') continue;
    const position = project(node.coord);
    if (pointToPolylineDistanceM(position, track) <= venueBuffer) {
      attach(position, `gate_${node.osm_id}`, 'gate', node.name, String(node.osm_id));
    }
  }

  const protectedIds = new Set(
    Object.values(zones)
      .filter((zone) => ['gate', 'viewing', 'parking', 'exit'].includes(zone.kind))
      .map((zone) => zone.id),
  );
  for (const crossing of Object.values(crossings)) {
    const edge = edges[crossing.edge_id];
    if (!edge) continue;
    protectedIds.add(edge.source);
    protectedIds.add(edge.destination);
  }
  const simplified = simplifyGraph(zones, edges, protectedIds);
  stats.simplified_away = simplified.collapsed;
  stats.edges_out = Object.keys(simplified.edges).length;
  stats.zones_out = Object.keys(simplified.zones).length;
  stats.assumed_widths = Object.values(simplified.edges).filter((edge) => edge.width_m.provenance === 'assumed').length;
  const positions = [...Object.values(simplified.zones).map((zone) => zone.position), ...track];
  const trackX = track.map((point) => point.x);
  const trackY = track.map((point) => point.y);
  const xs = positions.map((point) => point.x);
  const ys = positions.map((point) => point.y);
  const emergencyExits = Object.values(simplified.zones)
    .filter((zone) => zone.kind === 'parking' || zone.kind === 'exit')
    .map((zone) => zone.id);
  return {
    pack: {
      id: input.circuit_id,
      name: input.name,
      geometry_source: input.geometry_source,
      layout_id: input.layout_id ?? input.circuit_id,
      capability: input.capability ?? 'venue_imported',
      track_length_m: input.track_length_m,
      altitude_m: input.altitude_m,
      track_clearance_m: {
        value: trackClearance,
        provenance: 'assumed',
        note: 'track centreline exclusion pending venue survey',
      },
      frame: {
        origin_lat: originLat,
        origin_lon: originLon,
        track_bounds_m: [
          round(Math.max(...trackX) - Math.min(...trackX), 1),
          round(Math.max(...trackY) - Math.min(...trackY), 1),
        ],
        venue_bounds_m: [
          round(Math.min(...xs), 1),
          round(Math.min(...ys), 1),
          round(Math.max(...xs), 1),
          round(Math.max(...ys), 1),
        ],
      },
      zones: simplified.zones,
      edges: simplified.edges,
      crossings,
      constraints: {
        never_route_through: [],
        never_route_edges: [],
        emergency_exits: emergencyExits,
        accessible_routes: [],
      },
    },
    stats,
    track,
  };
}

export function simplifyGraph(
  sourceZones: Record<string, Zone>,
  sourceEdges: Record<string, Edge>,
  protectedIds = new Set<string>(),
): { zones: Record<string, Zone>; edges: Record<string, Edge>; collapsed: number } {
  const zones = { ...sourceZones };
  const edges = { ...sourceEdges };
  let collapsed = 0;
  for (const id of Object.keys(zones)) {
    if (protectedIds.has(id)) continue;
    const incident = Object.values(edges).filter((edge) => edge.source === id || edge.destination === id);
    if (incident.length !== 2) continue;
    const [first, second] = incident as [Edge, Edge];
    const a = first.source === id ? first.destination : first.source;
    const b = second.source === id ? second.destination : second.source;
    if (a === b || a === id || b === id) continue;
    const length = first.length_m + second.length_m;
    const provenance: Provenance =
      first.width_m.provenance === 'assumed' || second.width_m.provenance === 'assumed'
        ? 'assumed'
        : first.width_m.provenance;
    const width: Sourced = {
      value: round((first.width_m.value * first.length_m + second.width_m.value * second.length_m) / length),
      provenance,
      note: 'length-weighted mean of merged segments',
    };
    const firstGeometry = orientedGeometry(first, a, id);
    const secondGeometry = orientedGeometry(second, id, b);
    delete edges[first.id];
    delete edges[second.id];
    const edgeId = `m${first.id}_${second.id}`;
    edges[edgeId] = {
      id: edgeId,
      source: a,
      destination: b,
      length_m: round(length),
      width_m: width,
      gradient: ((first.gradient ?? 0) + (second.gradient ?? 0)) / 2,
      bidirectional: (first.bidirectional ?? true) && (second.bidirectional ?? true),
      geometry: [...firstGeometry, ...secondGeometry.slice(1)],
    };
    delete zones[id];
    collapsed += 1;
  }
  const live = new Set(Object.values(edges).flatMap((edge) => [edge.source, edge.destination]));
  return { zones: Object.fromEntries(Object.entries(zones).filter(([id]) => live.has(id))), edges, collapsed };
}

function segments(points: Position[]): Array<[Position, Position]> {
  return points.slice(1).map((point, index) => [points[index]!, point]);
}

function closePolyline(points: Position[]): Position[] {
  const first = points[0]!;
  const last = points.at(-1)!;
  return distance(first, last) <= 1 ? points : [...points, first];
}

function polylineClearance(points: Position[], track: Position[]): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return pointToPolylineDistanceM(points[0]!, track);
  return Math.min(...segments(points).map(([start, end]) => segmentToPolylineClearanceM(start, end, track)));
}

function pedestrianAllowed(tags: Record<string, string>): boolean {
  return (
    !['no', 'private'].includes(tags.foot ?? '') &&
    !['no', 'private'].includes(tags.access ?? '') &&
    tags.highway !== 'construction' &&
    tags.highway !== 'proposed'
  );
}

function levelKey(tags: Record<string, string>): string {
  return `${tags.layer ?? '0'}:${tags.bridge ?? 'no'}:${tags.tunnel ?? 'no'}`;
}

function gradeSeparation(tags: Record<string, string>): CrossingKind | null {
  if (tags.bridge && tags.bridge !== 'no') return 'bridge';
  if (tags.tunnel && tags.tunnel !== 'no') return 'tunnel';
  return null;
}

function centroid(points: Position[]): Position {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function roundPosition(point: Position): Position {
  return { x: round(point.x), y: round(point.y) };
}

function orientedGeometry(edge: Edge, source: string, destination: string): Position[] {
  if (edge.source === source && edge.destination === destination) return edge.geometry;
  if (edge.source === destination && edge.destination === source) return [...edge.geometry].reverse();
  throw new Error(`edge ${edge.id} does not connect ${source} to ${destination}`);
}
