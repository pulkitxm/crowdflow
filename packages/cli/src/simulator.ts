import type { CircuitPack, NodeReport, Position } from '@crowdflow/contracts';
import { ASSUMED_ID_ROTATION_S, LOCATION_DISCLOSURE_VERSION } from '@crowdflow/contracts';
import { Random, VenueGraph } from '@crowdflow/core';

export interface CrowdSimulatorOptions {
  api: string;
  circuitId: string;
  people: number;
  ratePerSecond: number;
  tickMs: number;
  durationS: number;
  seed: number;
  startPersonId: number;
  gates?: string[];
  onTick?: (state: CrowdSimulatorTick) => void;
}

export interface CrowdSimulatorTick {
  tick: number;
  joined: number;
  active: number;
  reports: number;
}

export interface CrowdSimulatorResult extends CrowdSimulatorTick {
  gates: string[];
  duration_s: number;
}

interface Walker {
  personId: number;
  gateId: string;
  path: Position[];
  segment: number;
  progress: number;
  speed: number;
}

export async function simulateLiveCrowd(options: CrowdSimulatorOptions): Promise<CrowdSimulatorResult> {
  validate(options);
  const api = options.api.replace(/\/$/, '');
  const geometry = await getJson<{ pack: CircuitPack }>(`${api}/api/circuits/${options.circuitId}/geometry`);
  const pack = geometry.pack;
  const graph = new VenueGraph(pack);
  const rng = new Random(options.seed);
  const gates = selectGates(pack, graph, options.gates);
  const destinations = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'viewing');
  if (!destinations.length) throw new Error(`${options.circuitId} has no viewing zones`);

  const walkers: Walker[] = [];
  const tickSeconds = options.tickMs / 1000;
  const minimumDuration = options.people / options.ratePerSecond;
  const duration = Math.max(options.durationS, minimumDuration);
  const ticks = Math.ceil(duration / tickSeconds);
  let joined = 0;
  let reports = 0;
  let spawnBudget = 0;

  for (let tick = 1; tick <= ticks; tick++) {
    spawnBudget += options.ratePerSecond * tickSeconds;
    const spawnCount = Math.min(options.people - joined, Math.floor(spawnBudget));
    spawnBudget -= spawnCount;
    const newcomers: Walker[] = [];
    for (let index = 0; index < spawnCount; index++) {
      const personId = options.startPersonId + joined + index;
      const gateId = gates[(joined + index) % gates.length]!;
      newcomers.push(buildWalker(personId, gateId, pack, graph, destinations, rng));
    }
    if (newcomers.length) {
      await postJson(`${api}/api/people/login/batch`, {
        people: newcomers.map((walker) => ({ person_id: walker.personId, circuit_id: options.circuitId })),
      });
      walkers.push(...newcomers);
      joined += newcomers.length;
    }

    const now = Date.now() / 1000;
    const batch = walkers.map((walker) => reportFor(walker, options.circuitId, now, tickSeconds));
    for (let offset = 0; offset < batch.length; offset += 1000) {
      const chunk = batch.slice(offset, offset + 1000);
      const ack = await postJson<{ accepted: number; rejected: number; problems?: string[] }>(`${api}/api/nodes/batch`, { reports: chunk });
      if (ack.rejected) throw new Error(`simulator reports rejected: ${(ack.problems ?? []).join(', ')}`);
      reports += ack.accepted;
    }

    const state = { tick, joined, active: walkers.length, reports };
    options.onTick?.(state);
    if (tick < ticks) await sleep(options.tickMs);
  }

  return { tick: ticks, joined, active: walkers.length, reports, gates, duration_s: duration };
}

function selectGates(pack: CircuitPack, graph: VenueGraph, requested?: string[]): string[] {
  if (requested?.length) {
    const unknown = requested.filter((id) => pack.zones?.[id]?.kind !== 'gate' || graph.neighbours(id).length === 0);
    if (unknown.length) throw new Error(`unknown or disconnected gates: ${unknown.join(', ')}`);
    return [...new Set(requested)];
  }
  const available = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'gate' && graph.neighbours(zone.id).length > 0).map((zone) => zone.id).sort();
  if (!available.length) throw new Error(`${pack.id} has no connected gates`);
  const count = Math.min(6, available.length);
  return Array.from({ length: count }, (_, index) => available[Math.floor(index * available.length / count)]!);
}

function buildWalker(
  personId: number,
  gateId: string,
  pack: CircuitPack,
  graph: VenueGraph,
  destinations: Array<{ id: string }>,
  rng: Random,
): Walker {
  const reachable = graph.reachable(gateId);
  const candidates = destinations.filter((zone) => reachable.has(zone.id));
  const fallback = [...reachable].filter((id) => id !== gateId);
  const targetPool = candidates.length ? candidates.map((zone) => zone.id) : fallback;
  if (!targetPool.length) throw new Error(`gate ${gateId} has nowhere to route people`);
  const target = targetPool[Math.floor(rng.random() * targetPool.length)]!;
  const route = graph.route(gateId, target);
  if (route.path.length < 2) throw new Error(`gate ${gateId} cannot route to ${target}`);
  return {
    personId,
    gateId,
    path: route.path.map((id) => pack.zones?.[id]?.position).filter((position): position is Position => position != null),
    segment: 0,
    progress: 0,
    speed: 1.05 + rng.random() * 0.65,
  };
}

function reportFor(walker: Walker, circuitId: string, now: number, deltaS: number): NodeReport {
  let remaining = walker.speed * deltaS;
  while (remaining > 0 && walker.segment < walker.path.length - 1) {
    const from = walker.path[walker.segment]!;
    const to = walker.path[walker.segment + 1]!;
    const length = Math.max(0.01, Math.hypot(to.x - from.x, to.y - from.y));
    const left = (1 - walker.progress) * length;
    if (remaining < left) {
      walker.progress += remaining / length;
      remaining = 0;
    } else {
      remaining -= left;
      walker.segment += 1;
      walker.progress = 0;
    }
  }
  const from = walker.path[Math.min(walker.segment, walker.path.length - 1)]!;
  const to = walker.path[Math.min(walker.segment + 1, walker.path.length - 1)]!;
  const position = {
    x: from.x + (to.x - from.x) * walker.progress,
    y: from.y + (to.y - from.y) * walker.progress,
  };
  const heading = (Math.atan2(to.x - from.x, to.y - from.y) * 180 / Math.PI + 360) % 360;
  const epoch = Math.floor(now / ASSUMED_ID_ROTATION_S);
  const nodeId = `sim-${walker.personId}`;
  return {
    person_id: walker.personId,
    gate_id: walker.gateId,
    node_id: nodeId,
    epoch,
    circuit_id: circuitId,
    consent_version: LOCATION_DISCLOSURE_VERSION,
    sources: ['gnss'],
    nodes: [{
      node_id: nodeId,
      epoch,
      timestamp: now,
      position,
      speed_ms: walker.segment >= walker.path.length - 1 ? 0 : walker.speed,
      heading_deg: heading,
      accuracy_m: 4,
    }],
  };
}

function validate(options: CrowdSimulatorOptions): void {
  if (!Number.isSafeInteger(options.people) || options.people < 1) throw new Error('people must be a positive integer');
  if (!(options.ratePerSecond > 0)) throw new Error('rate must be positive');
  if (!Number.isSafeInteger(options.tickMs) || options.tickMs < 20) throw new Error('tick-ms must be an integer of at least 20');
  if (!(options.durationS > 0)) throw new Error('duration must be positive');
  if (!Number.isSafeInteger(options.startPersonId) || options.startPersonId < 1) throw new Error('start-id must be a positive integer');
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`POST ${url} -> ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
