import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCircuitSource, demoSource, liveSource } from './registry';
import { DEMO_GEOMETRY } from './demo';

afterEach(() => vi.unstubAllGlobals());

describe('circuit registry', () => {
  it('live source fetches the season list', async () => {
    const summaries = [{ id: 'silverstone', name: 'Silverstone Circuit', zones: 1875, edges: 2404, crossings: 0, track_length_m: 5891, untrustworthy_widths: 0 }];
    const fetcher = vi.fn(async (_input: string | URL | Request) => ({ ok: true, json: async () => summaries }));
    vi.stubGlobal('fetch', fetcher);
    const source = liveSource('http://localhost:8099/');
    expect(await source.list()).toEqual([{ id: 'silverstone', name: 'Silverstone Circuit', track_length_m: 5891 }]);
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
    expect(choices).toEqual([{ id: 'silverstone', name: 'Silverstone Circuit', track_length_m: 5891 }]);
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

  it('demo fixture stays recognisably Silverstone', () => {
    expect(DEMO_GEOMETRY.pack.id).toBe('silverstone');
    expect(DEMO_GEOMETRY.pack.name).toBe('Silverstone Circuit');
    expect(DEMO_GEOMETRY.track?.length).toBe(135);
  });
});
