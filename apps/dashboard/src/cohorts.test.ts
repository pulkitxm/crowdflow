import { describe, expect, it } from "vitest";
import type { PeopleQueryResult } from "@crowdflow/api/wire";
import { COHORT_CAPACITY, buildPeopleCohorts } from "./cohorts";

function grid(zoom: number): PeopleQueryResult {
  return {
    circuit_id: "silverstone",
    coordinates: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    zoom,
    grid_size_m: 100,
    matched_count: 127,
    returned_count: 0,
    people: [],
    cells: [
      { id: "dense", min_x: 0, min_y: 0, max_x: 100, max_y: 100, count: 120, person_ids: [] },
      { id: "light", min_x: 100, min_y: 0, max_x: 200, max_y: 100, count: 7, person_ids: [] },
    ],
  };
}

describe("people cohorts", () => {
  it("packs nearby occupied cells into cohorts of fifty plus one remainder", () => {
    const cohorts = buildPeopleCohorts(grid(1));
    expect(cohorts.map((cohort) => cohort.count)).toEqual([50, 50, 27]);
    expect(cohorts.reduce((sum, cohort) => sum + cohort.count, 0)).toBe(127);
    expect(cohorts.every((cohort) => cohort.count <= COHORT_CAPACITY)).toBe(true);
  });

  it("does not expose sparse cells as individual markers", () => {
    const sparse = grid(1);
    sparse.cells = Array.from({ length: 100 }, (_, index) => ({
      id: String(index), min_x: index * 10, min_y: 0, max_x: index * 10 + 10, max_y: 10, count: 1, person_ids: [index + 1],
    }));
    expect(buildPeopleCohorts(sparse).map((cohort) => cohort.count)).toEqual([50, 50]);
  });

  it("keeps cohort capacity independent of zoom", () => {
    expect(buildPeopleCohorts(grid(1)).map((cohort) => cohort.count)).toEqual(buildPeopleCohorts(grid(12)).map((cohort) => cohort.count));
  });
});
