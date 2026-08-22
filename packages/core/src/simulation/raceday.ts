import type { CircuitPack, EventProfile, Provenance, Session } from '@crowdflow/contracts';
import { VenueGraph } from '../routing/graph.js';
import { Random } from '../random.js';
import { Scenario } from './scenario.js';
import type { Leg } from './model.js';

export const DAY_S = 24 * 60 * 60;

export const MEASURED_SOURCE = 'calendar committed from Jolpica + OpenF1';
export const OPERATIONS_SOURCE = 'Silverstone published race-day operations';

export const ASSUMED_RACEDAY_OFFSET_MIN = {
  roads_inbound_open: -600,
  car_parks_open: -510,
  gates_open: -480,
  support_1: [-400, -370],
  support_2: [-330, -280],
  support_3: [-235, -170],
  demonstration: [-160, -145],
  driver_parade: [-120, -90],
  hot_laps: [-90, -65],
  ceremony: [-16, -12],
  podium: [125, 155],
  track_walk: [125, 300],
  main_stage: [180, 420],
  roads_outbound_close: 480,
} as const;

export const ASSUMED_ARRIVE_BY_ROAD_SHARE = 0.25;
export const ASSUMED_TRACK_WALK_SHARE = 0.45;
export const ASSUMED_GATE_QUEUE_S = 300;
export const ASSUMED_PARK_DWELL_S = 240;
export const ASSUMED_CONCOURSE_DWELL_S = 900;
export const ASSUMED_EARLY_LEAVER_SHARE = 0.07;
export const ASSUMED_LATE_ARRIVAL_SHARE = 0.18;
export const ASSUMED_ARRIVAL_SKEW = 2.4;
export const ASSUMED_DWELL_JITTER = 0.35;

export type RaceDayPhaseKind =
  | 'roads_inbound'
  | 'car_parks_open'
  | 'gates_open'
  | 'support_race'
  | 'demonstration'
  | 'driver_parade'
  | 'hot_laps'
  | 'ceremony'
  | 'grand_prix'
  | 'podium'
  | 'track_walk'
  | 'main_stage'
  | 'arrival'
  | 'departure';

export interface RaceDayPhase {
  id: string;
  kind: RaceDayPhaseKind;
  name: string;
  start_s: number;
  end_s: number;
  provenance: Provenance;
  source: string;
  crowd_effect: string;
}

export interface RaceDayPlan {
  circuit_id: string;
  event_name: string;
  date: string | null;
  utc_offset: string | null;
  race_start_s: number;
  race_end_s: number;
  race_provenance: Provenance;
  phases: RaceDayPhase[];
  population: number;
  scenario: Scenario;
}

function offsetSeconds(utcOffset: string | null | undefined): number {
  if (!utcOffset) return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(utcOffset.trim());
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 3600 + Number(match[3]) * 60);
}

function localSecondsOfDay(iso: string, utcOffset: string | null | undefined): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) throw new Error(`session time ${iso} is not an ISO 8601 instant`);
  const local = at / 1000 + offsetSeconds(utcOffset);
  return ((Math.round(local) % DAY_S) + DAY_S) % DAY_S;
}

function raceSession(event: EventProfile): Session {
  const race = (event.sessions ?? []).find((session) => session.kind === 'race');
  if (!race) throw new Error(`${event.circuit_id} has no race session in its committed calendar`);
  return race;
}

function zonesOfKind(pack: CircuitPack, kind: string): string[] {
  return Object.values(pack.zones ?? {}).filter((zone) => zone.kind === kind).map((zone) => zone.id).sort();
}

function reachable(graph: VenueGraph, from: string, candidates: string[]): string[] {
  const set = graph.reachable(from);
  return candidates.filter((id) => set.has(id));
}

export function raceDayPhases(event: EventProfile, utcOffset: string | null): RaceDayPhase[] {
  const race = raceSession(event);
  const raceStart = localSecondsOfDay(race.start, utcOffset);
  const raceEnd = localSecondsOfDay(race.end, utcOffset);
  const at = (minutes: number) => raceStart + minutes * 60;
  const assumed = (
    id: string,
    kind: RaceDayPhaseKind,
    name: string,
    window: readonly [number, number] | number,
    effect: string,
  ): RaceDayPhase => {
    const [from, to] = typeof window === 'number' ? [window, window] : window;
    return {
      id, kind, name, start_s: at(from), end_s: at(to),
      provenance: 'assumed', source: OPERATIONS_SOURCE, crowd_effect: effect,
    };
  };

  const O = ASSUMED_RACEDAY_OFFSET_MIN;
  return [
    assumed('roads-inbound', 'roads_inbound', 'Roads one-way inbound', [O.roads_inbound_open, O.car_parks_open], 'traffic converges on the venue; nobody inside yet'),
    assumed('car-parks', 'car_parks_open', 'Car parks open', [O.car_parks_open, O.gates_open], 'vehicles fill the parking zones; walking crowd still zero'),
    assumed('gates', 'gates_open', 'Gates open', [O.gates_open, O.support_1[0]], 'heaviest gate pressure of the day; queues form outside turnstiles'),
    assumed('support-1', 'support_race', 'Support race 1', O.support_1, 'first pull from concourse to grandstands'),
    assumed('support-2', 'support_race', 'Support race 2', O.support_2, 'grandstands fill further; concourse thins'),
    assumed('support-3', 'support_race', 'Support race 3 (feature)', O.support_3, 'strong trackside draw, then a lunch dispersal back to concourse'),
    assumed('demonstration', 'demonstration', 'Historic demonstration', O.demonstration, 'partial trackside draw between the feature race and the parade'),
    assumed('driver-parade', 'driver_parade', 'Drivers parade', O.driver_parade, 'large concourse-to-trackside surge'),
    assumed('hot-laps', 'hot_laps', 'Hot laps', O.hot_laps, 'crowd already trackside and settling into seats'),
    assumed('ceremony', 'ceremony', 'Anthem and flypast', O.ceremony, 'peak trackside density of the day'),
    {
      id: 'grand-prix', kind: 'grand_prix', name: 'Grand Prix',
      start_s: raceStart, end_s: raceEnd,
      provenance: race.end_provenance === 'measured' ? 'measured' : 'assumed',
      source: MEASURED_SOURCE,
      crowd_effect: 'crowd static and seated; concourse near empty',
    },
    assumed('podium', 'podium', 'Podium and celebration', O.podium, 'winners on the podium; the crowd holds position rather than leaving'),
    assumed('track-walk', 'track_walk', 'Track walk', O.track_walk, 'egress inverts: a large share walk onto the circuit instead of leaving'),
    assumed('main-stage', 'main_stage', 'Main stage concert', O.main_stage, 'a held crowd on site well past the flag, thinning slowly'),
    assumed('arrival-window', 'arrival', 'Arrivals (continuous)', [O.roads_inbound_open, O.driver_parade[1]], 'arrivals never stop; they are heaviest at gates-open and taper all day'),
    assumed('departure-window', 'departure', 'Departures (continuous)', [O.support_1[0], O.roads_outbound_close], 'departures never stop either; a trickle all day, then the flag and the concert set the peaks'),
  ];
}

export function raceDayPlan(
  pack: CircuitPack,
  graph: VenueGraph,
  event: EventProfile,
  utcOffset: string | null,
  population: number,
  seed = 42,
): RaceDayPlan {
  if (!Number.isSafeInteger(population) || population < 1) throw new Error('population must be a positive integer');
  const phases = raceDayPhases(event, utcOffset);
  const race = raceSession(event);
  const raceStart = localSecondsOfDay(race.start, utcOffset);
  const raceEnd = localSecondsOfDay(race.end, utcOffset);
  const phaseAt = (id: string): RaceDayPhase => {
    const found = phases.find((phase) => phase.id === id);
    if (!found) throw new Error(`no phase ${id}`);
    return found;
  };

  const stands = zonesOfKind(pack, 'viewing');
  const gates = zonesOfKind(pack, 'gate');
  const parking = zonesOfKind(pack, 'parking');
  const concourse = zonesOfKind(pack, 'concourse');
  if (!stands.length) throw new Error(`${pack.id} has no viewing zones to seat a crowd in`);
  if (!gates.length) throw new Error(`${pack.id} has no gates to admit a crowd through`);

  const rng = new Random(seed);
  const usableGates = gates.filter((gate) => reachable(graph, gate, stands).length > 0);
  if (!usableGates.length) throw new Error(`${pack.id} has no gate that reaches a viewing zone`);

  const gatesOpen = phaseAt('gates').start_s;
  const arrivalClose = phaseAt('arrival-window').end_s;
  const trackWalkEnd = phaseAt('track-walk').end_s;
  const mainStageEnd = phaseAt('main-stage').end_s;
  const jitter = (base: number) => Math.max(30, base * (1 + (rng.random() - 0.5) * 2 * ASSUMED_DWELL_JITTER));

  const scenario = new Scenario(
    'race-day',
    `${event.name}: a full race day, ${population} spectators arriving continuously, seating, celebrating and leaving`,
    [],
    DAY_S,
    seed,
  );

  scenario.populate = (sim) => {
    for (let index = 0; index < population; index++) {
      const gate = usableGates[index % usableGates.length]!;
      const standsHere = reachable(graph, gate, stands);
      if (!standsHere.length) continue;
      const concourseHere = reachable(graph, gate, concourse);
      const parkHere = reachable(graph, gate, parking);
      const stand = standsHere[Math.floor(rng.random() * standsHere.length)]!;
      const rest = concourseHere.length ? concourseHere[Math.floor(rng.random() * concourseHere.length)]! : stand;
      const byRoad = parkHere.length > 0 && rng.random() < ASSUMED_ARRIVE_BY_ROAD_SHARE;

      const late = rng.random() < ASSUMED_LATE_ARRIVAL_SHARE;
      const skew = late ? rng.random() : rng.random() ** ASSUMED_ARRIVAL_SKEW;
      const arriveAt = gatesOpen + skew * Math.max(60, arrivalClose - gatesOpen) - (byRoad ? ASSUMED_PARK_DWELL_S : 0);

      const legs: Leg[] = [];
      if (byRoad) legs.push({ zone: gate, dwell_s: jitter(ASSUMED_GATE_QUEUE_S) });
      else legs.push({ zone: rest, dwell_s: jitter(ASSUMED_CONCOURSE_DWELL_S) });
      if (byRoad) legs.push({ zone: rest, dwell_s: jitter(ASSUMED_CONCOURSE_DWELL_S) });

      if (rng.random() < ASSUMED_EARLY_LEAVER_SHARE) {
        legs.push({ zone: stand, dwell_s: jitter(45 * 60) });
        legs.push({ zone: gate, dwell_s: 0 });
        if (byRoad && parkHere.length) legs.push({ zone: parkHere[Math.floor(rng.random() * parkHere.length)]!, dwell_s: 0 });
        sim.addOne(byRoad ? parkHere[Math.floor(rng.random() * parkHere.length)]! : gate, legs, Math.max(0, arriveAt));
        continue;
      }

      legs.push({ zone: stand, dwell_s: 60, until_s: phaseAt('support-3').end_s });
      legs.push({ zone: rest, dwell_s: 60, until_s: phaseAt('driver-parade').start_s });
      legs.push({ zone: stand, dwell_s: 60, until_s: raceEnd });
      if (rng.random() < ASSUMED_TRACK_WALK_SHARE) {
        legs.push({ zone: standsHere[Math.floor(rng.random() * standsHere.length)]!, dwell_s: 60, until_s: rng.random() < 0.5 ? trackWalkEnd : mainStageEnd });
      }
      legs.push({ zone: gate, dwell_s: 0 });
      if (byRoad && parkHere.length) legs.push({ zone: parkHere[Math.floor(rng.random() * parkHere.length)]!, dwell_s: 0 });
      sim.addOne(byRoad ? parkHere[Math.floor(rng.random() * parkHere.length)]! : gate, legs, Math.max(0, arriveAt));
    }
  };

  return {
    circuit_id: pack.id,
    event_name: event.name,
    date: event.date ?? null,
    utc_offset: utcOffset,
    race_start_s: raceStart,
    race_end_s: raceEnd,
    race_provenance: race.end_provenance === 'measured' ? 'measured' : 'assumed',
    phases,
    population,
    scenario,
  };
}

export function phaseAtSecond(phases: RaceDayPhase[], secondOfDay: number): RaceDayPhase | null {
  const active = phases.filter((phase) => secondOfDay >= phase.start_s && secondOfDay < phase.end_s);
  if (!active.length) return null;
  return active.reduce((narrowest, phase) => (phase.end_s - phase.start_s < narrowest.end_s - narrowest.start_s ? phase : narrowest));
}
