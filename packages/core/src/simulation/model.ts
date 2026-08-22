import type { CrowdNode, Edge, Position, TraceFragment } from '@crowdflow/contracts';
import { ASSUMED_FRAGMENT_MAX_DURATION_S, ASSUMED_ID_ROTATION_S, FREE_FLOW_SPEED_MS } from '@crowdflow/contracts';
import { Random } from '../random.js';
import { VenueGraph } from '../routing/graph.js';
import { speedAtDensity } from '../state/flow.js';
import { noiseFragment } from '../mesh/privacy.js';
import { round } from '../statistics.js';
import { positionAlongPolyline } from '../track-safety.js';

export const REROUTE_COOLDOWN_S = 45;

export interface Leg {
  zone: string;
  dwell_s: number;
  until_s?: number;
}

export interface Agent {
  id: number;
  origin: string;
  destination: string;
  at: string;
  next_zone: string | null;
  edge_id: string | null;
  progress_m: number;
  desired_speed_ms: number;
  path: string[];
  awaiting_route: boolean;
  arrived: boolean;
  stranded: boolean;
  depart_at_s: number;
  edge_path: string[];
  started: boolean;
  walk_time_s: number;
  last_route_s: number;
  complies: boolean;
  participates: boolean;
  itinerary: Leg[];
  pending_leg: Leg | null;
  dwell_until_s: number;
}

const LEG_ADVANCE_GUARD = 64;

export interface SimConfig {
  seed: number;
  tick_s: number;
  compliance: number;
  participation: number;
  speed_sigma: number;
  movement_scale: number;
  start_person_id: number;
  population_scale: number;
}
export const DEFAULT_SIM_CONFIG: SimConfig = {
  seed: 42,
  tick_s: 2,
  compliance: 0.7,
  participation: 0.18,
  speed_sigma: 0.18,
  movement_scale: 1,
  start_person_id: 0,
  population_scale: 1,
};

export class Simulation {
  readonly config: SimConfig;
  rng: Random;
  timeS = 0;
  agents: Agent[] = [];
  avoid = new Set<string>();
  prefer = new Set<string>();
  rerouteFraction = 0;
  arrivedWalkTimes: number[] = [];
  private nextId = 0;
  private tracePoints = new Map<number, Array<[number, Position]>>();
  private traceIndex = new Map<number, number>();

  constructor(
    readonly graph: VenueGraph,
    config: Partial<SimConfig> = {},
  ) {
    this.config = { ...DEFAULT_SIM_CONFIG, ...config };
    this.rng = new Random(this.config.seed);
    this.nextId = this.config.start_person_id;
  }

  addAgents(count: number, origin: string, destination: string, startS = 0, spreadS = 0): number {
    for (let i = 0; i < count; i++) {
      const speed = Math.max(0.4, this.rng.gauss(FREE_FLOW_SPEED_MS, this.config.speed_sigma));
      this.agents.push({
        id: this.nextId++,
        origin,
        destination,
        at: origin,
        next_zone: null,
        edge_id: null,
        progress_m: 0,
        desired_speed_ms: speed,
        path: [],
        edge_path: [],
        awaiting_route: false,
        arrived: false,
        stranded: false,
        depart_at_s: startS + (spreadS ? this.rng.random() * spreadS : 0),
        started: false,
        walk_time_s: 0,
        last_route_s: -1e9,
        complies: this.rng.random() < this.config.compliance,
        participates: this.rng.random() < this.config.participation,
        itinerary: [],
        pending_leg: null,
        dwell_until_s: 0,
      });
    }
    return count;
  }

  addItinerary(count: number, origin: string, legs: Leg[], startS = 0, spreadS = 0): number {
    if (!legs.length) throw new Error('an itinerary needs at least one leg');
    const first = legs[0]!;
    const added = this.addAgents(count, origin, first.zone, startS, spreadS);
    for (const agent of this.agents.slice(-added)) {
      agent.pending_leg = { ...first };
      agent.itinerary = legs.slice(1).map((leg) => ({ ...leg }));
    }
    return added;
  }

  addOne(origin: string, legs: Leg[], departAtS: number): Agent {
    if (!legs.length) throw new Error('an itinerary needs at least one leg');
    this.addItinerary(1, origin, legs, departAtS, 0);
    return this.agents[this.agents.length - 1]!;
  }

  occupantPositions(): Array<{ id: number; zone: string; position: Position; speed_ms: number; dwelling: boolean }> {
    const zones = this.graph.pack.zones ?? {};
    const out: Array<{ id: number; zone: string; position: Position; speed_ms: number; dwelling: boolean }> = [];
    for (const agent of this.agents) {
      if (agent.arrived || !agent.started) continue;
      const held = agent.dwell_until_s > 0;
      const edge = agent.edge_id ? this.graph.pack.edges?.[agent.edge_id] : undefined;
      const from = zones[agent.at]?.position;
      if (edge && !held && agent.next_zone) {
        const to = zones[agent.next_zone]?.position;
        if (from && to) {
          const share = Math.max(0, Math.min(1, agent.progress_m / Math.max(edge.length_m, 0.01)));
          out.push({
            id: agent.id, zone: agent.at, dwelling: false, speed_ms: agent.desired_speed_ms,
            position: positionOnEdge(edge, agent.at, share),
          });
          continue;
        }
      }
      if (from) out.push({ id: agent.id, zone: agent.at, position: from, speed_ms: held ? 0 : agent.desired_speed_ms, dwelling: held });
    }
    return out;
  }

  get dwelling(): number { return this.agents.filter((agent) => agent.dwell_until_s > 0 && !agent.arrived).length; }

  edgeOccupancy(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const agent of this.agents) if (agent.edge_id && !agent.arrived) counts[agent.edge_id] = (counts[agent.edge_id] ?? 0) + this.config.population_scale;
    return counts;
  }

  private plan(agent: Agent): void {
    const result = this.graph.route(
      agent.at, agent.destination, undefined,
      agent.complies ? this.avoid : undefined,
      agent.complies ? this.prefer : undefined,
    );
    agent.path = result.path.length ? result.path.slice(1) : [];
    agent.edge_path = result.edge_ids;
    agent.awaiting_route = result.path.length === 0 && agent.at !== agent.destination;
    agent.stranded = agent.awaiting_route;
    agent.last_route_s = this.timeS;
  }

  private enterNextEdge(agent: Agent): void {
    if (!agent.path.length) this.plan(agent);
    if (!agent.path.length) { agent.awaiting_route = true; agent.stranded = true; return; }
    const next = agent.path.shift()!;
    const edgeId = agent.edge_path.shift();
    const edge = edgeId ? this.graph.pack.edges?.[edgeId] : undefined;
    if (edge && ((edge.source === agent.at && edge.destination === next) || ((edge.bidirectional ?? true) && edge.destination === agent.at && edge.source === next))) {
      agent.next_zone = next; agent.edge_id = edgeId!; agent.progress_m = 0; return;
    }
    agent.path = []; this.plan(agent);
    if (!agent.path.length) { agent.awaiting_route = true; agent.stranded = true; }
  }

  private settle(agent: Agent): void {
    agent.next_zone = null; agent.edge_id = null; agent.progress_m = 0;
    if (this.holdFor(agent)) return;
    this.startNextLeg(agent);
  }

  private holdFor(agent: Agent): boolean {
    const leg = agent.pending_leg;
    agent.pending_leg = null;
    if (!leg) return false;
    const until = leg.until_s == null ? this.timeS + leg.dwell_s : Math.max(leg.until_s, this.timeS + leg.dwell_s);
    if (until <= this.timeS) return false;
    agent.dwell_until_s = until;
    return true;
  }

  private startNextLeg(agent: Agent): boolean {
    for (let guard = 0; guard < LEG_ADVANCE_GUARD; guard++) {
      const next = agent.itinerary.shift();
      if (!next) {
        agent.arrived = true;
        this.arrivedWalkTimes.push(agent.walk_time_s);
        return false;
      }
      agent.destination = next.zone;
      agent.pending_leg = next;
      agent.dwell_until_s = 0;
      agent.path = [];
      agent.edge_path = [];
      this.plan(agent);
      if (agent.at !== agent.destination) return true;
      if (this.holdFor(agent)) return false;
    }
    agent.arrived = true;
    agent.stranded = true;
    return false;
  }

  step(): void {
    const dt = this.config.tick_s;
    const occupancy = this.edgeOccupancy();
    for (const agent of this.agents) {
      if (agent.arrived) continue;
      if (agent.awaiting_route) {
        this.plan(agent);
        if (agent.awaiting_route) continue;
      }
      if (agent.dwell_until_s > 0) {
        if (this.timeS < agent.dwell_until_s) continue;
        agent.dwell_until_s = 0;
        if (!this.startNextLeg(agent)) continue;
        this.enterNextEdge(agent);
        if (agent.arrived || !agent.edge_id) continue;
      }
      if (!agent.started) {
        if (this.timeS < agent.depart_at_s) continue;
        agent.started = true;
        this.plan(agent);
        if (agent.at === agent.destination) {
          this.settle(agent);
          continue;
        }
        this.enterNextEdge(agent);
        if (agent.arrived) continue;
      }
      if (!agent.edge_id) {
        this.enterNextEdge(agent);
        if (agent.arrived || !agent.edge_id) continue;
      }
      let edge = this.graph.pack.edges?.[agent.edge_id];
      if (!edge) continue;
      const here = occupancy[agent.edge_id] ?? 1;
      const density = here / Math.max(edge.length_m * edge.width_m.value * this.graph.edgeCapacityFactor(agent.edge_id), 1);
      const speed = Math.min(agent.desired_speed_ms, speedAtDensity(density));
      agent.progress_m += speed * dt * this.config.movement_scale;
      agent.walk_time_s += dt;
      while (agent.edge_id && agent.progress_m >= edge.length_m) {
        agent.progress_m -= edge.length_m;
        agent.at = agent.next_zone ?? agent.at;
        agent.next_zone = null;
        agent.edge_id = null;
        if (agent.at === agent.destination) {
          this.settle(agent);
          break;
        }
        if (
          agent.complies &&
          this.timeS - agent.last_route_s > REROUTE_COOLDOWN_S &&
          (this.avoid.size || this.prefer.size)
        )
          this.plan(agent);
        this.enterNextEdge(agent);
        if (agent.arrived || !agent.edge_id) break;
        edge = this.graph.pack.edges?.[agent.edge_id];
        if (!edge) break;
      }
    }
    this.timeS += dt;
  }

  emit(): CrowdNode[] {
    const rng = new Random(this.config.seed ^ Math.trunc(this.timeS));
    const occupancy = this.edgeOccupancy();
    const epoch = Math.trunc(this.timeS / ASSUMED_ID_ROTATION_S);
    const out: CrowdNode[] = [];
    for (const agent of this.agents) {
      if (agent.arrived || !agent.started || !agent.participates) continue;
      if (!agent.edge_id) {
        const held = this.graph.pack.zones?.[agent.at]?.position;
        if (!held) continue;
        out.push({
          node_id: `sim-${agent.id}`,
          epoch,
          timestamp: Math.trunc(this.timeS),
          position: { x: round(held.x, 2), y: round(held.y, 2) },
          speed_ms: 0,
          heading_deg: 0,
          accuracy_m: round(rng.uniform(4, 12), 1),
          zone_id: agent.at,
        });
        continue;
      }
      const edge = this.graph.pack.edges?.[agent.edge_id];
      if (!edge) continue;
      const t = Math.min(1, agent.progress_m / Math.max(edge.length_m, Number.EPSILON));
      const exact = positionOnEdge(edge, agent.at, t);
      const position = { x: round(exact.x, 2), y: round(exact.y, 2) };
      const trace = this.tracePoints.get(agent.id) ?? [];
      trace.push([this.timeS, position]);
      const cutoff = this.timeS - ASSUMED_FRAGMENT_MAX_DURATION_S;
      while (trace.length > 2 && trace[1]![0] <= cutoff) trace.shift();
      this.tracePoints.set(agent.id, trace);
      const density = (occupancy[agent.edge_id] ?? 1) / Math.max(edge.length_m * edge.width_m.value, 1);
      out.push({
        node_id: `${agent.id.toString(16)}-${epoch}`,
        epoch,
        timestamp: this.timeS,
        position,
        speed_ms: round(Math.min(agent.desired_speed_ms, speedAtDensity(density)), 3),
        heading_deg: 0,
        accuracy_m: round(rng.uniform(4, 12), 1),
        zone_id: edge.destination,
      });
    }
    return out;
  }

  emitTraceFragments(): TraceFragment[] {
    const fragments: TraceFragment[] = [];
    for (const agentId of [...this.tracePoints.keys()].sort((a, b) => a - b)) {
      const agent = this.agents.find((item) => item.id === agentId);
      const points = this.tracePoints.get(agentId)!;
      if (!agent?.participates || points.length < 2) continue;
      const index = this.traceIndex.get(agentId) ?? 0;
      const rng = new Random(this.config.seed ^ ((agentId + 1) * 1_000_003) ^ (index * 97_409));
      fragments.push(
        noiseFragment(
          points.map(([, point]) => point),
          points[0]![0],
          points.at(-1)![0],
          rng,
          undefined,
          `sim-frag-${agentId.toString(16)}-${index.toString(16)}`,
        ),
      );
      this.traceIndex.set(agentId, index + 1);
      this.tracePoints.set(agentId, [points.at(-1)!]);
    }
    return fragments;
  }

  fork(): Simulation {
    const clone = new Simulation(this.graph, this.config);
    clone.rng = new Random(Math.trunc(this.rng.random() * 0xffffffff));
    clone.timeS = this.timeS;
    clone.nextId = this.nextId;
    clone.avoid = new Set(this.avoid);
    clone.prefer = new Set(this.prefer);
    clone.agents = this.agents.map((agent) => ({ ...agent, path: [...agent.path], edge_path: [...agent.edge_path] }));
    clone.arrivedWalkTimes = [...this.arrivedWalkTimes];
    clone.tracePoints = new Map(
      [...this.tracePoints].map(([id, points]) => [id, points.map(([time, point]) => [time, { ...point }])]),
    );
    clone.traceIndex = new Map(this.traceIndex);
    return clone;
  }

  get active(): number { return this.agents.filter((agent) => agent.started && !agent.arrived).length; }
  get arrived(): number { return this.agents.filter((agent) => agent.arrived).length; }
  get stranded(): number { return this.agents.filter((agent) => agent.stranded).length; }
  get awaitingRoute(): number { return this.agents.filter((agent) => agent.awaiting_route && !agent.arrived).length; }

  invalidateRoutes(predicate: (agent: Agent) => boolean = () => true): number {
    let affected = 0;
    for (const agent of this.agents) {
      if (agent.arrived || !predicate(agent)) continue;
      affected += 1;
      agent.path = [];
      agent.edge_path = [];
      agent.awaiting_route = false;
      agent.stranded = false;
      if (agent.edge_id && !this.graph.isEdgeAvailable(agent.edge_id)) {
        agent.edge_id = null;
        agent.next_zone = null;
        agent.progress_m = 0;
      }
    }
    return affected;
  }

  stepRoutes(): void {
    for (const agent of this.agents) {
      if (agent.arrived || !agent.started) continue;
      if (!agent.edge_id && !agent.path.length) this.plan(agent);
    }
  }
}

function positionOnEdge(edge: Edge, source: string, fraction: number): Position {
  const geometry = source === edge.source ? edge.geometry : [...edge.geometry].reverse();
  return positionAlongPolyline(geometry, fraction);
}
