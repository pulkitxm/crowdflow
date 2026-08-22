import type { CircuitPack, ZoneState } from '@crowdflow/contracts';
import { ASSUMED_ROUTE_CACHE_ENTRIES, FREE_FLOW_SPEED_MS, isOpenDuring, isTrustworthy } from '@crowdflow/contracts';
import { MIN_SPEED_MS } from '../state/flow.js';

export const CONGESTION_WEIGHT = 2.5;
export const CRITICAL_WEIGHT = 12;
export const UNTRUSTED_WIDTH_PENALTY = 1.15;
export const AVOID_PENALTY = 25;
export const PREFER_DISCOUNT = 0.6;

export interface RouteResult {
  path: string[];
  edge_ids: string[];
  cost_s: number;
  distance_m: number;
  eta_s: number;
  rejected_reason?: string;
}

export interface OperationalRestrictions {
  closedEdges?: Iterable<string>;
  closedZones?: Iterable<string>;
  edgeCapacity?: Iterable<[string, number]>;
  zoneCapacity?: Iterable<[string, number]>;
}

type CacheKey = string;

export class VenueGraph {
  readonly pack: CircuitPack;
  sessionState: string | null;
  cacheHits = 0;
  cacheMisses = 0;
  private adjacency = new Map<string, Array<[string, string]>>();
  private closed = new Set<string>();
  private forbidden = new Set<string>();
  private forbiddenEdges = new Set<string>();
  private operationalClosedEdges = new Set<string>();
  private operationalClosedZones = new Set<string>();
  private edgeCapacityFactors = new Map<string, number>();
  private zoneCapacityFactors = new Map<string, number>();
  private cache = new Map<CacheKey, RouteResult>();
  private operationalRevision = 0;

  constructor(pack: CircuitPack, sessionState: string | null = null) {
    this.pack = pack;
    this.sessionState = sessionState;
    this.rebuild(sessionState);
  }

  rebuild(sessionState: string | null): void {
    this.sessionState = sessionState;
    this.cache.clear();
    this.closed.clear();
    for (const crossing of Object.values(this.pack.crossings ?? {})) {
      if (!isOpenDuring(crossing.availability ?? {}, sessionState)) this.closed.add(crossing.edge_id);
    }
    this.forbidden = new Set(this.pack.constraints?.never_route_through ?? []);
    this.forbiddenEdges = new Set(this.pack.constraints?.never_route_edges ?? []);
    this.adjacency = new Map(Object.keys(this.pack.zones ?? {}).map((id) => [id, []]));
    for (const [id, edge] of Object.entries(this.pack.edges ?? {})) {
      if (
        this.closed.has(id) ||
        this.forbiddenEdges.has(id) ||
        this.forbidden.has(edge.source) ||
        this.forbidden.has(edge.destination)
      )
        continue;
      this.adjacency.get(edge.source)?.push([edge.destination, id]);
      if (edge.bidirectional ?? true) this.adjacency.get(edge.destination)?.push([edge.source, id]);
    }
  }

  get routeCacheSize(): number { return this.cache.size; }
  get closedEdges(): Set<string> { return new Set(this.closed); }
  get forbiddenZones(): Set<string> { return new Set(this.forbidden); }
  get restrictionsRevision(): number { return this.operationalRevision; }

  setOperationalRestrictions(restrictions: OperationalRestrictions): void {
    this.operationalClosedEdges = new Set(restrictions.closedEdges ?? []);
    this.operationalClosedZones = new Set(restrictions.closedZones ?? []);
    this.edgeCapacityFactors = new Map(restrictions.edgeCapacity ?? []);
    this.zoneCapacityFactors = new Map(restrictions.zoneCapacity ?? []);
    for (const factor of [...this.edgeCapacityFactors.values(), ...this.zoneCapacityFactors.values()]) {
      if (!(factor > 0 && factor <= 1)) throw new Error('capacity factors must be in (0, 1]');
    }
    this.operationalRevision += 1;
    this.cache.clear();
  }

  operationalState(): { closed_edges: string[]; closed_zones: string[]; edge_capacity: Record<string, number>; zone_capacity: Record<string, number> } {
    return {
      closed_edges: [...this.operationalClosedEdges].sort(),
      closed_zones: [...this.operationalClosedZones].sort(),
      edge_capacity: Object.fromEntries([...this.edgeCapacityFactors].sort(([a], [b]) => a.localeCompare(b))),
      zone_capacity: Object.fromEntries([...this.zoneCapacityFactors].sort(([a], [b]) => a.localeCompare(b))),
    };
  }

  isEdgeAvailable(edgeId: string): boolean { return !this.closed.has(edgeId) && !this.operationalClosedEdges.has(edgeId); }
  isZoneAvailable(zoneId: string): boolean { return !this.forbidden.has(zoneId) && !this.operationalClosedZones.has(zoneId); }
  edgeCapacityFactor(edgeId: string): number {
    const edge = this.pack.edges?.[edgeId];
    if (!edge) return 0;
    return Math.min(this.edgeCapacityFactors.get(edgeId) ?? 1, this.zoneCapacityFactors.get(edge.source) ?? 1, this.zoneCapacityFactors.get(edge.destination) ?? 1);
  }

  neighbours(zoneId: string): Array<[string, string]> {
    return this.adjacency.get(zoneId) ?? [];
  }

  edgeCost(edgeId: string, states?: Record<string, ZoneState>, avoid?: Set<string>): [number, number] {
    const edge = this.pack.edges?.[edgeId];
    if (!edge || !this.isEdgeAvailable(edgeId)) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const state = states?.[edge.destination] ?? states?.[edge.source];
    const speed = state
      ? Math.max(MIN_SPEED_MS, state.mean_speed_ms)
      : (edge.free_speed_ms?.value ?? FREE_FLOW_SPEED_MS);
    let cost = edge.length_m / speed;
    const travel = cost;
    if (state?.band === 'building') cost *= CONGESTION_WEIGHT;
    else if (state?.band === 'critical') cost *= CRITICAL_WEIGHT;
    if (!isTrustworthy(edge.width_m)) cost *= UNTRUSTED_WIDTH_PENALTY;
    if (avoid?.has(edge.source) || avoid?.has(edge.destination)) cost *= AVOID_PENALTY;
    cost /= this.edgeCapacityFactor(edgeId);
    return [cost, travel];
  }

  route(
    origin: string,
    destination: string,
    states?: Record<string, ZoneState>,
    avoid?: Set<string>,
    prefer?: Set<string>,
    crossingDeadlines?: Record<string, number>,
  ): RouteResult {
    if (states != null || (crossingDeadlines && Object.keys(crossingDeadlines).length > 0)) {
      return this.search(origin, destination, states, avoid, prefer, crossingDeadlines);
    }
    const key = JSON.stringify([origin, destination, [...(avoid ?? [])].sort(), [...(prefer ?? [])].sort()]);
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheHits += 1;
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { ...cached, path: [...cached.path], edge_ids: [...cached.edge_ids] };
    }
    this.cacheMisses += 1;
    const result = this.search(origin, destination, undefined, avoid, prefer, undefined);
    this.cache.set(key, result);
    if (this.cache.size > ASSUMED_ROUTE_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest != null) this.cache.delete(oldest);
    }
    return { ...result, path: [...result.path], edge_ids: [...result.edge_ids] };
  }

  private search(
    origin: string,
    destination: string,
    states?: Record<string, ZoneState>,
    avoid?: Set<string>,
    prefer?: Set<string>,
    deadlines?: Record<string, number>,
  ): RouteResult {
    const zones = this.pack.zones ?? {};
    if (!(origin in zones))
      return {
        path: [],
        edge_ids: [],
        cost_s: Infinity,
        distance_m: 0,
        eta_s: 0,
        rejected_reason: `unknown origin ${origin}`,
      };
    if (!(destination in zones))
      return {
        path: [],
        edge_ids: [],
        cost_s: Infinity,
        distance_m: 0,
        eta_s: 0,
        rejected_reason: `unknown destination ${destination}`,
      };
    if (!this.isZoneAvailable(destination))
      return {
        path: [],
        edge_ids: [],
        cost_s: Infinity,
        distance_m: 0,
        eta_s: 0,
        rejected_reason: `destination ${destination} is unavailable`,
      };
    if (origin === destination) return { path: [origin], edge_ids: [], cost_s: 0, distance_m: 0, eta_s: 0 };

    const best = new Map([[origin, 0]]);
    const elapsed = new Map([[origin, 0]]);
    const distance = new Map([[origin, 0]]);
    const came = new Map<string, [string, string]>();
    const queue: Array<[number, string]> = [[0, origin]];
    const seen = new Set<string>();

    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
      const [, node] = queue.shift()!;
      if (seen.has(node)) continue;
      seen.add(node);
      if (node === destination) break;
      for (const [next, edgeId] of this.neighbours(node)) {
        if (seen.has(next) || !this.isEdgeAvailable(edgeId) || !this.isZoneAvailable(next)) continue;
        let [cost, travel] = this.edgeCost(edgeId, states, avoid);
        if (prefer?.has(edgeId) || prefer?.has(next)) cost *= PREFER_DISCOUNT;
        const arrival = (elapsed.get(node) ?? 0) + travel;
        if (deadlines?.[edgeId] != null && arrival > deadlines[edgeId]!) continue;
        const candidate = (best.get(node) ?? Infinity) + cost;
        if (candidate < (best.get(next) ?? Infinity)) {
          best.set(next, candidate);
          elapsed.set(next, arrival);
          const edge = this.pack.edges?.[edgeId];
          distance.set(next, (distance.get(node) ?? 0) + (edge?.length_m ?? 0));
          came.set(next, [node, edgeId]);
          queue.push([candidate, next]);
        }
      }
    }

    if (!best.has(destination))
      return {
        path: [],
        edge_ids: [],
        cost_s: Infinity,
        distance_m: 0,
        eta_s: 0,
        rejected_reason: 'no path under current conditions',
      };
    const path = [destination];
    const edgeIds: string[] = [];
    while (path.at(-1) !== origin) {
      const [previous, edgeId] = came.get(path.at(-1)!)!;
      path.push(previous);
      edgeIds.push(edgeId);
    }
    path.reverse();
    edgeIds.reverse();
    return {
      path,
      edge_ids: edgeIds,
      cost_s: best.get(destination)!,
      distance_m: distance.get(destination)!,
      eta_s: elapsed.get(destination)!,
    };
  }

  reachable(origin: string): Set<string> {
    const found = new Set([origin]);
    const stack = [origin];
    while (stack.length) {
      for (const [next] of this.neighbours(stack.pop()!)) {
        if (!found.has(next)) {
          found.add(next);
          stack.push(next);
        }
      }
    }
    return found;
  }
}
