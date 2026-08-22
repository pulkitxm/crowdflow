import { afterEach, describe, expect, it } from 'vitest';
import type { CircuitCapability, CircuitPack } from '@crowdflow/contracts';
import { SafetyEngine, VenueGraph } from '@crowdflow/core';
import { ProposalLedger } from '@crowdflow/agent';
import { CrowdControl, PeopleStore, type LoadedCircuit, type ScenarioSession } from '../server/index.js';

let people: PeopleStore | null = null;
afterEach(() => people?.close());

function circuit(capability: CircuitCapability): LoadedCircuit {
  const pack: CircuitPack = {
    id: 'toy', name: 'Toy', geometry_source: 'test', layout_id: 'toy-1', capability,
    track_length_m: 1000, altitude_m: 0, track_clearance_m: { value: 10, provenance: 'assumed' },
    frame: { origin_lat: 0, origin_lon: 0, track_bounds_m: [100, 100], venue_bounds_m: [0, 0, 100, 100] },
    zones: {
      gate: { id: 'gate', kind: 'gate', position: { x: 0, y: 0 } },
      view: { id: 'view', kind: 'viewing', position: { x: 50, y: 0 } },
    },
    edges: {
      route: { id: 'route', source: 'gate', destination: 'view', length_m: 50, width_m: { value: 4, provenance: 'assumed' }, geometry: [{ x: 0, y: 0 }, { x: 50, y: 0 }] },
    },
    crossings: {}, constraints: { never_route_through: [], never_route_edges: [], emergency_exits: [], accessible_routes: [] },
  };
  return { pack, track: [], graph: new VenueGraph(pack) };
}

function proposal(circuit: LoadedCircuit) {
  return new ProposalLedger(new SafetyEngine(circuit.pack)).propose({
    now: 1, source_zone: 'gate', destination_zone: 'view', avoid: [], prefer: [], target_fraction: 0.2,
    reason: 'test', expected_cost_s: 1, graph: circuit.graph,
  });
}

describe('circuit capability guidance boundary', () => {
  it('runs a synthetic reroute inside a simulation without targeting people', () => {
    const selected = circuit('synthetic_simulation');
    people = new PeopleStore(':memory:');
    people.login(1, selected.pack.id, 1);
    people.updateLocation(1, selected.pack.id, { x: 0, y: 0 }, 1, 4, 'gnss', 1);
    const session = { circuit: selected, loop: { activeCommand: null }, sim: { avoid: new Set(), prefer: new Set() } } as unknown as ScenarioSession;
    const result = new CrowdControl(people).dispatch(proposal(selected), selected, session, 2);
    expect(result.applied_to_simulation).toBe(true);
    expect(result.cohort.targeted).toBe(0);
  });

  it('refuses operational guidance until a pack is venue reviewed', () => {
    const selected = circuit('venue_imported');
    people = new PeopleStore(':memory:');
    expect(() => new CrowdControl(people!).dispatch(proposal(selected), selected, null, 2)).toThrow('operational guidance requires venue_reviewed');
  });
});
