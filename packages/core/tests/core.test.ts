import { describe, expect, it } from 'vitest';
import { FREE_FLOW_SPEED_MS, type CircuitPack, type RerouteCommand } from '@crowdflow/contracts';
import {
  capacityFlow,
  flowFromOccupancy,
  Simulation,
  applyAnomaly,
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

  it('carries an agent through a multi-leg day, dwelling between legs', () => {
    const graph = new VenueGraph(pack());
    const sim = new Simulation(graph, { seed: 7, participation: 1, compliance: 1 });
    sim.addItinerary(1, 'a', [{ zone: 'b', dwell_s: 40 }, { zone: 'c', dwell_s: 0 }]);
    const agent = sim.agents[0]!;

    let sawDwell = false;
    for (let tick = 0; tick < 20; tick++) {
      sim.step();
      if (sim.dwelling === 1) { sawDwell = true; break; }
    }
    expect(sawDwell).toBe(true);
    expect(agent.at).toBe('b');
    expect(sim.arrived).toBe(0);

    for (let tick = 0; tick < 200 && !agent.arrived; tick++) sim.step();
    expect(agent.arrived).toBe(true);
    expect(agent.at).toBe('c');
    expect(sim.dwelling).toBe(0);
  });

  it('holds a seated crowd longer under a red flag and releases it at once on mass departure', () => {
    const graph = new VenueGraph(pack());
    const build = () => {
      const sim = new Simulation(graph, { seed: 3, participation: 1, compliance: 1 });
      sim.addItinerary(40, 'a', [{ zone: 'b', dwell_s: 60, until_s: 600 }, { zone: 'c', dwell_s: 0 }]);
      for (let tick = 0; tick < 30; tick++) sim.step();
      return sim;
    };

    const held = build();
    expect(held.dwelling).toBeGreaterThan(0);
    const flagged = applyAnomaly(held, { kind: 'red_flag', duration_s: 300 }, held.timeS, 'a1');
    expect(flagged.kind).toBe('red_flag');
    expect(flagged.affected_agents).toBe(held.dwelling);
    expect(held.agents[0]!.dwell_until_s).toBeGreaterThan(600);

    const released = build();
    const seatedBefore = released.dwelling;
    const rush = applyAnomaly(released, { kind: 'mass_departure' }, released.timeS, 'a2');
    expect(rush.affected_agents).toBe(seatedBefore);
    released.step();
    expect(released.dwelling).toBe(0);
  });

  it('slows every walking spectator when it rains', () => {
    const graph = new VenueGraph(pack());
    const sim = new Simulation(graph, { seed: 5, participation: 1, compliance: 1 });
    sim.addAgents(20, 'a', 'c');
    sim.step();
    const before = sim.agents.map((agent) => agent.desired_speed_ms);
    const rain = applyAnomaly(sim, { kind: 'rain' }, sim.timeS, 'a3');
    expect(rain.affected_agents).toBe(20);
    expect(sim.agents.every((agent, index) => agent.desired_speed_ms < before[index]!)).toBe(true);
  });

  it('refuses an anomaly it does not model', () => {
    const sim = new Simulation(new VenueGraph(pack()), { seed: 1 });
    expect(() => applyAnomaly(sim, { kind: 'earthquake' as never }, 0, 'x')).toThrow('unknown anomaly');
  });

  it('leaves single-leg agents behaving exactly as before', () => {
    const graph = new VenueGraph(pack());
    const sim = new Simulation(graph, { seed: 7, participation: 1, compliance: 1 });
    sim.addAgents(1, 'a', 'c');
    for (let tick = 0; tick < 200 && !sim.arrived; tick++) sim.step();
    expect(sim.arrived).toBe(1);
    expect(sim.dwelling).toBe(0);
  });

  it('refuses to claim egress was cleared when the pack declares no exits', () => {
    const venue = pack();
    venue.constraints = { never_route_through: [], emergency_exits: [], accessible_routes: [] };
    const command: RerouteCommand = {
      command_id: 'cmd', issued_at: 0, expires_at: 300, source_zone: 'a', destination_zone: 'c',
      avoid: [], prefer: [], target_fraction: 0.3, reason: 'test', expected_cost_s: 0,
    };
    const verdict = new SafetyEngine(venue).review(command, undefined, new VenueGraph(venue));
    expect(verdict.dispatchable).toBe(true);
    expect(verdict.unchecked_constraints).toContain('egress_unreachable');
    expect(verdict.unchecked_constraints).toContain('never_route_through');
    expect(verdict.reason).not.toContain('emergency egress unaffected');
    expect(verdict.reason).toContain('could not be tested');
  });

  it('claims egress cleared only when exits exist to clear', () => {
    const venue = pack();
    venue.constraints = { never_route_through: ['x'], emergency_exits: ['c'], accessible_routes: [] };
    const command: RerouteCommand = {
      command_id: 'cmd', issued_at: 0, expires_at: 300, source_zone: 'a', destination_zone: 'b',
      avoid: [], prefer: [], target_fraction: 0.3, reason: 'test', expected_cost_s: 0,
    };
    const verdict = new SafetyEngine(venue).review(command, undefined, new VenueGraph(venue));
    expect(verdict.unchecked_constraints).toEqual([]);
    expect(verdict.reason).toContain('emergency egress unaffected');
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
