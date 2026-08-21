import { describe, expect, it, vi } from 'vitest';
import type { MeshPeer } from '../../modules/mesh';
import { MeshCoordinator } from './coordinator';

const observed = (nodeId: string, lastSeenMs: number): MeshPeer => ({
  nodeId,
  epoch: 1,
  transport: 'ble',
  rssiDbm: -60,
  lastSeenMs,
});

describe('MeshCoordinator', () => {
  it('turns changing discovery snapshots into connect and disconnect calls', async () => {
    let now = 0;
    let listener: (peers: MeshPeer[]) => void = () => undefined;
    const connect = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    const mesh = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => ({ running: true, peerCount: 0, online: false })),
      getNearbyNodes: vi.fn(async () => [] as MeshPeer[]),
      connect,
      disconnect,
      addPeerListener: vi.fn((next: (peers: MeshPeer[]) => void) => {
        listener = next;
        return () => undefined;
      }),
    };
    const coordinator = new MeshCoordinator(mesh, () => now);
    await coordinator.start();
    listener([observed('b', 0)]);
    now = 2_000;
    listener([observed('b', now)]);
    await vi.waitFor(() => expect(connect).toHaveBeenCalledWith('b'));
    now = 15_001;
    listener([]);
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledWith('b'));
    await coordinator.stop();
  });
});
