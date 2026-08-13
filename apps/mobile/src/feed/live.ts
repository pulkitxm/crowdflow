import type { SpectatorView } from '@crowdflow/contracts';

export interface LiveFeedOptions { baseUrl: string; origin: string; destination: string; intervalMs?: number; online?: () => boolean; meshPeers?: () => number }
export const LIVE_FEED_INTERVAL_MS = 2000;

/** Polls the deliberately small spectator endpoint. Mesh-received views use the
 * same `accept` method, so radio and HTTP can never grow separate render paths. */
export class LiveSpectatorFeed {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(view: SpectatorView) => void>();
  constructor(readonly options: LiveFeedOptions) {}
  subscribe(listener: (view: SpectatorView) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  accept(view: SpectatorView): void { for (const listener of this.listeners) listener(view); }
  async refresh(signal?: AbortSignal): Promise<SpectatorView> {
    const query = new URLSearchParams({ origin: this.options.origin, destination: this.options.destination, online: String(this.options.online?.() ?? true), mesh_peers: String(this.options.meshPeers?.() ?? 0), now: String(Date.now() / 1000) });
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/api/spectator/view?${query}`, { signal }); if (!response.ok) throw new Error(`spectator feed ${response.status}`);
    const view = await response.json() as SpectatorView; this.accept(view); return view;
  }
  start(onError?: (error: unknown) => void): void { const every = this.options.intervalMs ?? LIVE_FEED_INTERVAL_MS; const tick = async () => { try { await this.refresh(); } catch (error) { onError?.(error); } finally { if (this.timer) this.timer = setTimeout(tick, every); } }; this.timer = setTimeout(tick, 0); }
  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
