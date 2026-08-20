
export const TILE = 256;

export const MAX_ZOOM = 19;

const MERCATOR_LIMIT = 85.05112878;

export function worldPixels(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const clamped = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export interface TilePlacement {
  key: string;
  z: number;
  x: number;
  y: number;
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
