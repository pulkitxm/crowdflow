import { describe, expect, it } from 'vitest';
import { PeerLifecycle, components, radioNeighbours } from '../src/index.js';

const peer = (node_id: string, last_seen_ms: number, rssi_dbm = -60) => ({
  node_id,
  epoch: 1,
  rssi_dbm,
  last_seen_ms,
});

describe('dynamic mesh topology', () => {
  it('admits stable peers, tolerates a missed scan, and replaces a departed peer', () => {
    const topology = new PeerLifecycle();
    expect(topology.update([peer('a', 0), peer('c', 0)], 0).connected).toEqual([]);
    expect(topology.update([peer('a', 2_000), peer('c', 2_000)], 2_000)).toEqual({
      connect: ['a', 'c'],
      disconnect: [],
      connected: ['a', 'c'],
    });

    expect(topology.update([peer('c', 4_000), peer('d', 4_000)], 4_000).connected).toEqual(['a', 'c']);
    expect(topology.update([peer('c', 16_001), peer('d', 16_001)], 16_001)).toEqual({
      connect: ['d'],
      disconnect: ['a'],
      connected: ['c', 'd'],
    });
  });

  it('uses RSSI hysteresis and caps direct peer count', () => {
    const topology = new PeerLifecycle({
      admission_observations: 1,
      join_rssi_dbm: -80,
      leave_rssi_dbm: -90,
      lost_after_ms: 10_000,
      max_peers: 2,
    });
    expect(topology.update([peer('a', 0, -70), peer('b', 0, -75), peer('c', 0, -79)], 0).connected).toEqual(['a', 'b']);
    expect(
      topology.update([peer('a', 1_000, -86), peer('b', 1_000, -75), peer('c', 1_000, -60)], 1_000).connected,
    ).toEqual(['a', 'b']);
    expect(topology.update([peer('a', 2_000, -91), peer('b', 2_000, -75), peer('c', 2_000, -60)], 2_000)).toEqual({
      connect: ['c'],
      disconnect: ['a'],
      connected: ['b', 'c'],
    });
  });

  it('does not admit cached sightings and replaces a rotated peer session', () => {
    const topology = new PeerLifecycle();
    expect(topology.update([peer('b', 0)], 0).connected).toEqual([]);
    expect(topology.update([peer('b', 0)], 2_000).connected).toEqual([]);
    expect(topology.update([peer('b', 4_000)], 4_000).connect).toEqual(['b']);
    expect(topology.update([{ ...peer('b', 6_000), epoch: 2 }], 6_000)).toEqual({
      connect: [],
      disconnect: ['b'],
      connected: [],
    });
    expect(topology.update([{ ...peer('b', 8_000), epoch: 2 }], 8_000)).toEqual({
      connect: ['b'],
      disconnect: [],
      connected: ['b'],
    });
  });

  it('rebuilds radio islands continuously as people move', () => {
    const before = radioNeighbours(
      [
        { id: 'a', position: { x: 0, y: 0 } },
        { id: 'b', position: { x: 5, y: 0 } },
        { id: 'c', position: { x: 10, y: 0 } },
        { id: 'd', position: { x: 100, y: 0 } },
        { id: 'e', position: { x: 105, y: 0 } },
      ],
      6,
    );
    expect(components(before).map((island) => [...island].sort())).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);

    const after = radioNeighbours(
      [
        { id: 'a', position: { x: 0, y: 0 } },
        { id: 'b', position: { x: 99, y: 0 } },
        { id: 'c', position: { x: 10, y: 0 } },
        { id: 'd', position: { x: 100, y: 0 } },
        { id: 'e', position: { x: 105, y: 0 } },
      ],
      6,
    );
    expect(components(after).map((island) => [...island].sort())).toEqual([['a'], ['b', 'd', 'e'], ['c']]);
  });
});
