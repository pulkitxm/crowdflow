import type { PeerInfo } from '../core/contracts';
import { BaseTransport } from './meshTransport';

/** Guaranteed development path used only when every physical transport fails. */
export class LoopbackTransport extends BaseTransport {
  readonly kind = 'loopback' as const;
  readonly name = 'Backend loopback';
  readonly priority = 10;
  readonly fallbackOnly = true;
  private readonly gateway: PeerInfo = {
    id: 'loopback:gateway', transport: 'loopback', lastSeen: Date.now(),
  };

  constructor(private readonly backendUrl: () => string) {
    super();
    this.currentStatus = {
      kind: this.kind, name: this.name, available: true, running: false,
      discoverable: false, peerCount: 0, detail: 'HTTP fallback ready',
    };
  }

  async isAvailable(): Promise<boolean> { return true; }
  async start(_nodeId: string): Promise<void> {
    this.updateStatus({ available: true, running: true, peerCount: 1, detail: 'HTTP fallback ready' });
    this.peersChanged.emit(this.peers());
  }
  async stop(): Promise<void> {
    this.updateStatus({ running: false, peerCount: 0, detail: 'Stopped' }); this.peersChanged.emit([]);
  }
  peers(): PeerInfo[] { return this.currentStatus.running ? [this.gateway] : []; }
  async send(_peerId: string, bytes: Uint8Array): Promise<void> { await this.post(bytes); }
  async broadcast(bytes: Uint8Array): Promise<void> { await this.post(bytes); }

  private async post(bytes: Uint8Array): Promise<void> {
    const response = await fetch(`${this.backendUrl().replace(/\/$/, '')}/mesh/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-CrowdFlow-Transport': 'loopback' },
      body: bytes as unknown as BodyInit,
    });
    if (!response.ok) throw new Error(`Loopback backend returned ${response.status}`);
    const reply = new Uint8Array(await response.arrayBuffer());
    if (reply.length > 0) {
      this.packets.emit({ transport: this.kind, peerId: this.gateway.id, bytes: reply, receivedAt: Date.now() });
    }
  }
}
