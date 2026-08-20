import type { PeopleQueryResult } from "@crowdflow/api/wire";

export const COHORT_CAPACITY = 50;

export interface PeopleCohort {
  id: string;
  cellId: string;
  x: number;
  y: number;
  count: number;
}

export function buildPeopleCohorts(grid: PeopleQueryResult | null): PeopleCohort[] {
  if (!grid) return [];
  return grid.cells.flatMap((cell) => {
    const cohortCount = Math.ceil(cell.count / COHORT_CAPACITY);
    const columns = Math.ceil(Math.sqrt(cohortCount));
    const rows = Math.ceil(cohortCount / columns);
    return Array.from({ length: cohortCount }, (_, index) => ({
      id: `${cell.id}:${index}`,
      cellId: cell.id,
      x: cell.min_x + ((index % columns) + 1) * (cell.max_x - cell.min_x) / (columns + 1),
      y: cell.min_y + (Math.floor(index / columns) + 1) * (cell.max_y - cell.min_y) / (rows + 1),
      count: Math.min(COHORT_CAPACITY, cell.count - index * COHORT_CAPACITY),
    }));
  });
}
