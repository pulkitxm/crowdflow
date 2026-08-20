import { describe, expect, it } from 'vitest';
import { clamp, clamp01, mean, median, quantileNearest, round, sampleStandardDeviation } from '../src/statistics.js';

describe('statistics', () => {
  it('bounds values', () => {
    expect(clamp(8, 2, 5)).toBe(5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(() => clamp(1, 2, 1)).toThrow(RangeError);
  });

  it('summarises samples without mutating them', () => {
    const values = [3, 1, 2];
    expect(mean(values)).toBe(2);
    expect(median(values)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
    expect(sampleStandardDeviation(values)).toBe(1);
  });

  it('selects bounded nearest quantiles', () => {
    expect(quantileNearest([10, 20, 30, 40], 0.5)).toBe(30);
    expect(quantileNearest([10, 20], -1)).toBe(10);
    expect(quantileNearest([10, 20], 2)).toBe(20);
    expect(quantileNearest([], 0.5)).toBeNaN();
  });

  it('rounds to an explicit precision', () => {
    expect(round(1.235, 2)).toBe(1.24);
    expect(round(1.234, 2)).toBe(1.23);
  });
});
