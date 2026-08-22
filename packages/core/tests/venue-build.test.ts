import { describe, expect, it } from 'vitest';
import { buildPack, simplifyGraph, type OsmNode, type OsmWay } from '../src/index.js';

const track: Array<[number, number]> = [
  [52, -1.01],
  [52.01, -1.01],
];
function way(
  id: number,
  kind: OsmWay['kind'],
  coords: Array<[number, number]>,
  tags: Record<string, string> = {},
): OsmWay {
  return { osm_id: id, kind, coords, tags };
}

describe('OSM venue pack builder', () => {
  it('subtracts barriers unless an actual gate marks the opening', () => {
    const path = way(
      1,
      'walkable',
      [
        [52.001, -1.001],
        [52.001, -0.999],
      ],
      { highway: 'footway' },
    );
    const fence = way(
      2,
      'barrier',
      [
        [52.0005, -1],
        [52.0015, -1],
      ],
      { barrier: 'fence' },
    );
    const blocked = buildPack({
      circuit_id: 'x',
      name: 'X',
      geometry_source: 'test',
      track_length_m: 1,
      altitude_m: 0,
      track_latlon: track,
      ways: [path, fence],
      nodes: [],
    });
    expect(blocked.stats.barrier_removed).toBe(1);
    expect(Object.keys(blocked.pack.edges!)).toHaveLength(0);
    const gate: OsmNode = { osm_id: 3, kind: 'gate', coord: [52.001, -1], tags: { barrier: 'gate' } };
    const open = buildPack({
      circuit_id: 'x',
      name: 'X',
      geometry_source: 'test',
      track_length_m: 1,
      altitude_m: 0,
      track_latlon: track,
      ways: [path, fence],
      nodes: [gate],
    });
    expect(open.stats.gate_preserved).toBe(1);
    expect(Object.keys(open.pack.edges!).length).toBeGreaterThan(0);
  });

  it('drops distant semantic zones rather than inventing long access stubs', () => {
    const path = way(
      1,
      'walkable',
      [
        [52.001, -1],
        [52.003, -1],
      ],
      { highway: 'footway' },
    );
    const far = way(
      2,
      'grandstand',
      [
        [52.009, -0.99],
        [52.0091, -0.99],
      ],
      { building: 'grandstand' },
    );
    const result = buildPack({
      circuit_id: 'x',
      name: 'X',
      geometry_source: 'test',
      track_length_m: 1,
      altitude_m: 0,
      track_latlon: track,
      ways: [path, far],
      nodes: [],
    });
    expect(result.stats.unattached + result.stats.ways_clipped).toBeGreaterThan(0);
    expect(Object.keys(result.pack.zones!).some((id) => id.startsWith('stand_'))).toBe(false);
  });

  it('collapses degree-two geometry with weighted width and weakest provenance', () => {
    const zones = {
      a: { id: 'a', kind: 'gate' as const, position: { x: 0, y: 0 } },
      m: { id: 'm', kind: 'concourse' as const, position: { x: 100, y: 0 } },
      b: { id: 'b', kind: 'exit' as const, position: { x: 400, y: 0 } },
    };
    const edges = {
      am: {
        id: 'am',
        source: 'a',
        destination: 'm',
        length_m: 100,
        width_m: { value: 2, provenance: 'osm' as const },
        geometry: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
      mb: {
        id: 'mb',
        source: 'm',
        destination: 'b',
        length_m: 300,
        width_m: { value: 6, provenance: 'assumed' as const },
        geometry: [
          { x: 100, y: 0 },
          { x: 400, y: 0 },
        ],
      },
    };
    const result = simplifyGraph(zones, edges, new Set(['a', 'b']));
    const edge = Object.values(result.edges)[0]!;
    expect(edge.length_m).toBe(400);
    expect(edge.width_m.value).toBe(5);
    expect(edge.width_m.provenance).toBe('assumed');
  });
});
