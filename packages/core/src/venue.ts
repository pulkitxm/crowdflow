import type { CircuitPack, Position, Sourced } from '@crowdflow/contracts';

export const M_PER_DEG_LAT = 111132.954;
export const M_PER_DEG_LON_EQ = 111319.488;
export class Frame {
  constructor(readonly originLat: number, readonly originLon: number) {}
  get lonScale(): number { return M_PER_DEG_LON_EQ * Math.cos(this.originLat * Math.PI / 180); }
  toXY(lat: number, lon: number): [number, number] { return [(lon - this.originLon) * this.lonScale, (lat - this.originLat) * M_PER_DEG_LAT]; }
  toLatLon(x: number, y: number): [number, number] { return [this.originLat + y / M_PER_DEG_LAT, this.originLon + x / this.lonScale]; }
}
export function pointToSegmentDistance(point: Position, source: Position, destination: Position): number {
  const dx = destination.x - source.x; const dy = destination.y - source.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - source.x, point.y - source.y);
  const t = Math.max(0, Math.min(1, ((point.x - source.x) * dx + (point.y - source.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (source.x + t * dx), point.y - (source.y + t * dy));
}

export type ElementKind = 'walkable' | 'barrier' | 'grandstand' | 'parking' | 'gate' | 'crossing' | 'ignored';
export const WALKABLE_HIGHWAY = new Set(['footway', 'path', 'pedestrian', 'steps', 'service', 'track', 'cycleway', 'living_street', 'residential', 'unclassified']);
export const BARRIER_VALUES = new Set(['fence', 'wall', 'hedge', 'retaining_wall', 'guard_rail', 'kerb']);
export const PERMEABLE_BARRIER = new Set(['gate', 'entrance', 'stile', 'cycle_barrier', 'kissing_gate']);
export const DEFAULT_WIDTH_M: Record<string, number> = { footway: 2, path: 1.5, pedestrian: 6, steps: 1.8, cycleway: 2.5, service: 4.5, track: 3.5, living_street: 5, residential: 5.5, unclassified: 5 };
export function classifyWay(tags: Record<string, string>): ElementKind {
  if (tags.building === 'grandstand') return 'grandstand'; if (tags.amenity === 'parking') return 'parking';
  if (tags.barrier && BARRIER_VALUES.has(tags.barrier)) return 'barrier'; if (tags.barrier && PERMEABLE_BARRIER.has(tags.barrier)) return 'gate';
  return tags.highway && WALKABLE_HIGHWAY.has(tags.highway) ? 'walkable' : 'ignored';
}
export function widthFor(tags: Record<string, string>): Sourced {
  const raw = tags.width ?? tags.est_width; const parsed = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? { value: parsed, provenance: 'osm', note: 'OSM width tag' } : { value: DEFAULT_WIDTH_M[tags.highway ?? ''] ?? 3, provenance: 'assumed', note: `default for highway=${tags.highway ?? 'unknown'}; supersede by observation` };
}

export function renderSvg(pack: CircuitPack, track: Position[] = [], width = 1400, margin = 40): string {
  const points = [...Object.values(pack.zones ?? {}).map((zone) => zone.position), ...track]; if (!points.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y); const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const scale = (width - 2 * margin) / Math.max(maxX - minX, 1); const height = Math.trunc((maxY - minY) * scale + 2 * margin); const pixel = (point: Position): [number, number] => [margin + (point.x - minX) * scale, height - margin - (point.y - minY) * scale];
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`, '<rect width="100%" height="100%" fill="#0E1013"/>', `<title>${escapeXml(pack.name)}</title>`];
  if (track.length) out.push(`<polyline points="${track.map((point) => pixel(point).map((value) => value.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#2E343B" stroke-width="9"/>`);
  for (const edge of Object.values(pack.edges ?? {})) { const a = pack.zones?.[edge.source]; const b = pack.zones?.[edge.destination]; if (!a || !b) continue; const [x1, y1] = pixel(a.position); const [x2, y2] = pixel(b.position); out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#5A626B"/>`); }
  out.push('</svg>'); return out.join('\n');
}
function escapeXml(value: string): string { return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!); }
