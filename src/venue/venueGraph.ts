import type { VenuePoint } from '../core/contracts';

export interface VenueBounds { xMax: number; yMax: number }
export interface CoordinateTransform { originLatitude: number; originLongitude: number; rotationDegrees: number }
export interface VenueZone {
  index: number; id: string; type: string; label: string; centroid: VenuePoint;
  polygon: VenuePoint[]; capacity: number;
}
export interface VenueEdge {
  id: string; from: string; to: string; bidirectional: boolean; lengthMetres: number;
  widthMetres: number; freeFlowSpeed: number; baseRisk: number; blocked?: boolean;
}
export interface VenueDefinition {
  venueId: string; version: number; bounds: VenueBounds; coordinateTransform: CoordinateTransform;
  zones: VenueZone[]; edges: VenueEdge[];
}
export interface MapMatch { point: VenuePoint; zone: VenueZone; edgeId?: string; distanceMetres: number }

export class VenueGraph {
  readonly venueId: string;
  readonly version: number;
  readonly bounds: VenueBounds;
  readonly coordinateTransform: CoordinateTransform;
  readonly zones: VenueZone[];
  readonly edges: VenueEdge[];
  private readonly byId = new Map<string, VenueZone>();
  private readonly byIndex = new Map<number, VenueZone>();

  constructor(definition: VenueDefinition) {
    this.venueId = definition.venueId;
    this.version = definition.version;
    this.bounds = definition.bounds;
    this.coordinateTransform = definition.coordinateTransform;
    this.zones = definition.zones;
    this.edges = definition.edges;
    definition.zones.forEach((zone) => {
      if (this.byId.has(zone.id) || this.byIndex.has(zone.index)) throw new Error('zone IDs and indices must be unique');
      if (zone.polygon.length < 3 || zone.index < 0 || zone.index > 0xffff) throw new Error(`invalid zone ${zone.id}`);
      this.byId.set(zone.id, zone); this.byIndex.set(zone.index, zone);
    });
    definition.edges.forEach((edge) => {
      if (!this.byId.has(edge.from) || !this.byId.has(edge.to)) throw new Error(`unknown edge zone: ${edge.id}`);
      if (edge.lengthMetres <= 0 || edge.widthMetres <= 0) throw new Error(`invalid edge: ${edge.id}`);
    });
  }

  zone(id: string): VenueZone {
    const zone = this.byId.get(id); if (!zone) throw new Error(`unknown zone ${id}`); return zone;
  }
  zoneAtIndex(index: number): VenueZone {
    const zone = this.byIndex.get(index); if (!zone) throw new Error(`unknown zone index ${index}`); return zone;
  }
  indexOf(id: string): number { return this.zone(id).index; }
  zoneAt(point: VenuePoint): VenueZone | undefined { return this.zones.find((zone) => pointInPolygon(point, zone.polygon)); }
  nearestZone(point: VenuePoint): VenueZone {
    return this.zoneAt(point) ?? this.zones.reduce((best, zone) => distance(point, zone.centroid) < distance(point, best.centroid) ? zone : best);
  }

  mapMatch(point: VenuePoint, heading?: number, maxRadius = 25): MapMatch {
    const candidates = this.edges.map((edge) => {
      const a = this.zone(edge.from).centroid; const b = this.zone(edge.to).centroid;
      const projected = project(point, a, b); const physical = distance(point, projected);
      const edgeHeading = radiansToDegrees(Math.atan2(b.y - a.y, b.x - a.x));
      const headingPenalty = heading === undefined ? 0 : (1 - Math.abs(Math.cos(degreesToRadians(angleDifference(heading, edgeHeading))))) * 3;
      return { edge, projected, physical, score: physical + headingPenalty };
    }).sort((a, b) => a.score - b.score);
    const best = candidates[0];
    if (!best || best.physical > maxRadius) {
      const zone = this.nearestZone(point); return { point, zone, distanceMetres: distance(point, zone.centroid) };
    }
    const from = this.zone(best.edge.from); const to = this.zone(best.edge.to);
    return {
      point: best.projected,
      zone: distance(best.projected, from.centroid) <= distance(best.projected, to.centroid) ? from : to,
      edgeId: best.edge.id,
      distanceMetres: best.physical,
    };
  }

  shortestPath(start: string, destination: string, avoid = new Set<string>(), preferred = new Set<string>()): string[] {
    this.zone(start); this.zone(destination);
    if (start === destination) return [start];
    return this.dijkstra(start, destination, avoid, preferred, true) ??
      this.dijkstra(start, destination, avoid, preferred, false) ?? [];
  }

  private dijkstra(start: string, destination: string, avoid: Set<string>, preferred: Set<string>, hardAvoid: boolean): string[] | undefined {
    const costs = new Map([[start, 0]]); const previous = new Map<string, string>();
    const pending = new Set([start]);
    while (pending.size > 0) {
      const current = [...pending].reduce((a, b) => costs.get(a)! <= costs.get(b)! ? a : b); pending.delete(current);
      if (current === destination) break;
      this.outgoing(current).forEach(({ edge, next }) => {
        if (edge.blocked || (hardAvoid && avoid.has(next) && next !== destination)) return;
        const freeFlow = edge.lengthMetres / Math.max(0.1, edge.freeFlowSpeed);
        const risk = edge.baseRisk * edge.lengthMetres;
        const penalty = !hardAvoid && avoid.has(next) ? 1_000 : 0;
        const preference = preferred.has(next) ? 0.65 : 1;
        const candidate = costs.get(current)! + (freeFlow + risk) * preference + penalty;
        if (candidate < (costs.get(next) ?? Number.POSITIVE_INFINITY)) {
          costs.set(next, candidate); previous.set(next, current); pending.add(next);
        }
      });
    }
    if (!costs.has(destination)) return undefined;
    const path = [destination]; while (path[0] !== start) path.unshift(previous.get(path[0])!); return path;
  }

  private outgoing(id: string): Array<{ edge: VenueEdge; next: string }> {
    const output: Array<{ edge: VenueEdge; next: string }> = [];
    this.edges.forEach((edge) => {
      if (edge.from === id) output.push({ edge, next: edge.to });
      if (edge.bidirectional && edge.to === id) output.push({ edge, next: edge.from });
    });
    return output;
  }
}

export function pointInPolygon(point: VenuePoint, polygon: VenuePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distance(a: VenuePoint, b: VenuePoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function project(p: VenuePoint, a: VenuePoint, b: VenuePoint): VenuePoint {
  const dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy;
  if (square === 0) return a;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / square));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
function angleDifference(a: number, b: number): number { return Math.abs(((a - b + 540) % 360) - 180); }
function degreesToRadians(value: number): number { return value * Math.PI / 180; }
function radiansToDegrees(value: number): number { return value * 180 / Math.PI; }
