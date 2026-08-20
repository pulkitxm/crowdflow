/**
 * The one place latitude and longitude are allowed to exist.
 *
 * Everything above this file works in venue metres (plan.md §10): routing,
 * density, prediction, the console, the app. A geographic coordinate reaches
 * exactly two places — the circuit pack's origin, and a handset's GNSS adapter —
 * and this module is the seam between them. Keeping it that narrow is what
 * makes a zone lookup an arithmetic comparison instead of a geodesy problem.
 *
 * The projection is a local tangent plane, not a map projection. Over a venue
 * a few kilometres across, the error from treating the surface as flat is
 * centimetres, which is two orders of magnitude below the accuracy of any fix
 * this system will ever receive; anything more elaborate would be precision
 * with nothing behind it. The metres-per-degree series is WGS84's, so the
 * flattening is handled even though the curvature is not.
 */

import type { CircuitPack, CoordinateFrame, Position } from '@crowdflow/contracts';

/** A geographic coordinate, as a platform location API hands it over. */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Metres east, metres north of the frame origin. The intermediate step. */
export interface EastNorth {
  east: number;
  north: number;
}

const DEG = Math.PI / 180;

/**
 * Metres per degree of latitude at a given latitude (WGS84 series).
 *
 * A degree of latitude is not constant: the Earth is flattened, so a degree
 * near the poles is longer than one at the equator by about 1%. At a venue's
 * scale that is metres, and metres matter here.
 */
export function metresPerDegreeLat(lat: number): number {
  const phi = lat * DEG;
  return 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi);
}

/** Metres per degree of longitude at a given latitude (WGS84 series). */
export function metresPerDegreeLon(lat: number): number {
  const phi = lat * DEG;
  return 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
}

/**
 * Venue rotation, as the frame declares it.
 *
 * `rotation_deg` is the true bearing of the frame's +y axis. Zero means +y is
 * true north and +x is true east, which is the case for every pack committed so
 * far — but a street circuit whose paddock runs diagonally is better modelled
 * with an aligned frame than with a rotated one bolted on later, so the
 * transform carries the term from the start.
 */
function rotation(frame: CoordinateFrame): number {
  return (frame.rotation_deg ?? 0) * DEG;
}

/** Geographic to metres east/north of the frame origin. */
export function eastNorthOf(frame: CoordinateFrame, point: GeoPoint): EastNorth {
  return {
    east: (point.lon - frame.origin_lon) * metresPerDegreeLon(frame.origin_lat),
    north: (point.lat - frame.origin_lat) * metresPerDegreeLat(frame.origin_lat),
  };
}

/** Geographic to venue frame. The function a GNSS adapter calls. */
export function toVenue(frame: CoordinateFrame, point: GeoPoint): Position {
  const { east, north } = eastNorthOf(frame, point);
  const r = rotation(frame);
  if (r === 0) return { x: east, y: north };
  return {
    x: east * Math.cos(r) - north * Math.sin(r),
    y: east * Math.sin(r) + north * Math.cos(r),
  };
}

/** Venue frame back to geographic. For rendering on a real map, and for tests. */
export function toGeo(frame: CoordinateFrame, position: Position): GeoPoint {
  const r = rotation(frame);
  const east = r === 0 ? position.x : position.x * Math.cos(r) + position.y * Math.sin(r);
  const north = r === 0 ? position.y : -position.x * Math.sin(r) + position.y * Math.cos(r);
  return {
    lat: frame.origin_lat + north / metresPerDegreeLat(frame.origin_lat),
    lon: frame.origin_lon + east / metresPerDegreeLon(frame.origin_lat),
  };
}

/**
 * A platform heading (clockwise from TRUE north) in venue terms.
 *
 * Positions are in the venue frame, so headings must be too, or the two
 * disagree the moment a pack declares a rotation and every dominant-heading
 * figure on the console is wrong by that angle. Normalised into [0, 360) to
 * satisfy `validateCrowdNode`.
 */
export function headingToVenue(frame: CoordinateFrame, trueBearingDeg: number): number {
  const venue = trueBearingDeg - (frame.rotation_deg ?? 0);
  return ((venue % 360) + 360) % 360;
}

/** Venue heading back to a true bearing. */
export function headingToTrue(frame: CoordinateFrame, venueBearingDeg: number): number {
  const bearing = venueBearingDeg + (frame.rotation_deg ?? 0);
  return ((bearing % 360) + 360) % 360;
}

/**
 * Is this position inside the venue the pack describes?
 *
 * The app's disclosure makes a promise — "when you leave the circuit, the trail
 * stops" — and this is the function that keeps it. It is deliberately the
 * pack's own `venue_bounds_m` and not a radius: the bounds are the box the
 * geometry was built in, so a position outside them cannot be assigned to a
 * zone anyway. Reporting it would add a dot to a map with nowhere to put it,
 * and keep sensing a person who has gone home.
 *
 * `margin_m` exists because a bounding box has hard edges and a fix has a
 * sigma. Without it, someone standing at the car park boundary flickers in and
 * out of the system as their accuracy breathes.
 */
export function insideVenue(frame: CoordinateFrame, position: Position, marginM = 0): boolean {
  const bounds = frame.venue_bounds_m;
  if (!bounds || bounds.length < 4) return true;
  const [minX, minY, maxX, maxY] = bounds as [number, number, number, number];
  return position.x >= minX - marginM && position.x <= maxX + marginM
    && position.y >= minY - marginM && position.y <= maxY + marginM;
}

/** The same question asked of a pack, which is what callers actually hold. */
export function insidePack(pack: CircuitPack, position: Position, marginM = 0): boolean {
  return insideVenue(pack.frame, position, marginM);
}

/** Straight-line metres between two venue positions. */
export function distanceM(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
