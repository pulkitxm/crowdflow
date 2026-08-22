import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { CircuitCapability, CircuitPack, Position } from '@crowdflow/contracts';
import {
  CIRCUIT_SELF_TEST_POPULATIONS,
  committedCircuitIds,
  selfTestCircuit,
  selfTestCommittedCircuits,
} from '../src/circuit-self-test.js';

const temporaryRoots: string[] = [];
const sourced = (value: number) => ({ value, provenance: 'assumed' as const });
const track: Position[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
  { x: 0, y: 0 },
];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function pack(capability: CircuitCapability = 'synthetic_simulation'): CircuitPack {
  return {
    id: 'safe',
    name: 'Safe Circuit',
    geometry_source: 'fixture',
    layout_id: 'safe-1',
    capability,
    track_length_m: 400,
    altitude_m: 0,
    track_clearance_m: sourced(10),
    frame: {
      origin_lat: 0,
      origin_lon: 0,
      track_bounds_m: [100, 100],
      venue_bounds_m: [-20, -20, 120, 140],
    },
    zones: {
      gate: { id: 'gate', kind: 'gate', position: { x: 0, y: 130 } },
      view: { id: 'view', kind: 'viewing', position: { x: 50, y: 130 } },
      exit: { id: 'exit', kind: 'exit', position: { x: 100, y: 130 } },
    },
    edges: {
      gate_view: {
        id: 'gate_view',
        source: 'gate',
        destination: 'view',
        length_m: 50,
        width_m: sourced(3),
        geometry: [
          { x: 0, y: 130 },
          { x: 50, y: 130 },
        ],
      },
      view_exit: {
        id: 'view_exit',
        source: 'view',
        destination: 'exit',
        length_m: 50,
        width_m: sourced(3),
        geometry: [
          { x: 50, y: 130 },
          { x: 100, y: 130 },
        ],
      },
    },
    crossings: {},
    constraints: { never_route_through: [], never_route_edges: [], emergency_exits: ['exit'] },
  };
}

function writePack(root: string, value: CircuitPack): void {
  const directory = join(root, 'circuits', value.id, 'pack');
  mkdirSync(directory, { recursive: true });
  const { zones, edges, crossings, constraints, ...metadata } = value;
  writeFileSync(join(directory, 'circuit.json'), JSON.stringify(metadata));
  writeFileSync(join(directory, 'graph.json'), JSON.stringify({ zones, edges }));
  writeFileSync(join(directory, 'crossings.json'), JSON.stringify(crossings));
  writeFileSync(join(directory, 'constraints.json'), JSON.stringify(constraints));
  writeFileSync(join(directory, 'track.json'), JSON.stringify(track.map((point) => [point.x, point.y])));
}

describe('all-circuit self-test', () => {
  it('runs arrival and egress at exact tiny populations deterministically', () => {
    const result = selfTestCircuit(pack(), track, 7);
    expect(result.ok).toBe(true);
    expect(result.profile).toBe('simulation_only');
    expect(result.simulations).toHaveLength(6);
    expect(result.simulations.map((simulation) => [simulation.kind, simulation.population])).toEqual([
      ['arrival', 1],
      ['arrival', 2],
      ['arrival', 100],
      ['egress', 1],
      ['egress', 2],
      ['egress', 100],
    ]);
    for (const simulation of result.simulations) {
      expect(simulation.arrived).toBe(simulation.population);
      expect(simulation.stranded).toBe(0);
      expect(simulation.finite_positions).toBe(true);
      expect(simulation.track_clearance_violations).toBe(0);
      expect(simulation.deterministic).toBe(true);
    }
  });

  it('retains operational capability and imported provenance warnings', () => {
    const result = selfTestCircuit(pack('venue_imported'), track, 7);
    expect(result.ok).toBe(true);
    expect(result.profile).toBe('review_required');
    expect(result.warnings).toContain('2 edge widths are assumed');
    expect(selfTestCircuit(pack('venue_reviewed'), track, 7).profile).toBe('operational');
  });

  it('blocks simulation when geometry enters track clearance', () => {
    const unsafe = pack();
    unsafe.zones!.gate!.position = { x: 0, y: 5 };
    unsafe.zones!.view!.position = { x: 50, y: 5 };
    unsafe.edges!.gate_view!.geometry = [
      { x: 0, y: 5 },
      { x: 50, y: 5 },
    ];
    const result = selfTestCircuit(unsafe, track, 7);
    expect(result.ok).toBe(false);
    expect(result.geometry_problems.some((problem) => problem.includes('track exclusion'))).toBe(true);
    expect(result.simulations).toEqual([]);
  });

  it('enumerates committed packs and emits aggregate machine data', () => {
    const root = mkdtempSync(join(tmpdir(), 'crowdflow-self-test-'));
    temporaryRoots.push(root);
    writePack(root, pack());
    expect(committedCircuitIds(root)).toEqual(['safe']);
    const report = selfTestCommittedCircuits(root, 9);
    expect(report.schema).toBe('circuit-self-test.v1');
    expect(report.ok).toBe(true);
    expect(report.populations).toEqual([...CIRCUIT_SELF_TEST_POPULATIONS]);
    expect(report.totals).toEqual({ circuits: 1, passed: 1, failed: 0, simulations: 6, simulation_failures: 0 });
    expect(report.circuits[0]).toMatchObject({
      profile: 'simulation_only',
      simulations: expect.arrayContaining([
        expect.objectContaining({ population: 100, deterministic: true, track_clearance_violations: 0 }),
      ]),
    });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
