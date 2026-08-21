import { PeerLifecycle, type TopologyChange } from '@crowdflow/core/mesh/topology';
import type { MeshModule, MeshPeer, MeshStatus } from '../../modules/mesh';

export interface DynamicMeshStatus extends MeshStatus {
  discoveredCount: number;
  connectedNodeIds: string[];
  problem: string | null;
}

type MeshPort = Pick<
  MeshModule,
  'start' | 'stop' | 'getStatus' | 'getNearbyNodes' | 'connect' | 'disconnect' | 'addPeerListener'
>;

const EMPTY: DynamicMeshStatus = {
  running: false,
  online: false,
  peerCount: 0,
  discoveredCount: 0,
  connectedNodeIds: [],
  problem: null,
};

export class MeshCoordinator {
  private readonly lifecycle = new PeerLifecycle();
  private peers = new Map<string, MeshPeer>();
  private unsubscribe: (() => void) | null = null;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(status: DynamicMeshStatus) => void>();
  private state = EMPTY;
  private serial = Promise.resolve();

  constructor(
    private readonly mesh: MeshPort,
    private readonly now = () => Date.now(),
  ) {}

  subscribe(listener: (status: DynamicMeshStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.unsubscribe) return;
    try {
      await this.mesh.start();
      this.unsubscribe = this.mesh.addPeerListener((peers) => this.observe(peers));
      this.expiryTimer = setInterval(() => this.observe([...this.peers.values()]), 2_000);
      this.observe(await this.mesh.getNearbyNodes());
    } catch (error) {
      this.state = { ...EMPTY, problem: messageOf(error) };
      this.emit();
    }
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = null;
    await this.serial;
    await this.apply(this.lifecycle.reset()).catch(() => undefined);
    this.peers.clear();
    await this.mesh.stop().catch(() => undefined);
    this.state = EMPTY;
    this.emit();
  }

  private observe(peers: MeshPeer[]): void {
    for (const peer of peers) this.peers.set(peer.nodeId, peer);
    const now = this.now();
    for (const [nodeId, peer] of this.peers) {
      if (now - peer.lastSeenMs > 12_000) this.peers.delete(nodeId);
    }
    const change = this.lifecycle.update(
      [...this.peers.values()].map((peer) => ({
        node_id: peer.nodeId,
        epoch: peer.epoch,
        rssi_dbm: peer.rssiDbm,
        last_seen_ms: peer.lastSeenMs,
      })),
      now,
    );
    this.serial = this.serial
      .then(() => this.apply(change))
      .catch((error) => {
        this.state = { ...this.state, problem: messageOf(error) };
        this.emit();
      });
  }

  private async apply(change: TopologyChange): Promise<void> {
    for (const nodeId of change.disconnect) await this.mesh.disconnect(nodeId);
    for (const nodeId of change.connect) await this.mesh.connect(nodeId);
    const native = await this.mesh.getStatus();
    this.state = {
      ...native,
      peerCount: change.connected.length,
      discoveredCount: this.peers.size,
      connectedNodeIds: change.connected,
      problem: null,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'the nearby mesh could not start';
}
