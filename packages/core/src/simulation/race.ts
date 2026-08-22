import type { Provenance } from '@crowdflow/contracts';
import { Random } from '../random.js';

export const ASSUMED_RACE_LAPS = 52;
export const ASSUMED_RACE_LAP_S = 95;
export const ASSUMED_GRID_SIZE = 20;
export const ASSUMED_PACE_SPREAD = 0.05;
export const GRID_NOTE = 'synthetic field: no driver or team data is committed to this repo, so cars carry numbers only';

export interface RaceCar {
  number: number;
  label: string;
  position: number;
  lap: number;
  lap_progress: number;
  gap_to_leader_s: number;
  retired: boolean;
}

export interface RaceState {
  running: boolean;
  finished: boolean;
  lap: number;
  total_laps: number;
  lap_s: number;
  elapsed_s: number;
  remaining_s: number;
  leader_lap_progress: number;
  grid_provenance: Provenance;
  grid_note: string;
  cars: RaceCar[];
}

export interface RaceOptions {
  laps?: number;
  lapS?: number;
  grid?: number;
  seed?: number;
}

function pace(index: number, rng: Random): number {
  return 1 + index * (ASSUMED_PACE_SPREAD / Math.max(1, ASSUMED_GRID_SIZE - 1)) + (rng.random() - 0.5) * 0.012;
}

export function raceState(
  clockS: number,
  raceStartS: number,
  raceEndS: number,
  options: RaceOptions = {},
): RaceState {
  const laps = options.laps ?? ASSUMED_RACE_LAPS;
  const lapS = options.lapS ?? ASSUMED_RACE_LAP_S;
  const grid = options.grid ?? ASSUMED_GRID_SIZE;
  const rng = new Random(options.seed ?? 42);
  const paces = Array.from({ length: grid }, (_, index) => pace(index, rng));

  const elapsed = clockS - raceStartS;
  const running = elapsed >= 0 && clockS < raceEndS && elapsed < laps * lapS * paces[paces.length - 1]!;
  const finished = elapsed >= laps * lapS;

  const cars: RaceCar[] = paces.map((paceFactor, index) => {
    const number = index + 1;
    const covered = elapsed <= 0 ? 0 : Math.min(elapsed / (lapS * paceFactor), laps);
    const lap = Math.min(laps, Math.floor(covered) + (elapsed > 0 ? 1 : 0));
    const progress = covered <= 0 ? 0 : covered - Math.floor(covered);
    return {
      number,
      label: `CAR ${String(number).padStart(2, '0')}`,
      position: 0,
      lap: Math.max(elapsed > 0 ? 1 : 0, lap),
      lap_progress: covered >= laps ? 1 : progress,
      gap_to_leader_s: 0,
      retired: false,
    };
  });

  const distance = (car: RaceCar) => car.lap + car.lap_progress;
  const ranked = [...cars].sort((a, b) => distance(b) - distance(a) || a.number - b.number);
  const leader = ranked[0];
  for (const [index, car] of ranked.entries()) {
    car.position = index + 1;
    car.gap_to_leader_s = leader ? Number(((distance(leader) - distance(car)) * lapS).toFixed(1)) : 0;
  }

  return {
    running,
    finished,
    lap: leader ? leader.lap : 0,
    total_laps: laps,
    lap_s: lapS,
    elapsed_s: Math.max(0, Math.round(elapsed)),
    remaining_s: Math.max(0, Math.round(raceEndS - clockS)),
    leader_lap_progress: leader ? leader.lap_progress : 0,
    grid_provenance: 'assumed',
    grid_note: GRID_NOTE,
    cars: ranked,
  };
}
