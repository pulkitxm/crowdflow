export type NodeSource = 'phone' | 'mesh_relay';

export interface VenuePoint {
  x: number;
  y: number;
}

export interface NodeTelemetry {
  node_id: string;
  timestamp: number;
  position: VenuePoint;
  position_accuracy: number;
  velocity: number;
  direction: number;
  zone: string;
  local_density?: number;
  confidence: number;
  source: NodeSource;
}

export type MeshMessageType =
  | 'HELLO'
  | 'PEER_DISCOVERY'
  | 'STATE_UPDATE'
  | 'ZONE_UPDATE'
  | 'ROUTE_UPDATE'
  | 'ALERT'
  | 'REROUTE'
  | 'ACK'
  | 'HEARTBEAT'
  | 'SYNC';

export interface MeshMessage {
  type: MeshMessageType;
  source: string;
  sequence: number;
  ttl: number;
  timestamp: number;
  payload: Uint8Array;
}

export interface StateUpdate {
  zoneIndex: number;
  density: number;
  velocity: number;
  direction: number;
  confidence: number;
}

export type ReroutePriority = 'NORMAL' | 'HIGH' | 'EMERGENCY';

export interface RerouteCommand {
  type: 'REROUTE';
  route_id: string;
  issued_at: number;
  expires_at: number;
  source_zone: string;
  destination_zone: string;
  avoid: string[];
  preferred: string[];
  fraction: number;
  reason: string;
  priority: ReroutePriority;
}

export interface PeerInfo {
  id: string;
  nodeId?: string;
  transport: TransportKind;
  rssi?: number;
  distanceMetres?: number;
  lastSeen: number;
}

export type TransportKind = 'bluetooth' | 'wifi-lan' | 'wifi-direct' | 'loopback';

export interface TransportStatus {
  kind: TransportKind;
  name: string;
  available: boolean;
  running: boolean;
  discoverable: boolean;
  peerCount: number;
  detail: string;
}

export interface ReceivedPacket {
  transport: TransportKind;
  peerId: string;
  bytes: Uint8Array;
  receivedAt: number;
  rssi?: number;
}

export interface MeshStats {
  sent: number;
  received: number;
  relayed: number;
  duplicateDrops: number;
  malformedDrops: number;
  rateLimitDrops: number;
}

export interface Guidance {
  headline: string;
  detail: string;
  route: string[];
  command?: RerouteCommand;
}

export type ConnectivityState = 'starting' | 'online' | 'local-only' | 'restored' | 'stopped' | 'error';
