import { describe, expect, it } from 'vitest';
import type { CircuitPack, TraceFragment } from '@crowdflow/contracts';
import { PrivateBottomK, estimateParticipation, refine } from '../src/index.js';

const secret = new TextEncoder().encode('release-secret');
function sketch(items: number[]): PrivateBottomK {
  const value = PrivateBottomK.create(secret, 'race', { k: 64, epsilon: 2 });
  for (const item of items) value.add(secret, String(item));
  return value;
}

describe('private participation and refinement', () => {
  it('keeps private sketches order/duplicate invariant and mergeable', () => {
    const forward = sketch([...Array(500).keys(), ...Array(500).keys()]);
    const backward = sketch([...Array(500).keys()].reverse());
    expect(forward.hashes).toEqual(backward.hashes);
    expect(forward.hashes.length).toBeLessThanOrEqual(64);
    expect(forward.merge(backward).hashes).toEqual(forward.hashes);
  });

  it('returns unknown when capture channels do not overlap', () => {
    expect(
      estimateParticipation(sketch([...Array(100).keys()]), sketch([...Array(100).keys()].map((n) => n + 10000)), 10),
    ).toBeNull();
  });

  it('recovers seeded capture-recapture participation', () => {
    const population = [...Array(2000).keys()];
    const result = estimateParticipation(
      sketch(population.filter((n) => n % 2 === 0)),
      sketch(population.filter((n) => n % 3 !== 0)),
      sketch(population.filter((n) => n % 5 === 0)),
    );
    expect(result).not.toBeNull();
    expect(result!.population).toBeGreaterThan(1400);
    expect(result!.population).toBeLessThan(2700);
    expect(result!.participation_rate).toBeGreaterThan(0.1);
    expect(result!.participation_rate).toBeLessThan(0.3);
  });

  it('writes trustworthy measured capacity back without creating geometry', () => {
    const pack: CircuitPack = {
      id: 'line',
      name: 'Line',
      geometry_source: 'synthetic',
      layout_id: 'line-1',
      capability: 'synthetic_simulation',
      track_length_m: 100,
      altitude_m: 0,
      track_clearance_m: { value: 10, provenance: 'assumed' },
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
          width_m: { value: 2, provenance: 'assumed' },
          geometry: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        },
      },
      crossings: {},
      constraints: {},
    };
    const fragments: TraceFragment[] = Array.from({ length: 40 }, (_, index) => ({
      fragment_id: `f${index}`,
      points: [
        { x: 0, y: index % 2 ? 1 : -1 },
        { x: 100, y: index % 2 ? 1 : -1 },
      ],
      t_start: index * 60,
      t_end: index * 60 + 50,
      epsilon: 10,
      noise_radius_m: 0.1,
    }));
    const report = refine(pack, fragments, 1);
    expect(Object.keys(report.refined_edges)).toEqual(['ab']);
    expect(Object.keys(report.apply(pack).edges!)).toEqual(['ab']);
    expect(report.refined_edges.ab!.capacity_flow_ped_m_min?.provenance).toBe('measured');
  });
});
