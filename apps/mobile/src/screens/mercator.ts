/**
 * Web Mercator, on its own, with no React Native anywhere near it.
 *
 * Split out of `RealLocationMap.tsx` for one reason: this is the part that can be
 * wrong WITHOUT LOOKING WRONG. A map with a bad projection renders perfectly —
 * tiles butt up against each other, the dot sits in the middle, everything looks
 * like a map — and the position it claims is a street away. During a
 * verification that is worse than a blank screen, because it would be believed.
 *
 * A component cannot be tested here (the suite is Node, and React Native's
 * source is Flow-typed), so the arithmetic lives where it can be.
 */

/** Tile edge in pixels, and the unit the whole projection is expressed in. */
export const TILE = 256;

/** OSM's raster tiles stop here; asking beyond it returns nothing. */
export const MAX_ZOOM = 19;

/** The latitude where Mercator runs to infinity. Clamped, never exceeded. */
const MERCATOR_LIMIT = 85.05112878;

/**
 * Longitude/latitude to a pixel position in the flat world image at this zoom.
 *
 * The world image is `TILE * 2^zoom` square, x running east from the antimeridian
 * and y running DOWN from the north — image order, not map order, which is the
 * sign error most easily made here and renders as a map reflected about the
 * equator.
 */
export function worldPixels(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const clamped = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    // The Mercator y term as a log of (1+sin)/(1-sin) rather than the usual
    // asinh(tan) form: identical result, and stable near the poles where the
    // tangent runs away.
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * Ground distance one screen pixel covers.
 *
 * Shrinks with latitude, because Mercator stretches east-west as it goes north.
 * The accuracy ring is drawn from this, so a factor-of-two error here draws a
 * ten-metre fix as a twenty-metre one — which is the difference between "the
 * location feature works" and "it does not".
 */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Which tiles overlap a viewport centred on this pixel, and where each lands. */
export interface TilePlacement {
  key: string;
  z: number;
  x: number;
  y: number;
  /** offset within the viewport, in pixels */
  left: number;
  top: number;
}

export function tilesFor(
  lat: number, lon: number, zoom: number, width: number, height: number,
): TilePlacement[] {
  if (!(width > 0) || !(height > 0)) return [];
  const centre = worldPixels(lat, lon, zoom);
  const left = centre.x - width / 2;
  const top = centre.y - height / 2;
  const count = 2 ** zoom;
  const tiles: TilePlacement[] = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      // Wrap in x — the world repeats east to west — and drop out-of-range y,
      // which does not repeat: there is simply nothing above the pole.
      if (ty < 0 || ty >= count) continue;
      const wrapped = ((tx % count) + count) % count;
      tiles.push({ key: `${zoom}/${tx}/${ty}`, z: zoom, x: wrapped, y: ty, left: tx * TILE - left, top: ty * TILE - top });
    }
  }
  return tiles;
}

export function tileUrl(tile: TilePlacement): string {
  return `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
}
