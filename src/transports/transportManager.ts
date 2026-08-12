import type { PeerInfo, ReceivedPacket, TransportStatus } from '../core/contracts';
import { TypedEvent, type Unsubscribe } from '../core/events';
import type { MeshTransport } from './meshTransport';

/** Starts every available physical radio concurrently; fallback is used only if all radios fail. */
export class TransportManager {
  readonly packets = new TypedEvent<ReceivedPacket>();
  readonly peersChanged = new TypedEvent<PeerInfo[]>();
  readonly statusesChanged = new TypedEvent<TransportStatus[]>();
  private subscriptions: Unsubscribe[] = [];
  private readonly started = new Set<MeshTransport>();
  private nodeId = '';
  private active = false;
  private monitor?: ReturnType<typeof setInterval>;
  private refreshPromise?: Promise<void>;

  constructor(
    private readonly transports: MeshTransport[],
    private readonly operationTimeoutMs = 5_000,
  ) {}

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
    if (this.active) return;
    this.active = true; this.nodeId = nodeId;
    this.bindEvents();
    await Promise.allSettled(this.transports.map((transport) => this.startIfAvailable(transport)));
    this.publishPeers(); this.statusesChanged.emit(this.statuses());
    if (this.active) this.monitor = setInterval(() => void this.refresh(), 10_000);
  }

  async updateNodeId(nodeId: string): Promise<void> {
    if (nodeId === this.nodeId) return;
    this.nodeId = nodeId;
    await Promise.allSettled([...this.started].map(async (transport) => {
      try { await transport.updateNodeId(nodeId); }
      catch (error) { await this.cleanFailure(transport, error); }
    }));
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = undefined;
    await this.refreshPromise?.catch(() => undefined);
    await Promise.allSettled(this.transports.map((transport) => transport.stop()));
    this.started.clear();
    this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    this.publishPeers(); this.statusesChanged.emit(this.statuses());
  }

  async send(peerId: string, bytes: Uint8Array): Promise<void> {
    const candidates = this.transports.filter((transport) => transport.peers().some((peer) => peer.id === peerId))
      .sort((a, b) => b.priority - a.priority);
    let lastError: unknown;
    for (const transport of candidates) {
      try {
        await this.withTimeout(transport.send(peerId, bytes), `${transport.name} send timed out`);
        return;
      } catch (error) { lastError = error; }
    }
    throw lastError ?? new Error('Peer is unavailable');
  }

  async broadcast(bytes: Uint8Array): Promise<void> {
    const running = this.transports.filter((item) => item.status().running);
    const physical = running.filter((item) => !item.fallbackOnly);
    let physicalError: unknown;
    if (physical.length > 0) {
      const attempts = physical.map((transport) =>
        this.withTimeout(transport.broadcast(bytes), `${transport.name} broadcast timed out`));
      try {
        // Every radio is invoked, but a slow one cannot hold up a successful concurrent path.
        await Promise.any(attempts);
        return;
      } catch (error) {
        physicalError = error instanceof AggregateError ? error.errors[0] : error;
      }
    }
    const fallback = running.filter((item) => item.fallbackOnly);
    let fallbackError: unknown;
    for (const transport of fallback) {
      try {
        await this.withTimeout(transport.broadcast(bytes), `${transport.name} broadcast timed out`);
        return;
      } catch (error) { fallbackError = error; }
    }
    throw fallbackError ?? physicalError ?? new Error('No mesh transport is running');
  }

  private bindEvents(): void {
    if (this.subscriptions.length > 0) return;
    this.transports.forEach((transport) => {
      this.subscriptions.push(transport.packets.subscribe((packet) => this.packets.emit(packet)));
      this.subscriptions.push(transport.peersChanged.subscribe(() => this.publishPeers()));
      this.subscriptions.push(transport.statusChanged.subscribe(() => this.statusesChanged.emit(this.statuses())));
    });
  }

  private refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    const operation = this.doRefresh().finally(() => {
      if (this.refreshPromise === operation) this.refreshPromise = undefined;
    });
    this.refreshPromise = operation;
    return operation;
  }

  private async doRefresh(): Promise<void> {
    if (!this.active) return;
    await Promise.allSettled(this.transports.map(async (transport) => {
      try {
        const available = await transport.isAvailable();
        if (!this.active) return;
        if (!available && this.started.has(transport)) {
          await transport.stop(); this.started.delete(transport);
        } else if (available && !transport.status().running) {
          if (this.started.has(transport)) {
            await transport.stop().catch(() => undefined); this.started.delete(transport);
          }
          await transport.start(this.nodeId); this.started.add(transport);
        }
      } catch (error) {
        await this.cleanFailure(transport, error);
      }
    }));
    this.publishPeers();
  }

  private async startIfAvailable(transport: MeshTransport): Promise<void> {
    try {
      if (!this.active || !(await transport.isAvailable()) || !this.active) return;
      await transport.start(this.nodeId);
      if (this.active) this.started.add(transport); else await transport.stop();
    } catch (error) {
      await this.cleanFailure(transport, error);
    }
  }

  private async cleanFailure(transport: MeshTransport, error: unknown): Promise<void> {
    await transport.stop().catch(() => undefined);
    this.started.delete(transport);
    transport.reportError(error);
  }

  private withTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(message)), this.operationTimeoutMs);
      operation.then(
        (value) => { clearTimeout(timeout); resolve(value); },
        (error) => { clearTimeout(timeout); reject(error); },
      );
    });
  }

  private publishPeers(): void { this.peersChanged.emit(this.peers()); }
}
