import type { PeerInfo, ReceivedPacket, TransportStatus } from '../core/contracts';
import { TypedEvent, type Unsubscribe } from '../core/events';
import type { MeshTransport } from './meshTransport';

/** Starts every available physical radio concurrently; fallback is used only if all radios fail. */
export class TransportManager {
  readonly packets = new TypedEvent<ReceivedPacket>();
  readonly peersChanged = new TypedEvent<PeerInfo[]>();
  readonly statusesChanged = new TypedEvent<TransportStatus[]>();
  private subscriptions: Unsubscribe[] = [];
  private nodeId = '';
  private monitor?: ReturnType<typeof setInterval>;

  constructor(private readonly transports: MeshTransport[]) {}

  get activeName(): string {
    return this.transports.filter((item) => item.status().running)
      .sort((a, b) => b.priority - a.priority)[0]?.name ?? 'No transport';
  }

  statuses(): TransportStatus[] { return this.transports.map((item) => item.status()); }

  peers(): PeerInfo[] {
    const peers = new Map<string, PeerInfo>();
    this.transports.flatMap((transport) => transport.peers()).forEach((peer) => {
      const key = peer.nodeId ?? peer.id;
      if (!peers.has(key) || peers.get(key)!.lastSeen < peer.lastSeen) peers.set(key, peer);
    });
    return [...peers.values()];
  }

  async start(nodeId: string): Promise<void> {
    this.nodeId = nodeId;
    if (this.subscriptions.length === 0) {
      this.transports.forEach((transport) => {
        this.subscriptions.push(transport.packets.subscribe((packet) => this.packets.emit(packet)));
        this.subscriptions.push(transport.peersChanged.subscribe(() => this.publishPeers()));
        this.subscriptions.push(transport.statusChanged.subscribe(() => this.statusesChanged.emit(this.statuses())));
      });
    }
    await Promise.allSettled(this.transports.map(async (transport) => {
      try {
        if (await transport.isAvailable()) await transport.start(nodeId);
      } catch (error) {
        this.markFailure(transport, error);
        throw error;
      }
    }));
    this.publishPeers(); this.statusesChanged.emit(this.statuses());
    this.monitor = setInterval(() => void this.refresh(), 10_000);
  }

  async updateNodeId(nodeId: string): Promise<void> {
    if (nodeId === this.nodeId) return;
    this.nodeId = nodeId;
    await Promise.allSettled(this.transports.map((transport) => transport.updateNodeId(nodeId)));
  }

  async stop(): Promise<void> {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = undefined;
    await Promise.allSettled(this.transports.map((transport) => transport.stop()));
    this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    this.publishPeers(); this.statusesChanged.emit(this.statuses());
  }

  async send(peerId: string, bytes: Uint8Array): Promise<void> {
    const candidates = this.transports.filter((transport) => transport.peers().some((peer) => peer.id === peerId))
      .sort((a, b) => b.priority - a.priority);
    let lastError: unknown;
    for (const transport of candidates) {
      try { await transport.send(peerId, bytes); return; } catch (error) { lastError = error; }
    }
    throw lastError ?? new Error('Peer is unavailable');
  }

  async broadcast(bytes: Uint8Array): Promise<void> {
    const running = this.transports.filter((item) => item.status().running);
    const physical = running.filter((item) => !item.fallbackOnly);
    const results = await Promise.allSettled(physical.map((transport) => transport.broadcast(bytes)));
    if (results.some((result) => result.status === 'fulfilled')) return;
    const fallback = running.filter((item) => item.fallbackOnly);
    for (const transport of fallback) {
      try { await transport.broadcast(bytes); return; } catch { /* try the next fallback */ }
    }
    const reason = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
    throw reason ?? new Error('No mesh transport is running');
  }

  private async refresh(): Promise<void> {
    await Promise.allSettled(this.transports.map(async (transport) => {
      try {
        const available = await transport.isAvailable();
        if (available && !transport.status().running) await transport.start(this.nodeId);
        if (!available && transport.status().running) await transport.stop();
      } catch (error) {
        this.markFailure(transport, error);
      }
    }));
  }

  private markFailure(transport: MeshTransport, error: unknown): void {
    transport.reportError(error);
    this.statusesChanged.emit(this.statuses());
  }

  private publishPeers(): void { this.peersChanged.emit(this.peers()); }
}
