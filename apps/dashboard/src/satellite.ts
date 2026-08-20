import type { CoordinateFrame, Position } from "@crowdflow/contracts";
import { toGeo, toVenue } from "@crowdflow/core/positioning";

const TILE_SIZE = 256;
const MAX_LATITUDE = 85.05112878;
const METRES_PER_PIXEL_AT_EQUATOR = 156543.03392804097;
const MAX_SILVERSTONE_IMAGERY_ZOOM = 19;

export interface TileCoordinate {
  x: number;
  y: number;
  z: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export function satelliteZoom(scale: number, latitude: number): number {
  const value = Math.log2(METRES_PER_PIXEL_AT_EQUATOR * Math.cos(latitude * Math.PI / 180) * Math.max(scale, 0.000001));
  return Math.min(MAX_SILVERSTONE_IMAGERY_ZOOM, Math.max(0, Math.round(value)));
}

export function geoToWorldPixel(lat: number, lon: number, zoom: number): ScreenPoint {
  const latitude = Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
  const size = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin(latitude * Math.PI / 180);
  return {
    x: (lon + 180) / 360 * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function worldPixelToGeo(x: number, y: number, zoom: number): { lat: number; lon: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const n = Math.PI - 2 * Math.PI * y / size;
  return {
    lat: 180 / Math.PI * Math.atan(Math.sinh(n)),
    lon: x / size * 360 - 180,
  };
}

export function visibleTiles(frame: CoordinateFrame, corners: Position[], zoom: number, padding = 0): TileCoordinate[] {
  const pixels = corners.map((position) => {
    const point = toGeo(frame, position);
    return geoToWorldPixel(point.lat, point.lon, zoom);
  });
  const limit = 2 ** zoom;
  const minX = Math.max(0, Math.floor(Math.min(...pixels.map((point) => point.x)) / TILE_SIZE) - padding);
  const maxX = Math.min(limit - 1, Math.floor(Math.max(...pixels.map((point) => point.x)) / TILE_SIZE) + padding);
  const minY = Math.max(0, Math.floor(Math.min(...pixels.map((point) => point.y)) / TILE_SIZE) - padding);
  const maxY = Math.min(limit - 1, Math.floor(Math.max(...pixels.map((point) => point.y)) / TILE_SIZE) + padding);
  const tiles: TileCoordinate[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) tiles.push({ x, y, z: zoom });
  }
  return tiles;
}

export function tileVenueCorners(frame: CoordinateFrame, tile: TileCoordinate): [Position, Position, Position] {
  const x = tile.x * TILE_SIZE;
  const y = tile.y * TILE_SIZE;
  return [
    toVenue(frame, worldPixelToGeo(x, y, tile.z)),
    toVenue(frame, worldPixelToGeo(x + TILE_SIZE, y, tile.z)),
    toVenue(frame, worldPixelToGeo(x, y + TILE_SIZE, tile.z)),
  ];
}

export function satelliteTileUrl(tile: TileCoordinate): string {
  return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tile.z}/${tile.y}/${tile.x}`;
}
