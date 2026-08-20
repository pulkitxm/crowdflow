import type { CrowdNode, Position, TraceFragment } from '@crowdflow/contracts';
import {
  ASSUMED_FRAGMENT_MAX_DURATION_S,
  FREE_FLOW_SPEED_MS,
} from '@crowdflow/contracts';
import { Random } from '../random.js';
import { VenueGraph } from '../routing/graph.js';
import { speedAtDensity } from '../state/flow.js';
import { noiseFragment } from '../mesh/privacy.js';
import { round } from '../statistics.js';

export const REROUTE_COOLDOWN_S = 45;

export interface Agent {
  id: number; origin: string; destination: string; at: string;
  next_zone: string | null; edge_id: string | null; progress_m: number;
  desired_speed_ms: number; path: string[]; arrived: boolean; depart_at_s: number;
  started: boolean; walk_time_s: number; last_route_s: number;
  complies: boolean; participates: boolean;
}

export interface SimConfig {
  seed: number; tick_s: number; compliance: number; participation: number; speed_sigma: number;
}
export const DEFAULT_SIM_CONFIG: SimConfig = {
  seed: 42, tick_s: 2, compliance: 0.7, participation: 0.18, speed_sigma: 0.18,
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

  constructor(readonly graph: VenueGraph, config: Partial<SimConfig> = {}) {
    this.config = { ...DEFAULT_SIM_CONFIG, ...config };
    this.rng = new Random(this.config.seed);
  }

  addAgents(count: number, origin: string, destination: string, startS = 0, spreadS = 0): number {
    for (let i = 0; i < count; i++) {
      const speed = Math.max(0.4, this.rng.gauss(FREE_FLOW_SPEED_MS, this.config.speed_sigma));
      this.agents.push({
        id: this.nextId++, origin, destination, at: origin, next_zone: null, edge_id: null,
        progress_m: 0, desired_speed_ms: speed, path: [], arrived: false,
        depart_at_s: startS + (spreadS ? this.rng.random() * spreadS : 0), started: false,
        walk_time_s: 0, last_route_s: -1e9, complies: this.rng.random() < this.config.compliance,
        participates: this.rng.random() < this.config.participation,
      });
    }
    return count;
  }

  edgeOccupancy(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const agent of this.agents) if (agent.edge_id && !agent.arrived) counts[agent.edge_id] = (counts[agent.edge_id] ?? 0) + 1;
    return counts;
  }

  private plan(agent: Agent): void {
    const result = this.graph.route(
      agent.at, agent.destination, undefined,
      agent.complies ? this.avoid : undefined,
      agent.complies ? this.prefer : undefined,
    );
    agent.path = result.path.length ? result.path.slice(1) : [];
    agent.last_route_s = this.timeS;
  }

  private enterNextEdge(agent: Agent): void {
    if (!agent.path.length) this.plan(agent);
    if (!agent.path.length) { agent.arrived = true; return; }
    const next = agent.path.shift()!;
    for (const [destination, edgeId] of this.graph.neighbours(agent.at)) {
      if (destination === next) {
        agent.next_zone = next; agent.edge_id = edgeId; agent.progress_m = 0; return;
      }
    }
    agent.path = []; this.plan(agent);
    if (!agent.path.length) agent.arrived = true;
  }

  step(): void {
    const dt = this.config.tick_s;
    const occupancy = this.edgeOccupancy();
    for (const agent of this.agents) {
      if (agent.arrived) continue;
      if (!agent.started) {
        if (this.timeS < agent.depart_at_s) continue;
        agent.started = true; this.plan(agent);
        if (agent.at === agent.destination) {
          agent.arrived = true; this.arrivedWalkTimes.push(agent.walk_time_s); continue;
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
      const density = here / Math.max(edge.length_m * edge.width_m.value, 1);
      const speed = Math.min(agent.desired_speed_ms, speedAtDensity(density));
      agent.progress_m += speed * dt;
      agent.walk_time_s += dt;
      while (agent.edge_id && agent.progress_m >= edge.length_m) {
        agent.progress_m -= edge.length_m;
        agent.at = agent.next_zone ?? agent.at; agent.next_zone = null; agent.edge_id = null;
        if (agent.at === agent.destination) {
          agent.arrived = true; this.arrivedWalkTimes.push(agent.walk_time_s); break;
        }
        if (agent.complies && this.timeS - agent.last_route_s > REROUTE_COOLDOWN_S && (this.avoid.size || this.prefer.size)) this.plan(agent);
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
    const epoch = Math.trunc(this.timeS / 900);
    const out: CrowdNode[] = [];
    for (const agent of this.agents) {
      if (agent.arrived || !agent.started || !agent.edge_id || !agent.participates) continue;
      const edge = this.graph.pack.edges?.[agent.edge_id];
      if (!edge) continue;
      const source = this.graph.pack.zones?.[edge.source];
      const destination = this.graph.pack.zones?.[edge.destination];
      if (!source || !destination) continue;
      const t = Math.min(1, agent.progress_m / Math.max(edge.length_m, Number.EPSILON));
      const position = {
        x: round(source.position.x + (destination.position.x - source.position.x) * t, 2),
        y: round(source.position.y + (destination.position.y - source.position.y) * t, 2),
      };
      const trace = this.tracePoints.get(agent.id) ?? [];
      trace.push([this.timeS, position]);
      const cutoff = this.timeS - ASSUMED_FRAGMENT_MAX_DURATION_S;
      while (trace.length > 2 && trace[1]![0] <= cutoff) trace.shift();
      this.tracePoints.set(agent.id, trace);
      const density = (occupancy[agent.edge_id] ?? 1) / Math.max(edge.length_m * edge.width_m.value, 1);
      out.push({
        node_id: `${agent.id.toString(16)}-${epoch}`, epoch, timestamp: this.timeS, position,
        speed_ms: round(Math.min(agent.desired_speed_ms, speedAtDensity(density)), 3),
        heading_deg: 0, accuracy_m: round(rng.uniform(4, 12), 1), zone_id: edge.destination,
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
      fragments.push(noiseFragment(points.map(([, point]) => point), points[0]![0], points.at(-1)![0], rng, undefined, `sim-frag-${agentId.toString(16)}-${index.toString(16)}`));
      this.traceIndex.set(agentId, index + 1);
      this.tracePoints.set(agentId, [points.at(-1)!]);
    }
    return fragments;
  }

  fork(): Simulation {
    const clone = new Simulation(this.graph, this.config);
    clone.rng = new Random(Math.trunc(this.rng.random() * 0xffffffff));
    clone.timeS = this.timeS; clone.nextId = this.nextId;
    clone.avoid = new Set(this.avoid); clone.prefer = new Set(this.prefer);
    clone.agents = this.agents.map((agent) => ({ ...agent, path: [...agent.path] }));
    clone.arrivedWalkTimes = [...this.arrivedWalkTimes];
    clone.tracePoints = new Map([...this.tracePoints].map(([id, points]) => [id, points.map(([time, point]) => [time, { ...point }])]));
    clone.traceIndex = new Map(this.traceIndex);
    return clone;
  }

  get active(): number { return this.agents.filter((agent) => agent.started && !agent.arrived).length; }
  get arrived(): number { return this.agents.filter((agent) => agent.arrived).length; }
}
