import type { PeerInfo, ReceivedPacket, TransportKind, TransportStatus } from '../core/contracts';
import { TypedEvent } from '../core/events';

export interface MeshTransport {
  readonly kind: TransportKind;
  readonly name: string;
  readonly priority: number;
  readonly fallbackOnly?: boolean;
  readonly packets: TypedEvent<ReceivedPacket>;
  readonly peersChanged: TypedEvent<PeerInfo[]>;
  readonly statusChanged: TypedEvent<TransportStatus>;
  status(): TransportStatus;
  reportError(error: unknown): void;
  prepare(): Promise<void>;
  isAvailable(): Promise<boolean>;
  start(nodeId: string): Promise<void>;
  updateNodeId(nodeId: string): Promise<void>;
  stop(): Promise<void>;
  peers(): PeerInfo[];
  send(peerId: string, bytes: Uint8Array): Promise<void>;
  broadcast(bytes: Uint8Array): Promise<void>;
}

export abstract class BaseTransport implements MeshTransport {
  abstract readonly kind: TransportKind;
  abstract readonly name: string;
  abstract readonly priority: number;
  readonly fallbackOnly: boolean = false;
  readonly packets = new TypedEvent<ReceivedPacket>();
  readonly peersChanged = new TypedEvent<PeerInfo[]>();
  readonly statusChanged = new TypedEvent<TransportStatus>();
  protected currentStatus: TransportStatus = {
    kind: 'loopback', name: 'Transport', available: false, running: false,
    discoverable: false, peerCount: 0, detail: 'Not started',
  };

  abstract isAvailable(): Promise<boolean>;
  abstract start(nodeId: string): Promise<void>;
  abstract stop(): Promise<void>;
  abstract peers(): PeerInfo[];
  abstract send(peerId: string, bytes: Uint8Array): Promise<void>;
  abstract broadcast(bytes: Uint8Array): Promise<void>;

  status(): TransportStatus { return this.currentStatus; }

  async prepare(): Promise<void> {}

  reportError(error: unknown): void {
    this.updateStatus({
      running: false,
      discoverable: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  async updateNodeId(nodeId: string): Promise<void> {
    if (!this.currentStatus.running) return;
    await this.stop();
    await this.start(nodeId);
  }

  protected updateStatus(update: Partial<TransportStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...update, kind: this.kind, name: this.name };
    this.statusChanged.emit(this.currentStatus);
  }

  protected publishPeers(peers: PeerInfo[]): void {
    this.updateStatus({ peerCount: peers.length });
    this.peersChanged.emit(peers);
  }
}
