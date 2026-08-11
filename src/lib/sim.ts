import {
  EDGES,
  GATES,
  NODE_MAP,
  NODES,
  ZONES,
  scheduleAt,
  type VenueEdge,
} from "./venue";

export interface SimParams {
  /** total expected attendance for the day */
  crowdSize: number;
  /** gate staffing multiplier, 0.5 – 2 */
  staffing: number;
  /** walking speed / flow multiplier */
  flowRate: number;
  /** edges taken out of service, key `a|b` */
  closedEdges: string[];
  /** when on, the optimiser diverts crowds away from hot zones */
  reroutingEnabled: boolean;
}

export const DEFAULT_PARAMS: SimParams = {
  crowdSize: 92000,
  staffing: 1,
  flowRate: 1,
  closedEdges: [],
  reroutingEnabled: true,
};

export interface SimState {
  t: number;
  occupancy: Record<string, number>;
  queues: Record<string, number>;
  flows: Record<string, number>;
  admitted: number;
  exited: number;
}

export const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const SIM_END = 520;

export function createState(): SimState {
  const occupancy: Record<string, number> = {};
  for (const n of NODES) if (n.kind !== "gate") occupancy[n.id] = 0;
  const queues: Record<string, number> = {};
  for (const g of GATES) queues[g.id] = 0;
  const flows: Record<string, number> = {};
  for (const e of EDGES) flows[edgeKey(e.a, e.b)] = 0;
  return { t: 0, occupancy, queues, flows, admitted: 0, exited: 0 };
}

export function cloneState(s: SimState): SimState {
  return {
    t: s.t,
    occupancy: { ...s.occupancy },
    queues: { ...s.queues },
    flows: { ...s.flows },
    admitted: s.admitted,
    exited: s.exited,
  };
}

const noise = (t: number, seed: number) =>
  0.92 + 0.08 * Math.sin(t / 7 + seed) + 0.06 * Math.sin(t / 23 + seed * 2.7);

/** Share of the day's crowd that has arrived by minute t (soft S-curve). */
function arrivalCurve(t: number) {
  if (t > 430) return 0;
  const peak = 180;
  return Math.exp(-Math.pow((t - peak) / 150, 2));
}

const neighbours: Record<string, VenueEdge[]> = {};
for (const e of EDGES) {
  (neighbours[e.a] ||= []).push(e);
  (neighbours[e.b] ||= []).push(e);
}

export const density = (state: SimState, id: string) => {
  const node = NODE_MAP[id];
  if (!node) return 0;
  return (state.occupancy[id] ?? 0) / node.capacity;
};

export function step(state: SimState, params: SimParams, dt = 1): SimState {
  const next = cloneState(state);
  const t = state.t;
  const sched = scheduleAt(t);
  const egress = t >= 430;
  const magnets = new Set(sched.magnet);

  for (const k of Object.keys(next.flows)) next.flows[k] = 0;

  // --- Arrivals & gate admission -------------------------------------------
  const totalGateCap = GATES.reduce((s, g) => s + g.capacity, 0);
  const arrivingNow = (params.crowdSize / 260) * arrivalCurve(t) * sched.arrival * dt;
  GATES.forEach((g, i) => {
    const share = g.capacity / totalGateCap;
    next.queues[g.id] = (next.queues[g.id] ?? 0) + arrivingNow * share * noise(t, i);
    const capacityPerMin = (g.capacity / 35) * params.staffing * params.flowRate * dt;
    const admit = Math.min(next.queues[g.id]!, capacityPerMin);
    next.queues[g.id]! -= admit;
    next.admitted += admit;
    const links = (neighbours[g.id] ?? []).filter(
      (e) => !params.closedEdges.includes(edgeKey(e.a, e.b)),
    );
    const totalTp = links.reduce((s, e) => s + e.throughput, 0) || 1;
    for (const e of links) {
      const target = e.a === g.id ? e.b : e.a;
      const amount = admit * (e.throughput / totalTp);
      next.occupancy[target] = (next.occupancy[target] ?? 0) + amount;
      next.flows[edgeKey(e.a, e.b)]! += amount;
    }
  });

  // --- Internal movement ----------------------------------------------------
  const delta: Record<string, number> = {};
  for (const node of NODES) {
    if (node.kind === "gate") continue;
    const here = next.occupancy[node.id] ?? 0;
    if (here < 1) continue;
    const links = (neighbours[node.id] ?? []).filter(
      (e) => !params.closedEdges.includes(edgeKey(e.a, e.b)),
    );
    if (!links.length) continue;

    const mobile = here * 0.14 * params.flowRate * dt * (egress ? 1.8 : 1);
    const weights: { edge: VenueEdge; target: string; w: number }[] = [];
    for (const e of links) {
      const target = e.a === node.id ? e.b : e.a;
      const tNode = NODE_MAP[target];
      const isGate = !tNode || tNode.kind === "gate";
      let w = 1;
      if (isGate) {
        w = egress ? 6 : 0.05;
      } else {
        const d = density(next, target);
        w = (magnets.has(target) ? 6 : 1) * Math.max(0.05, 1 - d * (params.reroutingEnabled ? 1.6 : 0.6));
        if (magnets.has(node.id) && !egress) w *= 0.4; // people linger at the attraction
      }
      weights.push({ edge: e, target, w });
    }
    const totalW = weights.reduce((s, x) => s + x.w, 0) || 1;
    for (const { edge, target, w } of weights) {
      const wanted = mobile * (w / totalW);
      const cap = edge.throughput * dt * params.flowRate;
      const moved = Math.min(wanted, cap);
      delta[node.id] = (delta[node.id] ?? 0) - moved;
      const tNode = NODE_MAP[target];
      if (!tNode || tNode.kind === "gate") {
        next.exited += moved;
      } else {
        delta[target] = (delta[target] ?? 0) + moved;
      }
      next.flows[edgeKey(edge.a, edge.b)]! += moved;
    }
  }
  for (const [id, d] of Object.entries(delta)) {
    next.occupancy[id] = Math.max(0, (next.occupancy[id] ?? 0) + d);
  }

  next.t = t + dt;
  return next;
}

export function inside(state: SimState) {
  return Object.values(state.occupancy).reduce((s, v) => s + v, 0);
}

export function queued(state: SimState) {
  return Object.values(state.queues).reduce((s, v) => s + v, 0);
}

// --- Bottlenecks ------------------------------------------------------------

export type Severity = "ok" | "watch" | "warning" | "critical";

export function severityOf(d: number): Severity {
  if (d >= 0.95) return "critical";
  if (d >= 0.78) return "warning";
  if (d >= 0.6) return "watch";
  return "ok";
}

export interface Bottleneck {
  id: string;
  name: string;
  kind: "zone" | "walkway" | "gate";
  severity: Severity;
  load: number;
  detail: string;
  etaMinutes?: number;
}

export function detectBottlenecks(state: SimState, params: SimParams): Bottleneck[] {
  const out: Bottleneck[] = [];
  for (const n of NODES) {
    if (n.kind === "gate") continue;
    const d = density(state, n.id);
    const sev = severityOf(d);
    if (sev === "ok") continue;
    out.push({
      id: n.id,
      name: n.name,
      kind: "zone",
      severity: sev,
      load: d,
      detail: `${Math.round(state.occupancy[n.id] ?? 0).toLocaleString()} people vs ${n.capacity.toLocaleString()} comfortable capacity`,
    });
  }
  for (const e of EDGES) {
    const k = edgeKey(e.a, e.b);
    const ratio = (state.flows[k] ?? 0) / e.throughput;
    const sev = severityOf(ratio);
    if (sev === "ok" || sev === "watch") continue;
    out.push({
      id: k,
      name: `${NODE_MAP[e.a]?.name ?? e.a} → ${NODE_MAP[e.b]?.name ?? e.b}`,
      kind: "walkway",
      severity: sev,
      load: ratio,
      detail: `${Math.round(state.flows[k] ?? 0)} people/min through a ${e.throughput}/min walkway`,
    });
  }
  for (const g of GATES) {
    const q = state.queues[g.id] ?? 0;
    const waitMin = q / ((g.capacity / 35) * params.staffing * params.flowRate);
    if (waitMin < 6) continue;
    out.push({
      id: g.id,
      name: g.name,
      kind: "gate",
      severity: waitMin > 20 ? "critical" : waitMin > 12 ? "warning" : "watch",
      load: Math.min(1.4, waitMin / 20),
      detail: `${Math.round(q).toLocaleString()} waiting · ~${Math.round(waitMin)} min to clear`,
      etaMinutes: Math.round(waitMin),
    });
  }
  return out.sort((a, b) => b.load - a.load);
}

/** Roll the simulation forward without touching live state. */
export function forecast(state: SimState, params: SimParams, minutes: number) {
  let s = cloneState(state);
  const frames: SimState[] = [];
  for (let i = 0; i < minutes; i++) {
    s = step(s, params, 1);
    frames.push(s);
  }
  return frames;
}

export interface PredictedRisk {
  id: string;
  name: string;
  peak: number;
  atMinute: number;
}

export function predictRisks(state: SimState, params: SimParams, horizon = 45): PredictedRisk[] {
  const frames = forecast(state, params, horizon);
  const peaks: Record<string, { peak: number; at: number }> = {};
  frames.forEach((f, i) => {
    for (const z of [...ZONES]) {
      const d = density(f, z.id);
      const cur = peaks[z.id];
      if (!cur || d > cur.peak) peaks[z.id] = { peak: d, at: i + 1 };
    }
  });
  return Object.entries(peaks)
    .filter(([, v]) => v.peak >= 0.7)
    .map(([id, v]) => ({ id, name: NODE_MAP[id]?.name ?? id, peak: v.peak, atMinute: v.at }))
    .sort((a, b) => b.peak - a.peak);
}

// --- Routing ----------------------------------------------------------------

export interface RouteResult {
  path: string[];
  minutes: number;
  congestion: number;
}

function dijkstra(
  from: string,
  to: string,
  cost: (e: VenueEdge) => number,
  closed: string[],
): string[] {
  const dist: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const visited = new Set<string>();
  const queue = new Set<string>([from]);
  while (queue.size) {
    let best: string | null = null;
    for (const id of queue) if (best === null || (dist[id] ?? Infinity) < (dist[best] ?? Infinity)) best = id;
    if (!best) break;
    queue.delete(best);
    if (best === to) break;
    visited.add(best);
    for (const e of neighbours[best] ?? []) {
      if (closed.includes(edgeKey(e.a, e.b))) continue;
      const nb = e.a === best ? e.b : e.a;
      if (visited.has(nb)) continue;
      const nd = (dist[best] ?? Infinity) + cost(e);
      if (nd < (dist[nb] ?? Infinity)) {
        dist[nb] = nd;
        prev[nb] = best;
        queue.add(nb);
      }
    }
  }
  if (!(to in dist)) return [];
  const path = [to];
  let cur = to;
  while (cur !== from) {
    const p = prev[cur];
    if (!p) return [];
    path.unshift(p);
    cur = p;
  }
  return path;
}

const edgeLength = (e: VenueEdge) => {
  const a = NODE_MAP[e.a]!;
  const b = NODE_MAP[e.b]!;
  return Math.hypot(a.x - b.x, a.y - b.y);
};

/** ~1.3 m/s walking, 1 SVG unit ≈ 4 m */
const walkMinutes = (len: number, mult: number) => (len * 4) / (1.3 * 60) * mult;

export function routeBetween(
  state: SimState,
  params: SimParams,
  from: string,
  to: string,
): { direct: RouteResult; optimised: RouteResult } {
  const congestionOf = (e: VenueEdge) => {
    const d = Math.max(density(state, e.a), density(state, e.b));
    const flow = (state.flows[edgeKey(e.a, e.b)] ?? 0) / e.throughput;
    return Math.max(d, flow);
  };
  const build = (path: string[]): RouteResult => {
    let minutes = 0;
    let congestion = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const e = EDGES.find(
        (x) => edgeKey(x.a, x.b) === edgeKey(path[i]!, path[i + 1]!),
      );
      if (!e) continue;
      const c = congestionOf(e);
      congestion = Math.max(congestion, c);
      minutes += walkMinutes(edgeLength(e), 1 + c * 1.8);
    }
    return { path, minutes, congestion };
  };
  const direct = build(dijkstra(from, to, edgeLength, params.closedEdges));
  const optimised = build(
    dijkstra(from, to, (e) => edgeLength(e) * (1 + congestionOf(e) * 3), params.closedEdges),
  );
  return { direct, optimised };
}

export interface Recommendation {
  id: string;
  title: string;
  body: string;
  impact: string;
  severity: Severity;
}

export function recommendations(state: SimState, params: SimParams): Recommendation[] {
  const bns = detectBottlenecks(state, params).slice(0, 6);
  return bns.map((b) => {
    if (b.kind === "gate") {
      return {
        id: b.id,
        title: `Open extra lanes at ${b.name}`,
        body: `Queue is building. Redirect arriving spectators to the nearest quieter gate and add 2 scanning lanes.`,
        impact: `Est. −${Math.max(3, Math.round((b.etaMinutes ?? 8) * 0.6))} min wait`,
        severity: b.severity,
      };
    }
    if (b.kind === "walkway") {
      return {
        id: b.id,
        title: `Make ${b.name} one-way`,
        body: `Flow is above the walkway's safe throughput. Signage should push return traffic to the parallel concourse.`,
        impact: `Est. −${Math.round(b.load * 25)}% peak flow`,
        severity: b.severity,
      };
    }
    return {
      id: b.id,
      title: `Divert crowds away from ${b.name}`,
      body: `Push app notifications and dynamic signage recommending alternative viewing and concession areas.`,
      impact: `Est. −${Math.round((b.load - 0.6) * 100)}% density in 15 min`,
      severity: b.severity,
    };
  });
}
