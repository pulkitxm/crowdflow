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
  movementScale?: number;
  reset?: boolean;
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
  reset: boolean;
  removed: number;
}

interface Walker {
  personId: number;
  gateId: string;
  path: Position[];
  segment: number;
  progress: number;
  speed: number;
  lateralOffset: number;
  destinationOffset: Position;
}

export async function simulateLiveCrowd(options: CrowdSimulatorOptions): Promise<CrowdSimulatorResult> {
  validate(options);
  const api = options.api.replace(/\/$/, '');
  const reset = options.reset === true;
  const removed = reset
    ? (await deleteJson<{ removed: number }>(`${api}/api/circuits/${options.circuitId}/people`)).removed
    : 0;
  const geometry = await getJson<{ pack: CircuitPack }>(`${api}/api/circuits/${options.circuitId}/geometry`);
  const pack = geometry.pack;
  const graph = new VenueGraph(pack);
  const rng = new Random(options.seed);
  const destinations = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'viewing').sort((a, b) => a.id.localeCompare(b.id));
  if (!destinations.length) throw new Error(`${options.circuitId} has no viewing zones`);
  const gates = selectGates(pack, graph, destinations, options.gates);

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
    const batch = walkers.map((walker) => reportFor(walker, options.circuitId, now, tickSeconds, options.movementScale ?? 90));
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

  return { tick: ticks, joined, active: walkers.length, reports, gates, duration_s: duration, reset, removed };
}

function selectGates(pack: CircuitPack, graph: VenueGraph, destinations: Array<{ id: string }>, requested?: string[]): string[] {
  const reachesViewing = (id: string) => {
    const reachable = graph.reachable(id);
    return destinations.some((zone) => reachable.has(zone.id));
  };
  if (requested?.length) {
    const unknown = requested.filter((id) => pack.zones?.[id]?.kind !== 'gate' || graph.neighbours(id).length === 0 || !reachesViewing(id));
    if (unknown.length) throw new Error(`unknown gates or gates without a viewing route: ${unknown.join(', ')}`);
    return [...new Set(requested)];
  }
  const available = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'gate' && graph.neighbours(zone.id).length > 0 && reachesViewing(zone.id)).map((zone) => zone.id).sort();
  if (!available.length) throw new Error(`${pack.id} has no gates connected to viewing zones`);
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
  if (!candidates.length) throw new Error(`gate ${gateId} has no route to a viewing zone`);
  const target = candidates[personId % candidates.length]!.id;
  const route = graph.route(gateId, target);
  if (route.path.length < 2) throw new Error(`gate ${gateId} cannot route to ${target}`);
  const angle = rng.random() * Math.PI * 2;
  const radius = 8 + Math.sqrt(rng.random()) * 24;
  return {
    personId,
    gateId,
    path: route.path.map((id) => pack.zones?.[id]?.position).filter((position): position is Position => position != null),
    segment: 0,
    progress: 0,
    speed: 1.05 + rng.random() * 0.65,
    lateralOffset: (rng.random() - 0.5) * 8,
    destinationOffset: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
  };
}

function reportFor(walker: Walker, circuitId: string, now: number, deltaS: number, movementScale: number): NodeReport {
  let remaining = walker.speed * deltaS * movementScale;
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
  const arrived = walker.segment >= walker.path.length - 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const position = arrived
    ? { x: from.x + walker.destinationOffset.x, y: from.y + walker.destinationOffset.y }
    : {
        x: from.x + dx * walker.progress - dy / Math.max(length, 0.01) * walker.lateralOffset,
        y: from.y + dy * walker.progress + dx / Math.max(length, 0.01) * walker.lateralOffset,
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
      speed_ms: arrived ? 0 : walker.speed,
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
  if (options.movementScale != null && !(options.movementScale > 0)) throw new Error('movement-scale must be positive');
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

async function deleteJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) throw new Error(`DELETE ${url} -> ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
