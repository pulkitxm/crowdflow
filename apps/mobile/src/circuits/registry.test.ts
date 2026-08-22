import { afterEach, describe, expect, it, vi } from 'vitest';
import { circuitCapabilityChip, circuitCapabilityNotice, createCircuitSource, demoSource, liveSource, supportsOperationalGuidance } from './registry';
import { DEMO_GEOMETRY } from './demo';

afterEach(() => vi.unstubAllGlobals());

describe('circuit registry', () => {
  it('live source fetches the season list', async () => {
    const summaries = [{ id: 'silverstone', name: 'Silverstone Circuit', layout_id: 'grand-prix-2026', capability: 'venue_reviewed', zones: 1875, edges: 2404, crossings: 0, track_length_m: 5891, untrustworthy_widths: 0 }];
    const fetcher = vi.fn(async (_input: string | URL | Request) => ({ ok: true, json: async () => summaries }));
    vi.stubGlobal('fetch', fetcher);
    const source = liveSource('http://localhost:8099/');
    expect(await source.list()).toEqual([{ id: 'silverstone', name: 'Silverstone Circuit', layout_id: 'grand-prix-2026', capability: 'venue_reviewed', track_length_m: 5891 }]);
    expect(String(fetcher.mock.calls[0]![0])).toContain('/api/circuits');
  });

  it('live source fetches geometry for a circuit', async () => {
    const geometry = { pack: { id: 'silverstone', name: 'Silverstone Circuit' }, track: [{ x: 0, y: 0 }] };
    const fetcher = vi.fn(async (_input: string | URL | Request) => ({ ok: true, json: async () => geometry }));
    vi.stubGlobal('fetch', fetcher);
    const source = liveSource('http://localhost:8099');
    expect(await source.geometry('silverstone')).toEqual(geometry);
    expect(String(fetcher.mock.calls[0]![0])).toContain('/api/circuits/silverstone/geometry');
  });

  it('live source throws on a non-OK response', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(liveSource('http://localhost:8099').list()).rejects.toThrow('404');
  });

  it('demo source serves the seed circuit without a server', async () => {
    const source = demoSource();
    expect(source.demo).toBe(true);
    const choices = await source.list();
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ id: 'silverstone', name: 'Silverstone Circuit', capability: 'synthetic_simulation', track_length_m: DEMO_GEOMETRY.pack.track_length_m });
    expect(choices[0]?.layout_id).toBeTruthy();
    const geometry = await source.geometry('silverstone');
    expect(geometry.pack.id).toBe('silverstone');
    expect(geometry.track?.length).toBeGreaterThan(0);
    expect(Object.keys(geometry.pack.zones ?? {}).length).toBeGreaterThan(0);
  });

  it('demo source refuses unknown circuits', async () => {
    await expect(demoSource().geometry('monza')).rejects.toThrow('demo pack has no monza');
  });

  it('demo source plans an anchor map so rehearsal works with no server', async () => {
    const anchors = await demoSource().anchors('silverstone');
    expect(Object.keys(anchors.anchors ?? {}).length).toBeGreaterThan(50);
    expect(anchors.surveyed_at).toBeNull();
  });

  it('live source fetches the anchor pack rather than generating one', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request) => ({ ok: true, json: async () => ({ circuit_id: 'silverstone', surveyed_at: null, anchors: {} }) }));
    vi.stubGlobal('fetch', fetcher);
    await liveSource('http://localhost:8099').anchors('silverstone');
    expect(String(fetcher.mock.calls[0]![0])).toContain('/api/circuits/silverstone/anchors');
  });

  it('createCircuitSource picks live when an API is configured, demo otherwise', () => {
    expect(createCircuitSource('http://localhost:8099').demo).toBe(false);
    expect(createCircuitSource(undefined).demo).toBe(true);
  });

  it('labels synthetic circuits as unsuitable for operational guidance', () => {
    expect(circuitCapabilityChip('synthetic_simulation')).toBe('simulation only');
    expect(circuitCapabilityNotice({ layout_id: 'historic-1988', capability: 'synthetic_simulation' })).toContain('not suitable for operational guidance');
    expect(supportsOperationalGuidance('synthetic_simulation')).toBe(false);
  });

  it('distinguishes imported and reviewed layouts', () => {
    expect(circuitCapabilityChip('venue_imported')).toBe('review required');
    expect(circuitCapabilityChip('venue_reviewed')).toBe('venue reviewed');
    expect(supportsOperationalGuidance('venue_imported')).toBe(false);
    expect(supportsOperationalGuidance('venue_reviewed')).toBe(true);
    expect(circuitCapabilityNotice({ layout_id: 'grand-prix', capability: 'venue_reviewed' })).toContain('Layout grand-prix');
  });

  it('demo fixture stays recognisably Silverstone', () => {
    expect(DEMO_GEOMETRY.pack.id).toBe('silverstone');
    expect(DEMO_GEOMETRY.pack.name).toBe('Silverstone Circuit');
    expect(DEMO_GEOMETRY.track?.length).toBeGreaterThan(90);
  });
});
