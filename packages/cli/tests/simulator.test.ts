import { describe, expect, it } from 'vitest';
import type { CircuitPack } from '@crowdflow/contracts';
import { VenueGraph } from '@crowdflow/core';
import { applyGuidance, reportFor, restamp, type SimulatedWalker } from '../src/simulator.js';

const sourced = (value: number) => ({ value, provenance: 'measured' as const, samples: 64 });
function toyPack(): CircuitPack {
  return {
    id: 'toy', name: 'Toy', geometry_source: 'synthetic', track_length_m: 1000, altitude_m: 0,
    frame: { origin_lat: 0, origin_lon: 0, track_bounds_m: [100, 100], venue_bounds_m: [0, 0, 100, 100] },
    zones: {
      a: { id: 'a', kind: 'gate', position: { x: 0, y: 0 } },
      b: { id: 'b', kind: 'viewing', position: { x: 10, y: 0 } },
      c: { id: 'c', kind: 'viewing', position: { x: 20, y: 0 } },
    },
    edges: {
      ab: { id: 'ab', source: 'a', destination: 'b', length_m: 10, width_m: sourced(2) },
      bc: { id: 'bc', source: 'b', destination: 'c', length_m: 10, width_m: sourced(2) },
    },
    crossings: {}, constraints: { never_route_through: [], emergency_exits: [], accessible_routes: [] },
  };
}

function walker(overrides: Partial<SimulatedWalker> = {}): SimulatedWalker {
  return {
    personId: 1,
    gateId: 'gate',
    commandId: null,
    zoneIds: ['gate', 'stand'],
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

  it('reroutes a walker onto guidance once and only once', () => {
    const pack = toyPack();
    const graph = new VenueGraph(pack);
    const subject = walker({ zoneIds: ['a', 'b'], path: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    const orders = [{ person_id: 1, command_id: 'cmd-1', to_zone: 'c', avoid: [], prefer: ['c'] }];
    expect(applyGuidance(orders, [subject], pack, graph)).toBe(1);
    expect(subject.commandId).toBe('cmd-1');
    expect(subject.zoneIds.at(-1)).toBe('c');
    expect(subject.segment).toBe(0);
    expect(applyGuidance(orders, [subject], pack, graph)).toBe(0);
  });

  it('ignores guidance for people it does not simulate', () => {
    const pack = toyPack();
    const graph = new VenueGraph(pack);
    const subject = walker({ personId: 42, zoneIds: ['a', 'b'] });
    expect(applyGuidance([{ person_id: 1, command_id: 'cmd-1', to_zone: 'c', avoid: [], prefer: [] }], [subject], pack, graph)).toBe(0);
    expect(subject.commandId).toBeNull();
  });
  it('restamps a chunk so late-delivered reports arrive fresh', () => {
    const subject = walker();
    const report = reportFor(subject, 'toy', 1000, 1, 1);
    report.nodes[0]!.timestamp = 1000;
    restamp([report], 4_000_000);
    const epoch = Math.floor(4_000_000 / 900);
    expect(report.epoch).toBe(epoch);
    expect(report.nodes[0]!.epoch).toBe(epoch);
    expect(report.nodes[0]!.timestamp).toBe(4_000_000);
  });
});
