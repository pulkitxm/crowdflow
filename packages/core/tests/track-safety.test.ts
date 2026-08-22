import { describe, expect, it } from 'vitest';
import {
  isPositionInsideTrackClearance,
  pointToPolylineDistanceM,
  segmentToPolylineClearanceM,
  segmentToSegmentDistanceM,
} from '../src/index.js';

describe('track safety geometry', () => {
  it('reports zero clearance when segments cross', () => {
    expect(segmentToSegmentDistanceM({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(0);
  });

  it('reports zero clearance for a tangent segment', () => {
    expect(segmentToSegmentDistanceM({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 0 })).toBe(0);
  });

  it('reports zero clearance for overlapping collinear segments', () => {
    expect(segmentToSegmentDistanceM({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 0 }, { x: 12, y: 0 })).toBe(0);
  });

  it('preserves a small positive near-miss clearance', () => {
    expect(
      segmentToSegmentDistanceM({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0.01 }, { x: 15, y: 0.01 }),
    ).toBeCloseTo(0.01, 10);
  });

  it('finds the closest point across an entire polyline', () => {
    const track = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];
    expect(pointToPolylineDistanceM({ x: 18, y: 8 }, track)).toBe(2);
    expect(segmentToPolylineClearanceM({ x: 5, y: 4 }, { x: 15, y: 4 }, track)).toBe(4);
  });

  it('classifies points against a configurable track corridor', () => {
    const track = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(isPositionInsideTrackClearance({ x: 50, y: 5 }, track, 5)).toBe(true);
    expect(isPositionInsideTrackClearance({ x: 50, y: 5.001 }, track, 5)).toBe(false);
    expect(isPositionInsideTrackClearance({ x: 50, y: 0 }, [], 5)).toBe(false);
    expect(() => isPositionInsideTrackClearance({ x: 50, y: 0 }, track, -1)).toThrow(RangeError);
  });
});
