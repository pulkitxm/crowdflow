export type MeshTrafficClass = 'state' | 'uplink' | 'urgent';

export type MeshTransport = 'wifi_aware' | 'wifi_direct' | 'ble' | 'unknown';

export interface MeshPeer {
  nodeId: string;
  epoch: number;
  transport: MeshTransport;
  rssiDbm: number | null;
  lastSeenMs: number;
}

export interface MeshMessage {
  type: string;
  trafficClass: MeshTrafficClass;
  source: string;
  sequence: number;
  ttl: number;
  timestampMs: number;
  payload: Uint8Array;
}

export interface MeshStatus {
  running: boolean;
  peerCount: number;
  online: boolean;
}

import { requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

interface MeshEvents extends Record<string, (...args: any[]) => void> {
  onPeersChanged: (event: { peers: MeshPeer[] }) => void;
  onMessage: (message: MeshMessage) => void;
}

export interface MeshModule {
  addListener<EventName extends keyof MeshEvents>(
    eventName: EventName,
    listener: MeshEvents[EventName],
  ): EventSubscription;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<MeshStatus>;
  getNearbyNodes(): Promise<MeshPeer[]>;
  connect(nodeId: string): Promise<void>;
  disconnect(nodeId: string): Promise<void>;
  send(nodeId: string, message: MeshMessage): Promise<void>;
  broadcast(message: MeshMessage): Promise<void>;
  addPeerListener(listener: (peers: MeshPeer[]) => void): () => void;
  addMessageListener(listener: (message: MeshMessage) => void): () => void;
}

const native: MeshModule | null = typeof document === 'undefined' ? requireNativeModule<MeshModule>('Mesh') : null;

function nativeMesh(): MeshModule {
  if (native === null) {
    throw new Error('The mesh requires an Android development build; it is unavailable on web.');
  }
  return native;
}

export const Mesh = {
  start: () => nativeMesh().start(),
  stop: () => nativeMesh().stop(),
  getStatus: () => nativeMesh().getStatus(),
  getNearbyNodes: () => nativeMesh().getNearbyNodes(),
  connect: (nodeId: string) => nativeMesh().connect(nodeId),
  disconnect: (nodeId: string) => nativeMesh().disconnect(nodeId),
  send: (nodeId: string, message: MeshMessage) => nativeMesh().send(nodeId, message),
  broadcast: (message: MeshMessage) => nativeMesh().broadcast(message),
  addPeerListener(listener: (peers: MeshPeer[]) => void): () => void {
    const subscription: EventSubscription = nativeMesh().addListener(
      'onPeersChanged',
      ({ peers }: { peers: MeshPeer[] }) => listener(peers),
    );
    return () => subscription.remove();
  },
  addMessageListener(listener: (message: MeshMessage) => void): () => void {
    const subscription: EventSubscription = nativeMesh().addListener('onMessage', listener);
    return () => subscription.remove();
  },
} satisfies Pick<
  MeshModule,
  | 'start'
  | 'stop'
  | 'getStatus'
  | 'getNearbyNodes'
  | 'connect'
  | 'disconnect'
  | 'send'
  | 'broadcast'
  | 'addPeerListener'
  | 'addMessageListener'
>;

export default Mesh;
