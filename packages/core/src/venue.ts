import type { CircuitPack, Position, Sourced } from '@crowdflow/contracts';

export const M_PER_DEG_LAT = 111132.954;
export const M_PER_DEG_LON_EQ = 111319.488;
export class Frame {
  constructor(
    readonly originLat: number,
    readonly originLon: number,
  ) {}
  get lonScale(): number {
    return M_PER_DEG_LON_EQ * Math.cos((this.originLat * Math.PI) / 180);
  }
  toXY(lat: number, lon: number): [number, number] {
    return [(lon - this.originLon) * this.lonScale, (lat - this.originLat) * M_PER_DEG_LAT];
  }
  toLatLon(x: number, y: number): [number, number] {
    return [this.originLat + y / M_PER_DEG_LAT, this.originLon + x / this.lonScale];
  }
}
export function polylineLength(points: Position[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1)
    total += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
  return total;
}
export function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const orient = (p: Position, q: Position, r: Position) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const first = orient(c, d, a);
  const second = orient(c, d, b);
  const third = orient(a, b, c);
  const fourth = orient(a, b, d);
  return first > 0 !== second > 0 && third > 0 !== fourth > 0;
}
export function pointToSegmentDistance(point: Position, source: Position, destination: Position): number {
  const dx = destination.x - source.x;
  const dy = destination.y - source.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - source.x, point.y - source.y);
  const t = Math.max(0, Math.min(1, ((point.x - source.x) * dx + (point.y - source.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (source.x + t * dx), point.y - (source.y + t * dy));
}

export type ElementKind = 'walkable' | 'barrier' | 'grandstand' | 'parking' | 'gate' | 'crossing' | 'ignored';
export const WALKABLE_HIGHWAY = new Set([
  'footway',
  'path',
  'pedestrian',
  'steps',
  'service',
  'track',
  'cycleway',
  'living_street',
  'residential',
  'unclassified',
]);
export const BARRIER_VALUES = new Set(['fence', 'wall', 'hedge', 'retaining_wall', 'guard_rail', 'kerb']);
export const PERMEABLE_BARRIER = new Set(['gate', 'entrance', 'stile', 'cycle_barrier', 'kissing_gate']);
export const DEFAULT_WIDTH_M: Record<string, number> = {
  footway: 2,
  path: 1.5,
  pedestrian: 6,
  steps: 1.8,
  cycleway: 2.5,
  service: 4.5,
  track: 3.5,
  living_street: 5,
  residential: 5.5,
  unclassified: 5,
};
export function classifyNode(tags: Record<string, string>): ElementKind {
  if (tags.barrier && PERMEABLE_BARRIER.has(tags.barrier)) return 'gate';
  return tags.highway === 'crossing' ? 'crossing' : 'ignored';
}
export function classifyWay(tags: Record<string, string>): ElementKind {
  if (tags.building === 'grandstand') return 'grandstand';
  if (tags.amenity === 'parking') return 'parking';
  if (tags.barrier && BARRIER_VALUES.has(tags.barrier)) return 'barrier';
  if (tags.barrier && PERMEABLE_BARRIER.has(tags.barrier)) return 'gate';
  return tags.highway && WALKABLE_HIGHWAY.has(tags.highway) ? 'walkable' : 'ignored';
}
export interface OsmWay {
  osm_id: number;
  kind: ElementKind;
  coords: Array<[number, number]>;
  node_ids?: number[];
  tags: Record<string, string>;
  name?: string;
}
export interface OsmNode {
  osm_id: number;
  kind: ElementKind;
  coord: [number, number];
  tags: Record<string, string>;
  name?: string;
}
export function parseOsm(elements: Array<Record<string, any>>): { ways: OsmWay[]; nodes: OsmNode[] } {
  const ways: OsmWay[] = [];
  const nodes: OsmNode[] = [];
  for (const element of elements) {
    const tags = (element.tags ?? {}) as Record<string, string>;
    if (element.type === 'way') {
      const geometry = (element.geometry ?? []) as Array<{ lat: number; lon: number }>;
      const kind = classifyWay(tags);
      if (kind !== 'ignored' && geometry.length >= 2)
        ways.push({
          osm_id: Number(element.id),
          kind,
          coords: geometry.map((point) => [point.lat, point.lon]),
          ...(Array.isArray(element.nodes) ? { node_ids: element.nodes.map(Number) } : {}),
          tags,
          ...(tags.name ? { name: tags.name } : {}),
        });
    } else if (element.type === 'node' && typeof element.lat === 'number' && typeof element.lon === 'number') {
      const kind = classifyNode(tags);
      if (kind !== 'ignored')
        nodes.push({
          osm_id: Number(element.id),
          kind,
          coord: [element.lat, element.lon],
          tags,
          ...(tags.name ? { name: tags.name } : {}),
        });
    }
  }
  return { ways, nodes };
}
export function summariseOsm(ways: OsmWay[], nodes: OsmNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const way of ways) counts[way.kind] = (counts[way.kind] ?? 0) + 1;
  for (const node of nodes) counts[`node:${node.kind}`] = (counts[`node:${node.kind}`] ?? 0) + 1;
  return counts;
}
export function widthFor(tags: Record<string, string>): Sourced {
  const raw = tags.width ?? tags.est_width;
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(parsed)
    ? { value: parsed, provenance: 'osm', note: 'OSM width tag' }
    : {
        value: DEFAULT_WIDTH_M[tags.highway ?? ''] ?? 3,
        provenance: 'assumed',
        note: `default for highway=${tags.highway ?? 'unknown'}; supersede by observation`,
      };
}

export function renderSvg(pack: CircuitPack, track: Position[] = [], width = 1400, margin = 40): string {
  const points = [...Object.values(pack.zones ?? {}).map((zone) => zone.position), ...track];
  if (!points.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = (width - 2 * margin) / Math.max(maxX - minX, 1);
  const height = Math.trunc((maxY - minY) * scale + 2 * margin);
  const pixel = (point: Position): [number, number] => [
    margin + (point.x - minX) * scale,
    height - margin - (point.y - minY) * scale,
  ];
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    '<rect width="100%" height="100%" fill="#0E1013"/>',
    `<title>${escapeXml(pack.name)}</title>`,
  ];
  if (track.length)
    out.push(
      `<polyline points="${track
        .map((point) =>
          pixel(point)
            .map((value) => value.toFixed(1))
            .join(','),
        )
        .join(' ')}" fill="none" stroke="#2E343B" stroke-width="9"/>`,
    );
  for (const edge of Object.values(pack.edges ?? {}))
    out.push(
      `<polyline points="${edge.geometry
        .map((point) =>
          pixel(point)
            .map((value) => value.toFixed(1))
            .join(','),
        )
        .join(' ')}" fill="none" stroke="#5A626B"/>`,
    );
  out.push('</svg>');
  return out.join('\n');
}
function escapeXml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!,
  );
}
