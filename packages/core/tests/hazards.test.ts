import { describe, expect, it } from 'vitest';
import type { CircuitPack } from '@crowdflow/contracts';
import { Simulation, VenueGraph } from '../src/index.js';

const measured = (value: number) => ({ value, provenance: 'measured' as const, samples: 1 });

function pack(): CircuitPack {
  return {
    id: 'hazards',
    name: 'Hazards',
    geometry_source: 'test',
    track_length_m: 40,
    altitude_m: 0,
    frame: { origin_lat: 0, origin_lon: 0, track_bounds_m: [20, 20], venue_bounds_m: [0, 0, 20, 20] },
    zones: {
      a: { id: 'a', kind: 'viewing', position: { x: 0, y: 0 } },
      b: { id: 'b', kind: 'concourse', position: { x: 10, y: 0 } },
      c: { id: 'c', kind: 'concourse', position: { x: 0, y: 10 } },
      d: { id: 'd', kind: 'exit', position: { x: 10, y: 10 } },
    },
    edges: {
      ab: { id: 'ab', source: 'a', destination: 'b', length_m: 10, width_m: measured(2) },
      bd: { id: 'bd', source: 'b', destination: 'd', length_m: 10, width_m: measured(2) },
      ac: { id: 'ac', source: 'a', destination: 'c', length_m: 12, width_m: measured(2) },
      cd: { id: 'cd', source: 'c', destination: 'd', length_m: 12, width_m: measured(2) },
    },
    crossings: {},
    constraints: { never_route_through: [], emergency_exits: ['d'], accessible_routes: [] },
  };
}

describe('operational routing restrictions', () => {
  it('avoids a closed edge and restores the original route when cleared', () => {
    const graph = new VenueGraph(pack());
    expect(graph.route('a', 'd').path).toEqual(['a', 'b', 'd']);
    graph.setOperationalRestrictions({ closedEdges: ['ab'] });
    expect(graph.route('a', 'd').path).toEqual(['a', 'c', 'd']);
    graph.setOperationalRestrictions({});
    expect(graph.route('a', 'd').path).toEqual(['a', 'b', 'd']);
  });

  it('penalizes a restricted corridor by its remaining capacity', () => {
    const graph = new VenueGraph(pack());
    graph.setOperationalRestrictions({ edgeCapacity: [['ab', 0.25]] });
    expect(graph.route('a', 'd').path).toEqual(['a', 'c', 'd']);
  });

  it('keeps people awaiting a safe route until graph availability changes', () => {
    const graph = new VenueGraph(pack());
    graph.setOperationalRestrictions({ closedEdges: ['ab', 'ac'] });
    const simulation = new Simulation(graph, { tick_s: 1, participation: 1 });
    simulation.addAgents(1, 'a', 'd');
    simulation.step();
    expect(simulation.awaitingRoute).toBe(1);
    expect(simulation.arrived).toBe(0);
    graph.setOperationalRestrictions({ closedEdges: ['ab'] });
    simulation.invalidateRoutes();
    simulation.step();
    expect(simulation.awaitingRoute).toBe(0);
    expect(simulation.agents[0]!.edge_id).toBe('ac');
  });
});
