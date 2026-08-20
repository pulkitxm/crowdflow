import { describe, expect, it } from "vitest";

import { readMapQuery, writeMapQuery } from "./mapState";

describe("map query state", () => {
  it("starts fitted with the grid hidden", () => {
    expect(readMapQuery("")).toEqual({
      full: false,
      zoom: 1,
      center: null,
      rotation: 270,
      layer: "live",
      grid: false,
    });
  });

  it("reads a complete shared map view", () => {
    expect(readMapQuery("?map=full&zoom=8.5&cx=410.2&cy=990.7&rotation=90&layer=kinds&grid=on")).toEqual({
      full: true,
      zoom: 8.5,
      center: { x: 410.2, y: 990.7 },
      rotation: 90,
      layer: "kinds",
      grid: true,
    });
  });

  it("uses safe defaults for invalid values", () => {
    expect(readMapQuery("?zoom=zero&cx=1&rotation=45&layer=other")).toEqual({
      full: false,
      zoom: 1,
      center: null,
      rotation: 270,
      layer: "live",
      grid: false,
    });
  });

  it("preserves unrelated query parameters", () => {
    const query = writeMapQuery("?circuit=silverstone", {
      full: true,
      zoom: 3.3754,
      center: { x: 12.34, y: 98.76 },
      rotation: 180,
      layer: "live",
      grid: true,
    });
    const values = new URLSearchParams(query);
    expect(values.get("circuit")).toBe("silverstone");
    expect(values.get("map")).toBe("full");
    expect(values.get("zoom")).toBe("3.375");
    expect(values.get("cx")).toBe("12.3");
    expect(values.get("cy")).toBe("98.8");
    expect(values.get("grid")).toBe("on");
  });
});
