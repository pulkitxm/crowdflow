import type { Position } from '@crowdflow/contracts';

function squaredDistance(a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

function cross(a: Position, b: Position, c: Position): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function crossTolerance(a: Position, b: Position, c: Position): number {
  const first = Math.abs((b.x - a.x) * (c.y - a.y));
  const second = Math.abs((b.y - a.y) * (c.x - a.x));
  return Number.EPSILON * 16 * Math.max(1, first + second);
}

function orientation(a: Position, b: Position, c: Position): -1 | 0 | 1 {
  const value = cross(a, b, c);
  const tolerance = crossTolerance(a, b, c);
  if (Math.abs(value) <= tolerance) return 0;
  return value < 0 ? -1 : 1;
}

function isOnSegment(point: Position, start: Position, end: Position): boolean {
  if (orientation(start, end, point) !== 0) return false;
  const tolerance =
    Number.EPSILON * 16 * Math.max(1, Math.abs(start.x), Math.abs(start.y), Math.abs(end.x), Math.abs(end.y));
  return (
    point.x >= Math.min(start.x, end.x) - tolerance &&
    point.x <= Math.max(start.x, end.x) + tolerance &&
    point.y >= Math.min(start.y, end.y) - tolerance &&
    point.y <= Math.max(start.y, end.y) + tolerance
  );
}

function segmentsIntersect(aStart: Position, aEnd: Position, bStart: Position, bEnd: Position): boolean {
  const aStartSide = orientation(bStart, bEnd, aStart);
  const aEndSide = orientation(bStart, bEnd, aEnd);
  const bStartSide = orientation(aStart, aEnd, bStart);
  const bEndSide = orientation(aStart, aEnd, bEnd);

  if (aStartSide !== 0 && aEndSide !== 0 && bStartSide !== 0 && bEndSide !== 0) {
    return aStartSide !== aEndSide && bStartSide !== bEndSide;
  }
  return (
    (aStartSide === 0 && isOnSegment(aStart, bStart, bEnd)) ||
    (aEndSide === 0 && isOnSegment(aEnd, bStart, bEnd)) ||
    (bStartSide === 0 && isOnSegment(bStart, aStart, aEnd)) ||
    (bEndSide === 0 && isOnSegment(bEnd, aStart, aEnd))
  );
}

export function pointToSegmentDistanceM(point: Position, start: Position, end: Position): number {
  const lengthSquared = squaredDistance(start, end);
  if (lengthSquared === 0) return Math.sqrt(squaredDistance(point, start));
  const projection =
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  return Math.hypot(point.x - (start.x + t * (end.x - start.x)), point.y - (start.y + t * (end.y - start.y)));
}

export function pointToPolylineDistanceM(point: Position, polyline: readonly Position[]): number {
  const [first] = polyline;
  if (!first) return Number.POSITIVE_INFINITY;
  if (polyline.length === 1) return Math.sqrt(squaredDistance(point, first));
  let minimum = Number.POSITIVE_INFINITY;
  let previous = first;
  for (const current of polyline.slice(1)) {
    minimum = Math.min(minimum, pointToSegmentDistanceM(point, previous, current));
    previous = current;
  }
  return minimum;
}

export function segmentToSegmentDistanceM(aStart: Position, aEnd: Position, bStart: Position, bEnd: Position): number {
  if (segmentsIntersect(aStart, aEnd, bStart, bEnd)) return 0;
  return Math.min(
    pointToSegmentDistanceM(aStart, bStart, bEnd),
    pointToSegmentDistanceM(aEnd, bStart, bEnd),
    pointToSegmentDistanceM(bStart, aStart, aEnd),
    pointToSegmentDistanceM(bEnd, aStart, aEnd),
  );
}

export function segmentToPolylineClearanceM(start: Position, end: Position, polyline: readonly Position[]): number {
  const [first] = polyline;
  if (!first) return Number.POSITIVE_INFINITY;
  if (polyline.length === 1) return pointToSegmentDistanceM(first, start, end);
  let minimum = Number.POSITIVE_INFINITY;
  let previous = first;
  for (const current of polyline.slice(1)) {
    minimum = Math.min(minimum, segmentToSegmentDistanceM(start, end, previous, current));
    if (minimum === 0) return 0;
    previous = current;
  }
  return minimum;
}

export function isPositionInsideTrackClearance(
  position: Position,
  track: readonly Position[],
  clearanceM: number,
): boolean {
  if (!Number.isFinite(clearanceM) || clearanceM < 0)
    throw new RangeError('track clearance must be a finite non-negative number');
  return pointToPolylineDistanceM(position, track) <= clearanceM;
}

export function polylineLengthM(polyline: readonly Position[]): number {
  let length = 0;
  for (let index = 1; index < polyline.length; index += 1) {
    length += Math.sqrt(squaredDistance(polyline[index - 1]!, polyline[index]!));
  }
  return length;
}

export function positionAlongPolyline(polyline: readonly Position[], fraction: number): Position {
  if (polyline.length === 0) throw new RangeError('polyline must contain at least one position');
  if (polyline.length === 1) return { ...polyline[0]! };
  const target = Math.max(0, Math.min(1, fraction)) * polylineLengthM(polyline);
  let covered = 0;
  for (let index = 1; index < polyline.length; index += 1) {
    const start = polyline[index - 1]!;
    const end = polyline[index]!;
    const segment = Math.sqrt(squaredDistance(start, end));
    if (covered + segment >= target || index === polyline.length - 1) {
      const share = segment === 0 ? 0 : (target - covered) / segment;
      return { x: start.x + (end.x - start.x) * share, y: start.y + (end.y - start.y) * share };
    }
    covered += segment;
  }
  return { ...polyline.at(-1)! };
}
