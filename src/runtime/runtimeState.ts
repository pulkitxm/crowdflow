import type { ConnectivityState, Guidance, MeshStats, PeerInfo, TransportStatus, VenuePoint } from '../core/contracts';
import type { UploadStats } from '../network/telemetryUploader';

export interface RuntimeState {
  running: boolean;
  nodeId: string;
  activeTransport: string;
  connectivity: ConnectivityState;
  transportStatuses: TransportStatus[];
  peers: PeerInfo[];
  position?: VenuePoint;
  positionAccuracy?: number;
  currentZone?: string;
  localDensity: number;
  destination: string;
  route: string[];
  guidance?: Guidance;
  gatewayEnabled: boolean;
  backendUrl: string;
  meshStats: MeshStats;
  uploadStats: UploadStats;
  lastError?: string;
}

export const initialRuntimeState: RuntimeState = {
  running: false, nodeId: '----', activeTransport: 'Not started', connectivity: 'stopped',
  transportStatuses: [], peers: [], localDensity: 0, destination: 'food_court', route: [],
  gatewayEnabled: false, backendUrl: '',
  meshStats: { sent: 0, received: 0, relayed: 0, duplicateDrops: 0, malformedDrops: 0, rateLimitDrops: 0 },
  uploadStats: { successes: 0, failures: 0, buffered: 0 },
};
