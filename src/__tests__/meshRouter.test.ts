import { describe, expect, it, vi } from 'vitest';
import type { MeshMessage, PeerInfo, ReceivedPacket, TransportStatus } from '../core/contracts';
import { TypedEvent } from '../core/events';
import { MeshRouter } from '../mesh/meshRouter';
import { encodeMeshMessage } from '../protocol/meshCodec';

class FakeManager {
  packets = new TypedEvent<ReceivedPacket>();
  sent: Uint8Array[] = [];
  async broadcast(bytes: Uint8Array): Promise<void> { this.sent.push(bytes); }
}

describe('mesh relay router', () => {
  it('handles once and relays with decremented ttl', async () => {
    vi.useFakeTimers();
    const manager = new FakeManager();
    const router = new MeshRouter(manager as never, () => 0);
    const handled: MeshMessage[] = []; router.messages.subscribe((message) => handled.push(message)); router.start();
    const message: MeshMessage = { type: 'STATE_UPDATE', source: '8f3a', sequence: 7, ttl: 4, timestamp: 100, payload: new Uint8Array(8) };
    manager.packets.emit({ transport: 'wifi-lan', peerId: 'peer', bytes: encodeMeshMessage(message), receivedAt: 0 });
    await vi.runAllTimersAsync();
    expect(handled).toHaveLength(1); expect(manager.sent).toHaveLength(1); expect(manager.sent[0][5]).toBe(3);
    manager.packets.emit({ transport: 'bluetooth', peerId: 'same-peer-other-radio', bytes: encodeMeshMessage(message), receivedAt: 1 });
    await vi.runAllTimersAsync();
    expect(handled).toHaveLength(1); expect(router.snapshot().duplicateDrops).toBe(1);
    vi.useRealTimers();
  });

  it('applies backend injection locally and safely rebroadcasts retries', async () => {
    const manager = new FakeManager(); const router = new MeshRouter(manager as never);
    const handled: MeshMessage[] = []; router.messages.subscribe((message) => handled.push(message));
    const message: MeshMessage = {
      type: 'REROUTE', source: '1000', sequence: 2, ttl: 4, timestamp: 100,
      payload: new Uint8Array([1]),
    };
    expect(await router.inject(message)).toBe(true);
    expect(await router.inject(message)).toBe(false);
    expect(handled).toEqual([message]);
    expect(manager.sent).toHaveLength(2);
  });

  it('does not relay ttl-one packets', async () => {
    const manager = new FakeManager(); const router = new MeshRouter(manager as never); router.start();
    manager.packets.emit({ transport: 'bluetooth', peerId: 'peer', bytes: encodeMeshMessage({
      type: 'ALERT', source: '0001', sequence: 1, ttl: 1, timestamp: 100, payload: new Uint8Array(),
    }), receivedAt: 0 });
    await Promise.resolve(); expect(manager.sent).toHaveLength(0);
  });
});
