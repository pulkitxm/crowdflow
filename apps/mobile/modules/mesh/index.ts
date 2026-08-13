/**
 * The JS surface of the mesh module.
 *
 * Notice what is not here: no transport, no connection state machine, no
 * scanning parameters, no radio at all. Wi-Fi Aware, Wi-Fi Direct and BLE live
 * entirely behind the Kotlin `MeshNetwork` interface, and which of them won on
 * this particular handset is not something JS can act on — the answer differs
 * between two phones standing next to each other and changes mid-event.
 *
 * Notice also what JS cannot do: start relaying. Relaying runs in a foreground
 * service because the JS runtime suspends when the app backgrounds, and at a
 * race almost every phone is in a pocket with the screen off. `start()` asks the
 * service to run; it does not become the thing that runs.
 *
 * Types mirror the authored `@crowdflow/contracts` workspace; Kotlin contains
 * only the native wire representation required by the screen-off service.
 */

export type MeshTrafficClass = "state" | "uplink" | "urgent";

/** Diagnostic only. Never branch on this. */
export type MeshTransport = "wifi_aware" | "wifi_direct" | "ble" | "unknown";

export interface MeshPeer {
  /** Rotating pseudonym, valid within its epoch only. Never join across epochs. */
  nodeId: string;
  epoch: number;
  transport: MeshTransport;
  /** Null when the transport does not report it — not zero. "Unknown" and "very
   *  weak" are different facts. */
  rssiDbm: number | null;
  lastSeenMs: number;
}

export interface MeshMessage {
  type: string;
  trafficClass: MeshTrafficClass;
  source: string;
  sequence: number;
  /** Hops remaining. Decremented natively on relay, before transmission. */
  ttl: number;
  timestampMs: number;
  payload: Uint8Array;
}

export interface MeshStatus {
  /** False whenever the foreground service is not running. Relaying is off, and
   *  any coverage figure computed while this is false is a fiction. */
  running: boolean;
  peerCount: number;
  /** Whether this handset currently has a usable data connection, i.e. whether
   *  it is eligible to be elected an uplink. It is an observation that flips as
   *  the cell saturates, not a setting. */
  online: boolean;
}

import { requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

interface MeshEvents extends Record<string, (...args: any[]) => void> {
  onPeersChanged: (event: { peers: MeshPeer[] }) => void;
  onMessage: (message: MeshMessage) => void;
}

export interface MeshModule {
  addListener<EventName extends keyof MeshEvents>(eventName: EventName, listener: MeshEvents[EventName]): EventSubscription;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<MeshStatus>;
  getNearbyNodes(): Promise<MeshPeer[]>;
  send(nodeId: string, message: MeshMessage): Promise<void>;
  broadcast(message: MeshMessage): Promise<void>;
  addPeerListener(listener: (peers: MeshPeer[]) => void): () => void;
  addMessageListener(listener: (message: MeshMessage) => void): () => void;
}

const native: MeshModule | null =
  typeof document === 'undefined' ? requireNativeModule<MeshModule>('Mesh') : null;

function nativeMesh(): MeshModule {
  if (native === null) {
    throw new Error('The mesh requires an Android development build; it is unavailable on web.');
  }
  return native;
}

/** Typed adapter over Expo's event subscriptions. */
export const Mesh = {
  start: () => nativeMesh().start(),
  stop: () => nativeMesh().stop(),
  getStatus: () => nativeMesh().getStatus(),
  getNearbyNodes: () => nativeMesh().getNearbyNodes(),
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
  | 'send'
  | 'broadcast'
  | 'addPeerListener'
  | 'addMessageListener'
>;

export default Mesh;
