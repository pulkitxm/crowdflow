import { describe, expect, it } from 'vitest';
import { reportFor, type SimulatedWalker } from '../src/simulator.js';

function walker(overrides: Partial<SimulatedWalker> = {}): SimulatedWalker {
  return {
    personId: 1,
    gateId: 'gate',
    path: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    segment: 0,
    progress: 0,
    speed: 1.2,
    lateralOffset: 2,
    destinationOffset: { x: 8, y: 6 },
    motionTime: 0,
    roamTime: 0,
    swayPhase: 0.7,
    swayRate: 0.05,
    swayAmplitude: 5,
    roamPhase: 0.4,
    roamRateX: 0.05,
    roamRateY: 0.04,
    roamRadiusX: 12,
    roamRadiusY: 9,
    ...overrides,
  };
}

describe('live crowd simulator movement', () => {
  it('varies lateral position while a person walks', () => {
    const subject = walker({ speed: 0.5 });
    const first = reportFor(subject, 'toy', 1, 1, 1).nodes[0]!;
    const second = reportFor(subject, 'toy', 2, 1, 1).nodes[0]!;
    expect(first.position.y).not.toBe(second.position.y);
    expect(second.position.x).toBeGreaterThan(first.position.x);
  });

  it('keeps an arrived person moving around the viewing area', () => {
    const subject = walker();
    const first = reportFor(subject, 'toy', 1, 1, 20).nodes[0]!;
    const second = reportFor(subject, 'toy', 2, 1, 20).nodes[0]!;
    expect(subject.segment).toBe(1);
    expect(second.position).not.toEqual(first.position);
    expect(second.speed_ms).toBeGreaterThan(0);
  });
});
