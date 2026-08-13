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
 * Types mirror `packages/contracts` — the Pydantic models there are the source
 * of truth and this file follows them.
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

export interface MeshModule {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<MeshStatus>;
  getNearbyNodes(): Promise<MeshPeer[]>;
  send(nodeId: string, message: MeshMessage): Promise<void>;
  broadcast(message: MeshMessage): Promise<void>;
  addPeerListener(listener: (peers: MeshPeer[]) => void): () => void;
  addMessageListener(listener: (message: MeshMessage) => void): () => void;
}
