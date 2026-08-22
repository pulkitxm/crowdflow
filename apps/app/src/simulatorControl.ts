import type { HazardMode, HazardRequest, HazardSeverity, HazardType, SessionRequest, SessionStatus } from '@crowdflow/contracts/wire';

export interface SimulatorConfigDraft {
  circuit_id: string;
  scenario: string;
  population: string;
  join_rate_per_s: string;
  tick_ms: string;
  duration_s: string;
  movement_scale: string;
  seed: string;
  starting_person_id: string;
  participation: string;
  compliance: string;
  speed: string;
}

export interface HazardDraft {
  hazardType: HazardType;
  severity: HazardSeverity;
  mode: HazardMode;
  capacity: string;
  radius: string;
  targetKind: 'zone' | 'gate' | 'location';
  zoneId: string;
  gateId: string;
  edgeId: string;
  locationX: string;
  locationY: string;
}

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfigDraft = {
  circuit_id: 'silverstone',
  scenario: 'egress',
  population: '20000',
  join_rate_per_s: '1000',
  tick_ms: '1000',
  duration_s: '1800',
  movement_scale: '1',
  seed: '42',
  starting_person_id: '1',
  participation: '0.18',
  compliance: '0.7',
  speed: '4',
};

export function sessionRequest(draft: SimulatorConfigDraft, options: { gates: string[]; resetBeforeStart: boolean; intervene: boolean }): SessionRequest {
  const request: SessionRequest = {
    circuit_id: draft.circuit_id,
    scenario: draft.scenario,
    population: integer(draft.population, 'Population', 1, 500000),
    join_rate_per_s: number(draft.join_rate_per_s, 'Join rate', 0.01, 100000),
    tick_ms: integer(draft.tick_ms, 'Tick interval', 20, 60000),
    duration_s: integer(draft.duration_s, 'Duration', 1, 86400),
    movement_scale: number(draft.movement_scale, 'Movement scale', 0.01, 1000),
    seed: integer(draft.seed, 'Seed', 0, 4294967295),
    starting_person_id: integer(draft.starting_person_id, 'Starting person ID', 1, Number.MAX_SAFE_INTEGER),
    participation: number(draft.participation, 'Participation', Number.EPSILON, 1),
    compliance: number(draft.compliance, 'Compliance', 0, 1),
    speed: number(draft.speed, 'Simulation speed', 0.01, 10000),
    gates: [...new Set(options.gates)],
    reset_before_start: options.resetBeforeStart,
    intervene: options.intervene,
    autostart: true,
  };
  if (request.duration_s! < request.population! / request.join_rate_per_s!) throw new Error('Duration must allow the full population to join at the selected rate');
  return request;
}

export function hazardRequest(draft: HazardDraft): HazardRequest {
  const mode = draft.hazardType === 'exit_unavailable' ? 'closed' : draft.mode;
  const location = draft.hazardType === 'walkway_blockage'
    ? { edge_id: required(draft.edgeId, 'Graph edge') }
    : draft.hazardType === 'gate_blockage'
      ? { gate_id: required(draft.gateId, 'Gate') }
      : draft.hazardType === 'exit_unavailable'
        ? { zone_id: required(draft.zoneId, 'Exit') }
        : draft.targetKind === 'gate'
          ? { gate_id: required(draft.gateId, 'Gate') }
          : draft.targetKind === 'location'
            ? { position: { x: number(draft.locationX, 'Map X', -1000000, 1000000), y: number(draft.locationY, 'Map Y', -1000000, 1000000) } }
            : { zone_id: required(draft.zoneId, 'Zone') };
  return {
    type: draft.hazardType,
    severity: draft.severity,
    mode,
    capacity_percent: mode === 'restricted' ? number(draft.capacity, 'Remaining capacity', 1, 99) : 0,
    radius_m: draft.hazardType === 'fire' ? number(draft.radius, 'Affected radius', 1, 5000) : 0,
    location,
  };
}

export function controlAvailability(lifecycle: SessionStatus, hasSession: boolean, busy: boolean) {
  return {
    start: !busy && !['starting', 'running', 'stopping'].includes(lifecycle),
    pause: !busy && lifecycle === 'running',
    resume: !busy && lifecycle === 'paused',
    stop: !busy && (lifecycle === 'running' || lifecycle === 'paused'),
    reset: !busy && hasSession && lifecycle !== 'starting' && lifecycle !== 'stopping',
  };
}

function required(value: string, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function number(value: string, label: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  return parsed;
}

function integer(value: string, label: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}
