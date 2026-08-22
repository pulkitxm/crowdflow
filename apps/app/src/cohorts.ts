import type { PeopleQueryResult } from "@crowdflow/contracts/wire";

export const COHORT_CAPACITY = 50;

export interface PeopleCohort {
  id: string;
  x: number;
  y: number;
  count: number;
}

export function buildPeopleCohorts(grid: PeopleQueryResult | null): PeopleCohort[] {
  if (!grid) return [];
  const occupied = grid.cells.filter((cell) => cell.count > 0);
  if (!occupied.length) return [];
  const minX = Math.min(...occupied.map((cell) => cell.min_x));
  const minY = Math.min(...occupied.map((cell) => cell.min_y));
  const points = occupied
    .map((cell) => ({
      x: (cell.min_x + cell.max_x) / 2,
      y: (cell.min_y + cell.max_y) / 2,
      remaining: cell.count,
      order: morton(
        Math.round(((cell.min_x + cell.max_x) / 2 - minX) / Math.max(grid.grid_size_m, 1)),
        Math.round(((cell.min_y + cell.max_y) / 2 - minY) / Math.max(grid.grid_size_m, 1)),
      ),
    }))
    .sort((a, b) => a.order - b.order || a.y - b.y || a.x - b.x);
  const cohorts: PeopleCohort[] = [];
  let count = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (const point of points) {
    while (point.remaining > 0) {
      const taken = Math.min(COHORT_CAPACITY - count, point.remaining);
      count += taken;
      weightedX += point.x * taken;
      weightedY += point.y * taken;
      point.remaining -= taken;
      if (count === COHORT_CAPACITY) {
        cohorts.push({ id: `cohort-${cohorts.length}`, x: weightedX / count, y: weightedY / count, count });
        count = 0;
        weightedX = 0;
        weightedY = 0;
      }
    }
  }
  if (count > 0) cohorts.push({ id: `cohort-${cohorts.length}`, x: weightedX / count, y: weightedY / count, count });
  return cohorts;
}

function morton(x: number, y: number): number {
  return (spread(x) | (spread(y) << 1)) >>> 0;
}

function spread(value: number): number {
  let result = Math.max(0, Math.min(value, 0xffff));
  result = (result | (result << 8)) & 0x00ff00ff;
  result = (result | (result << 4)) & 0x0f0f0f0f;
  result = (result | (result << 2)) & 0x33333333;
  return (result | (result << 1)) & 0x55555555;
}
