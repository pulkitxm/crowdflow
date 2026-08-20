import { describe, expect, it } from 'vitest';
import { metresPerPixel, tilesFor, worldPixels } from './mercator';

/**
 * The Web Mercator projection behind the verification map.
 *
 * Worth testing despite the screen being temporary, because this is the one
 * piece of it that can be wrong WITHOUT LOOKING WRONG. A map with a bad
 * projection renders perfectly: tiles butt up against each other, the dot sits
 * in the middle, everything looks like a map — and the position it claims is a
 * street away. That is worse than a blank screen during a verification, because
 * it would be believed.
 *
 * The expected values come from the canonical tan/asinh form of the formula, and
 * the component uses the log form (stable near the poles). The point of the
 * comparison is that the rewrite is exact, not merely plausible.
 */

const TILE = 256;

describe('slippy map projection', () => {
  it('places the origin at the centre of the world at zoom 0', () => {
    const point = worldPixels(0, 0, 0);
    expect(point.x).toBeCloseTo(128, 6);
    expect(point.y).toBeCloseTo(128, 6);
  });

  it('wraps a full turn of longitude onto the world width', () => {
    expect(worldPixels(0, -180, 0).x).toBeCloseTo(0, 6);
    expect(worldPixels(0, 180, 0).x).toBeCloseTo(256, 6);
    expect(worldPixels(0, 0, 3).x).toBeCloseTo((TILE * 8) / 2, 6);
  });

  it('agrees with the canonical formula at real coordinates', () => {
    // Independently computed from (1 - asinh(tan(lat)) / pi) / 2 * 2^z.
    const cases: [string, number, number, number, number][] = [
      ['Big Ben', 51.5007, -0.1246, 130981, 87177],
      ['Silverstone', 52.063513, -1.024286, 130326, 86514],
      ['Delhi', 28.6139, 77.209, 187293, 109311],
    ];
    for (const [, lat, lon, tileX, tileY] of cases) {
      const point = worldPixels(lat, lon, 18);
      expect(Math.floor(point.x / TILE)).toBe(tileX);
      expect(Math.floor(point.y / TILE)).toBe(tileY);
    }
  });

  it('puts north above south and east right of west', () => {
    // The y axis runs downward in image space, which is the sign error most
    // easily made here — it renders as a map reflected about the equator.
    expect(worldPixels(52, 0, 12).y).toBeLessThan(worldPixels(51, 0, 12).y);
    expect(worldPixels(0, 1, 12).x).toBeGreaterThan(worldPixels(0, 0, 12).x);
  });

  it('clamps beyond the Mercator limit instead of running to infinity', () => {
    // tan(90°) is unbounded; without the clamp the tile index becomes NaN and
    // every tile request silently fails.
    expect(Number.isFinite(worldPixels(90, 0, 10).y)).toBe(true);
    expect(Number.isFinite(worldPixels(-90, 0, 10).y)).toBe(true);
  });

  it('covers the viewport with tiles, and no more', () => {
    // 3x2 tiles is what a 600x400 viewport needs at worst. A layout that asked
    // for a hundred would be hammering a public tile server.
    const tiles = tilesFor(51.5007, -0.1246, 18, 600, 400);
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    expect(tiles.length).toBeLessThanOrEqual(12);
    // Every tile overlaps the viewport rather than sitting entirely outside it.
    for (const tile of tiles) {
      expect(tile.left).toBeGreaterThan(-256);
      expect(tile.top).toBeGreaterThan(-256);
      expect(tile.left).toBeLessThan(600);
      expect(tile.top).toBeLessThan(400);
    }
  });

  it('asks for nothing before the viewport has been measured', () => {
    expect(tilesFor(51.5, 0, 18, 0, 0)).toEqual([]);
  });

  it('scales ground distance per pixel with zoom and latitude', () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.034, 2);
    // Each zoom level halves it, and the accuracy ring is drawn from this — a
    // factor-of-two error here draws a 10 m fix as a 20 m one.
    expect(metresPerPixel(0, 1)).toBeCloseTo(metresPerPixel(0, 0) / 2, 6);
    expect(metresPerPixel(51.5, 18)).toBeCloseTo(0.372, 3);
    expect(metresPerPixel(60, 10)).toBeLessThan(metresPerPixel(0, 10));
  });
});
