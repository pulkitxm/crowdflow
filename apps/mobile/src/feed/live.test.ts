import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDay } from './mock';
import { LiveSpectatorFeed } from './live';

afterEach(() => vi.unstubAllGlobals());
describe('live spectator feed', () => {
  it('consumes only a SpectatorView and sends transport observations', async () => {
    const view = buildDay(1000).walk; const fetcher = vi.fn(async (_input: string | URL | Request) => ({ ok: true, json: async () => view })); vi.stubGlobal('fetch', fetcher);
    const feed = new LiveSpectatorFeed({ baseUrl: 'http://localhost:8099/', origin: 'stand', destination: 'park', online: () => false, meshPeers: () => 4 }); const seen: unknown[] = []; feed.subscribe((item) => seen.push(item));
    expect(await feed.refresh()).toEqual(view); expect(seen).toEqual([view]);
    const url = String(fetcher.mock.calls[0]![0]); expect(url).toContain('/api/spectator/view?'); expect(url).toContain('online=false'); expect(url).toContain('mesh_peers=4');
  });

  it('accepts a mesh-decoded view through the same render seam', () => {
    const feed = new LiveSpectatorFeed({ baseUrl: '', origin: '', destination: '' }); const seen: unknown[] = []; feed.subscribe((item) => seen.push(item)); const view = buildDay(1000).offline; feed.accept(view); expect(seen).toEqual([view]);
  });
});
