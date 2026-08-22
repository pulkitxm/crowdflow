import { describe, expect, it } from 'vitest';
import type { CircuitPack } from '@crowdflow/contracts';
import { Random, Scenario, Simulation, VenueGraph } from '../src/index.js';

const sourced = { value: 2, provenance: 'measured' as const, samples: 64 };
const pack: CircuitPack = {
  id: 'line',
  name: 'Line',
  geometry_source: 'synthetic',
  layout_id: 'line-1',
  capability: 'synthetic_simulation',
  track_length_m: 100,
  altitude_m: 0,
  track_clearance_m: sourced,
  frame: { origin_lat: 0, origin_lon: 0, track_bounds_m: [100, 1], venue_bounds_m: [0, 0, 100, 1] },
  zones: {
    a: { id: 'a', kind: 'gate', position: { x: 0, y: 0 } },
    b: { id: 'b', kind: 'exit', position: { x: 100, y: 0 } },
  },
  edges: {
    ab: {
      id: 'ab',
      source: 'a',
      destination: 'b',
      length_m: 100,
      width_m: sourced,
      geometry: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    },
  },
  crossings: {},
  constraints: {},
};

describe('seeded TypeScript simulation', () => {
  it('matches CPython MT19937 and gauss for the migration seed', () => {
    const random = new Random(42);
    expect([random.random(), random.random(), random.random()]).toEqual([
      0.6394267984578837, 0.025010755222666936, 0.27502931836911926,
    ]);
    random.random();
    random.random();
    expect(random.gauss(0, 1)).toBe(-0.938051221433234);
  });

  it('is reproducible and emits the shared CrowdNode shape', () => {
    const run = () => {
      const graph = new VenueGraph(pack);
      const scenario = new Scenario(
        'walk',
        'walk',
        [{ count: 20, origin: 'a', destination: 'b', start_s: 0, spread_s: 0 }],
        100,
        42,
      );
      const simulation = scenario.build(graph, { participation: 1 });
      simulation.step();
      return simulation.emit();
    };
    expect(run()).toEqual(run());
    expect(run()[0]).toMatchObject({ epoch: 0, zone_id: 'b' });
  });

  it('forks without sharing mutable agent paths', () => {
    const simulation = new Simulation(new VenueGraph(pack), { seed: 42 });
    simulation.addAgents(1, 'a', 'b');
    simulation.step();
    const fork = simulation.fork();
    fork.agents[0]!.path.push('fake');
    expect(simulation.agents[0]!.path).not.toContain('fake');
  });
});
