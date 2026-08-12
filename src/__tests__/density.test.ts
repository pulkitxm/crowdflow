import { describe, expect, it } from 'vitest';
import { DensityEstimator } from '../mesh/densityEstimator';

describe('local density', () => {
  it('uses recent peers seen over either Bluetooth or Wi-Fi', () => {
    const now = 100_000;
    const estimate = new DensityEstimator(.2, 10).estimate([
      { id: 'a', transport: 'bluetooth', rssi: -60, lastSeen: now },
      { id: 'b', transport: 'wifi-lan', lastSeen: now },
      { id: 'old', transport: 'wifi-direct', lastSeen: 0 },
    ], now);
    expect(estimate).toBeCloseTo(15 / (Math.PI * 100));
  });
});
