import { describe, expect, it } from 'vitest';
import type { CircuitPack } from '@crowdflow/contracts';
import { DedupeCache, Frame, MessageBuffer, classifyWay, electUplinks, meshCoverage, radioNeighbours, renderSvg, widthFor } from '../src/index.js';

describe('mesh policy and venue utilities', () => {
  it('elects one measured uplink per radio island and reports unheard islands', () => {
    const nodes = [
      { id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 1, y: 0 } },
      { id: 'c', position: { x: 100, y: 0 } },
    ];
    const adjacency = radioNeighbours(nodes, 5);
    const election = electUplinks([
      { node_id: 'a', online: true, battery: 0.8, throughput_kbps: 100, peer_degree: 1 },
      { node_id: 'b', online: true, battery: 0.8, throughput_kbps: 200, peer_degree: 1 },
      { node_id: 'c', online: false, battery: 1, throughput_kbps: 0, peer_degree: 0 },
    ], adjacency);
    expect(election.uplinks).toEqual(['b']); expect(election.assignments).toEqual({ a: 'b', b: 'b' }); expect(election.unserved[0]).toEqual(new Set(['c']));
    expect(meshCoverage(adjacency, election.uplinks).uncovered_nodes).toEqual(new Set(['c']));
  });

  it('expires dedupe from local monotonic receipt time and bounds storage', () => {
    const dedupe = new DedupeCache(40); expect(dedupe.checkAndAdd('a:1', 100)).toBe(true); expect(dedupe.checkAndAdd('a:1', 110)).toBe(false); dedupe.expire(151); expect(dedupe.has('a:1')).toBe(false);
    const buffer = new MessageBuffer(1); const state = { message: { type: 'zone_update' as const, traffic_class: 'state' as const, source: 'a', sequence: 1, ttl: 8, timestamp: 0 }, initial_ttl: 8, received_at: 0, copies: 2, forwarded_to: new Set<string>() };
    expect(buffer.add(state)).toBe(true); expect(buffer.add({ ...state, message: { ...state.message, source: 'b', traffic_class: 'urgent' as const } })).toBe(true); expect(buffer.evictions).toBe(1);
  });

  it('round-trips local frames, preserves provenance and renders no invented geometry', () => {
    const frame = new Frame(52, -1); const point = frame.toXY(52.001, -0.999); expect(frame.toLatLon(...point)[0]).toBeCloseTo(52.001, 9);
    expect(classifyWay({ barrier: 'fence', highway: 'footway' })).toBe('barrier'); expect(widthFor({ highway: 'path' }).provenance).toBe('assumed'); expect(widthFor({ width: '3.5 m' }).provenance).toBe('osm');
    const pack: CircuitPack = { id: 'x', name: '<Venue>', geometry_source: 'test', track_length_m: 1, altitude_m: 0, frame: { origin_lat: 0, origin_lon: 0, track_bounds_m: [1, 1], venue_bounds_m: [0, 0, 1, 1] }, zones: { a: { id: 'a', kind: 'gate', position: { x: 0, y: 0 } }, b: { id: 'b', kind: 'exit', position: { x: 1, y: 0 } } }, edges: { ab: { id: 'ab', source: 'a', destination: 'b', length_m: 1, width_m: { value: 1, provenance: 'measured' } } } };
    const svg = renderSvg(pack); expect(svg).toContain('&lt;Venue&gt;'); expect(svg.match(/<line /g)).toHaveLength(1);
  });
});
