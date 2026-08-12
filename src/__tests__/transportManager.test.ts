import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeerInfo, TransportKind } from '../core/contracts';
import { BaseTransport } from '../transports/meshTransport';
import { TransportManager } from '../transports/transportManager';

class FakeTransport extends BaseTransport {
  readonly name: string;
  readonly priority: number;
  override readonly fallbackOnly: boolean;
  startCalls = 0; stopCalls = 0; broadcastCalls = 0;
  available = true;
  failStart?: Error;
  broadcastOperation: () => Promise<void> = async () => {};

  constructor(
    readonly kind: TransportKind,
    options: { name?: string; priority?: number; fallbackOnly?: boolean } = {},
  ) {
    super();
    this.name = options.name ?? kind;
    this.priority = options.priority ?? 50;
    this.fallbackOnly = options.fallbackOnly ?? false;
    this.currentStatus = {
      kind, name: this.name, available: true, running: false,
      discoverable: false, peerCount: 0, detail: 'Ready',
    };
  }

  async isAvailable(): Promise<boolean> { return this.available; }
  async start(): Promise<void> {
    this.startCalls += 1;
    this.updateStatus({ running: true, discoverable: true });
    if (this.failStart) throw this.failStart;
  }
  async stop(): Promise<void> {
    this.stopCalls += 1; this.updateStatus({ running: false, discoverable: false });
  }
  peers(): PeerInfo[] { return []; }
  async send(): Promise<void> {}
  async broadcast(): Promise<void> { this.broadcastCalls += 1; await this.broadcastOperation(); }
}

afterEach(() => vi.useRealTimers());

describe('transport manager failure isolation', () => {
  it('does not wait for a stalled radio after another physical radio succeeds', async () => {
    const stalled = new FakeTransport('bluetooth');
    stalled.broadcastOperation = () => new Promise(() => {});
    const fast = new FakeTransport('wifi-lan');
    const manager = new TransportManager([stalled, fast], 100);
    await manager.start('1234');

    await manager.broadcast(new Uint8Array([1]));
    expect(stalled.broadcastCalls).toBe(1);
    expect(fast.broadcastCalls).toBe(1);
    await manager.stop();
  });

  it('uses fallback after every physical attempt rejects or times out', async () => {
    vi.useFakeTimers();
    const stalled = new FakeTransport('bluetooth');
    stalled.broadcastOperation = () => new Promise(() => {});
    const failed = new FakeTransport('wifi-lan');
    failed.broadcastOperation = async () => { throw new Error('radio failed'); };
    const fallback = new FakeTransport('loopback', { fallbackOnly: true, priority: 1 });
    const manager = new TransportManager([stalled, failed, fallback], 100);
    await manager.start('1234');

    const sending = manager.broadcast(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(100);
    await sending;
    expect(fallback.broadcastCalls).toBe(1);
    await manager.stop();
  });

  it('cleans resources left by a partial startup before retrying', async () => {
    const broken = new FakeTransport('wifi-direct');
    broken.failStart = new Error('permission denied');
    const manager = new TransportManager([broken]);
    await manager.start('1234');

    expect(broken.startCalls).toBe(1);
    expect(broken.stopCalls).toBe(1);
    expect(broken.status()).toMatchObject({ running: false, discoverable: false, detail: 'permission denied' });
    await manager.stop();
  });
});
