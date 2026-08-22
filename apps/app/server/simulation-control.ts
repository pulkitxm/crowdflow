import type { SessionRequest } from '@crowdflow/contracts/wire';
import type { LoadedCircuit } from './packs.js';

export const MAX_SIMULATION_POPULATION = 500000;
export const MAX_MODELED_POPULATION = 20000;

export interface NormalizedSessionRequest {
  circuitId: string;
  scenario: string;
  population: number;
  modeledPopulation: number;
  populationScale: number;
  joinRatePerS: number;
  modeledJoinRatePerS: number;
  tickMs: number;
  durationS: number | undefined;
  movementScale: number;
  seed: number;
  startingPersonId: number;
  gates: string[];
  resetBeforeStart: boolean;
  participation: number;
  compliance: number;
  speed: number;
  intervene: boolean;
  autostart: boolean;
  origins: string[] | null;
  destination: string | null;
}

export function normalizeSessionRequest(circuit: LoadedCircuit, request: SessionRequest, defaultPopulation: number): NormalizedSessionRequest {
  const population = integer(request.population ?? defaultPopulation, 'population', 1, MAX_SIMULATION_POPULATION);
  const modeledPopulation = Math.min(population, MAX_MODELED_POPULATION);
  const populationScale = population / modeledPopulation;
  const joinRatePerS = finite(request.join_rate_per_s ?? population / 240, 'join_rate_per_s', 0.01, 100000);
  const tickMs = integer(request.tick_ms ?? (request.tick_s == null ? 2000 : request.tick_s * 1000), 'tick_ms', 20, 60000);
  const durationS = request.duration_s == null ? undefined : integer(request.duration_s, 'duration_s', 1, 86400);
  if (durationS != null && durationS < population / joinRatePerS) throw new Error('duration_s must be long enough for population at the selected join rate');
  const movementScale = finite(request.movement_scale ?? 1, 'movement_scale', 0.01, 1000);
  const seed = integer(request.seed ?? 42, 'seed', 0, 4294967295);
  const startingPersonId = integer(request.starting_person_id ?? 1, 'starting_person_id', 1, Number.MAX_SAFE_INTEGER - population);
  const participation = finite(request.participation ?? 0.18, 'participation', Number.EPSILON, 1);
  const compliance = finite(request.compliance ?? 0.7, 'compliance', 0, 1);
  const speed = finite(request.speed ?? 1, 'speed', 0.01, 10000);
  const gates = [...new Set(request.gates ?? [])];
  for (const gate of gates) {
    const zone = circuit.pack.zones?.[gate];
    if (!zone || zone.kind !== 'gate' || circuit.graph.neighbours(gate).length === 0) throw new Error(`gate ${gate} is unknown or disconnected`);
  }
  return {
    circuitId: circuit.pack.id,
    scenario: request.scenario ?? 'egress',
    population,
    modeledPopulation,
    populationScale,
    joinRatePerS,
    modeledJoinRatePerS: joinRatePerS / populationScale,
    tickMs,
    durationS,
    movementScale,
    seed,
    startingPersonId,
    gates,
    resetBeforeStart: request.reset_before_start === true,
    participation,
    compliance,
    speed,
    intervene: request.intervene ?? true,
    autostart: request.autostart === true,
    origins: request.origins ?? null,
    destination: request.destination ?? null,
  };
}

function finite(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  return value;
}

function integer(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  return value;
}
