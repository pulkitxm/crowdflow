import { describe, expect, it } from 'vitest';
import { FREE_FLOW_SPEED_MS, type CircuitPack, type RerouteCommand } from '@crowdflow/contracts';
import {
  capacityFlow,
  flowFromOccupancy,
  VenueGraph,
  SafetyEngine,
  StateEngine,
} from '../src/index.js';

const sourced = (value: number) => ({ value, provenance: 'measured' as const, samples: 64 });
function pack(): CircuitPack {
  return {
    id: 'toy', name: 'Toy', geometry_source: 'synthetic', track_length_m: 1000, altitude_m: 0,
    frame: { origin_lat: 0, origin_lon: 0, track_bounds_m: [100, 100], venue_bounds_m: [0, 0, 100, 100] },
    zones: {
      a: { id: 'a', kind: 'gate', position: { x: 0, y: 0 } },
      b: { id: 'b', kind: 'concourse', position: { x: 10, y: 0 } },
      c: { id: 'c', kind: 'exit', position: { x: 20, y: 0 } },
      x: { id: 'x', kind: 'concourse', position: { x: 10, y: 10 } },
    },
    edges: {
      ab: { id: 'ab', source: 'a', destination: 'b', length_m: 10, width_m: sourced(2) },
      bc: { id: 'bc', source: 'b', destination: 'c', length_m: 10, width_m: sourced(2) },
      ax: { id: 'ax', source: 'a', destination: 'x', length_m: 20, width_m: sourced(2) },
      xc: { id: 'xc', source: 'x', destination: 'c', length_m: 20, width_m: sourced(2) },
    },
    crossings: {}, constraints: { never_route_through: [], emergency_exits: ['c'], accessible_routes: [] },
  };
}

describe('pure TypeScript core', () => {
  it('preserves the non-monotonic fundamental diagram', () => {
    const [, maxFlow] = capacityFlow();
    expect(maxFlow).toBeCloseTo(80.4, 1);
    expect(flowFromOccupancy(1000, 10, 2)[2]).toBeLessThan(maxFlow);
  });

  it('routes, caches copies, and honours advisories', () => {
    const graph = new VenueGraph(pack());
    expect(graph.route('a', 'c').path).toEqual(['a', 'b', 'c']);
    const detour = graph.route('a', 'c', undefined, new Set(['b']));
    expect(detour.path).toEqual(['a', 'x', 'c']);
    const route = graph.route('a', 'c');
    route.path.length = 0;
    expect(graph.route('a', 'c').path).toEqual(['a', 'b', 'c']);
    expect(graph.cacheHits).toBeGreaterThan(0);
  });

  it('fails safety closed around forbidden route structure', () => {
    const venue = pack();
    venue.constraints = { ...venue.constraints, never_route_through: ['b'] };
    const graph = new VenueGraph(venue);
    const command: RerouteCommand = {
      command_id: 'cmd', issued_at: 0, expires_at: 300, source_zone: 'a', destination_zone: 'c',
      avoid: [], prefer: [], target_fraction: 0.3, reason: 'test', expected_cost_s: 0,
    };
    const verdict = new SafetyEngine(venue).review(command, undefined, graph);
    expect(verdict.dispatchable).toBe(true); // safe detour through x remains
    venue.edges = { ab: venue.edges!.ab!, bc: venue.edges!.bc! };
    const blocked = new SafetyEngine(venue).review(command, undefined, new VenueGraph(venue));
    expect(blocked.dispatchable).toBe(false);
    expect(blocked.violated_constraints).toContain('no_permissible_route');
  });

  it('keeps three phones below the actionable confidence floor', () => {
    const engine = new StateEngine(pack(), 1);
    engine.ingest([0, 1, 2].map((id) => ({
      node_id: String(id), epoch: 0, timestamp: 1, position: { x: 10, y: 0 },
      speed_ms: FREE_FLOW_SPEED_MS, heading_deg: 0, accuracy_m: 8, zone_id: 'b',
    })), 1);
    const state = engine.snapshot(1).zones!.b!;
    expect(state.confidence.value).toBeLessThan(0.5);
  });
});
