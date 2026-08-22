import { describe, expect, it } from "vitest";
import { densityForCell, heatBandForDensity } from "./heatmap";

describe("heat map", () => {
  it("normalizes intensity by physical cell area", () => {
    const large = { id: "large", min_x: 0, min_y: 0, max_x: 100, max_y: 100, count: 1000, person_ids: [] };
    const small = { id: "small", min_x: 0, min_y: 0, max_x: 10, max_y: 10, count: 10, person_ids: [] };
    expect(densityForCell(large)).toBe(0.1);
    expect(densityForCell(small)).toBe(0.1);
  });

  it("uses stable labelled density bands", () => {
    expect([0.004, 0.005, 0.02, 0.05].map(heatBandForDensity)).toEqual(["low", "active", "busy", "peak"]);
  });
});
