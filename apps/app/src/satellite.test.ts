import type { CoordinateFrame } from "@crowdflow/contracts";
import { describe, expect, it } from "vitest";

import { geoToWorldPixel, satelliteTileUrl, satelliteZoom, tileVenueCorners, visibleTiles, worldPixelToGeo } from "./satellite";

const frame: CoordinateFrame = {
  origin_lat: 52.063513,
  origin_lon: -1.024286,
  track_bounds_m: [1028.1, 1714],
  venue_bounds_m: [-2095.6, -1590.8, 2822.3, 2893.1],
};

describe("satellite tiles", () => {
  it("round trips geographic coordinates through web mercator pixels", () => {
    const pixel = geoToWorldPixel(frame.origin_lat, frame.origin_lon, 18);
    const point = worldPixelToGeo(pixel.x, pixel.y, 18);
    expect(point.lat).toBeCloseTo(frame.origin_lat, 8);
    expect(point.lon).toBeCloseTo(frame.origin_lon, 8);
  });

  it("chooses more detailed imagery as the venue scale increases", () => {
    expect(satelliteZoom(1, frame.origin_lat)).toBe(17);
    expect(satelliteZoom(8, frame.origin_lat)).toBe(19);
    expect(satelliteZoom(1_000_000, frame.origin_lat)).toBe(19);
  });

  it("covers the visible venue bounds with a bounded tile set", () => {
    const tiles = visibleTiles(frame, [
      { x: -500, y: -500 },
      { x: 500, y: -500 },
      { x: 500, y: 500 },
      { x: -500, y: 500 },
    ], 17);
    expect(tiles.length).toBeGreaterThan(4);
    expect(tiles.length).toBeLessThan(100);
    expect(new Set(tiles.map((tile) => `${tile.x}:${tile.y}`)).size).toBe(tiles.length);
  });

  it("projects adjacent tile corners into adjacent venue positions", () => {
    const tile = visibleTiles(frame, [{ x: 0, y: 0 }], 18)[0]!;
    const [topLeft, topRight, bottomLeft] = tileVenueCorners(frame, tile);
    expect(topRight.x).toBeGreaterThan(topLeft.x);
    expect(Math.abs(topRight.y - topLeft.y)).toBeLessThan(1);
    expect(bottomLeft.y).toBeLessThan(topLeft.y);
    expect(satelliteTileUrl(tile)).toContain(`/tile/${tile.z}/${tile.y}/${tile.x}`);
  });
});
