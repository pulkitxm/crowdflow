import { describe, expect, it } from 'vitest';
import { raceState, ASSUMED_RACE_LAPS } from '../src/index.js';

const START = 15 * 3600;
const END = 17 * 3600;

describe('race state', () => {
  it('has not started before the flag drops', () => {
    const race = raceState(START - 60, START, END);
    expect(race.running).toBe(false);
    expect(race.lap).toBe(0);
    expect(race.cars.every((car) => car.lap_progress === 0)).toBe(true);
  });

  it('counts laps and spreads the field as the race runs', () => {
    const race = raceState(START + 20 * 95, START, END);
    expect(race.running).toBe(true);
    expect(race.lap).toBeGreaterThan(1);
    expect(race.total_laps).toBe(ASSUMED_RACE_LAPS);
    expect(race.cars).toHaveLength(20);
    expect(race.cars[0]!.position).toBe(1);
    expect(race.cars[0]!.gap_to_leader_s).toBe(0);
    expect(race.cars.at(-1)!.gap_to_leader_s).toBeGreaterThan(0);
    expect(race.cars.every((car) => car.lap_progress >= 0 && car.lap_progress <= 1)).toBe(true);
  });

  it('labels the field as assumed because no driver data is committed', () => {
    const race = raceState(START + 100, START, END);
    expect(race.grid_provenance).toBe('assumed');
    expect(race.grid_note).toContain('no driver');
    expect(race.cars[0]!.label).toMatch(/^CAR \d\d$/);
  });

  it('finishes once the leader completes the distance', () => {
    const race = raceState(START + ASSUMED_RACE_LAPS * 95 + 10, START, END);
    expect(race.finished).toBe(true);
    expect(race.lap).toBe(ASSUMED_RACE_LAPS);
  });

  it('is deterministic for the same seed', () => {
    const a = raceState(START + 500, START, END, { seed: 7 });
    const b = raceState(START + 500, START, END, { seed: 7 });
    expect(a.cars.map((c) => c.gap_to_leader_s)).toEqual(b.cars.map((c) => c.gap_to_leader_s));
  });
});
