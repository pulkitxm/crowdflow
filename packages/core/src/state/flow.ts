import {
  FREE_FLOW_SPEED_MS,
  JAM_DENSITY_PERSONS_M2,
} from '@crowdflow/contracts';

export const MIN_SPEED_MS = 0.05;

export function density(people: number, lengthM: number, widthM: number): number {
  return Math.max(0, people) / Math.max(lengthM * widthM, Number.EPSILON);
}

export function speedAtDensity(
  personsM2: number,
  freeSpeedMs = FREE_FLOW_SPEED_MS,
  jamDensity = JAM_DENSITY_PERSONS_M2,
): number {
  if (personsM2 <= 0) return freeSpeedMs;
  const ratio = Math.min(1, personsM2 / jamDensity);
  return Math.max(MIN_SPEED_MS, freeSpeedMs * (1 - ratio));
}

export function flowRate(personsM2: number, speedMs: number): number {
  return Math.max(0, personsM2) * Math.max(0, speedMs) * 60;
}

export function flowFromOccupancy(
  people: number,
  lengthM: number,
  widthM: number,
  speedMs?: number,
): [density: number, speed: number, flow: number] {
  const d = Math.min(density(people, lengthM, widthM), JAM_DENSITY_PERSONS_M2);
  const modelSpeed = speedAtDensity(d);
  const speed = speedMs == null
    ? modelSpeed
    : Math.min(Math.max(MIN_SPEED_MS, speedMs), modelSpeed);
  return [d, speed, flowRate(d, speed)];
}

export function queueExcess(people: number, lengthM: number, widthM: number): number {
  return Math.max(0, people - JAM_DENSITY_PERSONS_M2 * Math.max(lengthM * widthM, Number.EPSILON));
}

export function capacityFlow(
  freeSpeedMs = FREE_FLOW_SPEED_MS,
  jamDensity = JAM_DENSITY_PERSONS_M2,
): [density: number, flow: number] {
  const atCapacity = jamDensity / 2;
  return [atCapacity, flowRate(atCapacity, speedAtDensity(atCapacity, freeSpeedMs, jamDensity))];
}
