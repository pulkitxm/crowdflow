import type { MeshMessage, MeshMessageType, StateUpdate } from '../core/contracts';

export const PROTOCOL_VERSION = 1;
export const HEADER_SIZE = 10;
export const STATE_PAYLOAD_SIZE = 8;
export const MAX_PACKET_SIZE = 255;
export const MAX_TTL = 8;

const typeCodes: Record<MeshMessageType, number> = {
  HELLO: 0,
  PEER_DISCOVERY: 1,
  STATE_UPDATE: 2,
  ZONE_UPDATE: 3,
  ROUTE_UPDATE: 4,
  ALERT: 5,
  REROUTE: 6,
  ACK: 7,
  HEARTBEAT: 8,
  SYNC: 9,
};

const codeTypes = Object.fromEntries(
  Object.entries(typeCodes).map(([type, code]) => [code, type]),
) as Record<number, MeshMessageType>;

export class ProtocolError extends Error {}

export function encodeMeshMessage(message: MeshMessage): Uint8Array {
  if (!/^[0-9a-f]{4}$/i.test(message.source)) throw new ProtocolError('source must be four hex characters');
  assertUInt(message.sequence, 0xffff, 'sequence');
  assertUInt(message.ttl, MAX_TTL, 'ttl');
  if (message.ttl < 1) throw new ProtocolError('ttl must be at least one');
  assertUInt(message.timestamp, 0xffffffff, 'timestamp');
  if (HEADER_SIZE + message.payload.length > MAX_PACKET_SIZE) {
    throw new ProtocolError(`packet exceeds ${MAX_PACKET_SIZE} bytes`);
  }

  const bytes = new Uint8Array(HEADER_SIZE + message.payload.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = (PROTOCOL_VERSION << 4) | typeCodes[message.type];
  view.setUint16(1, Number.parseInt(message.source, 16), false);
  view.setUint16(3, message.sequence, false);
  bytes[5] = message.ttl;
  view.setUint32(6, message.timestamp, false);
  bytes.set(message.payload, HEADER_SIZE);
  return bytes;
}

export function decodeMeshMessage(bytes: Uint8Array): MeshMessage {
  if (bytes.length < HEADER_SIZE || bytes.length > MAX_PACKET_SIZE) {
    throw new ProtocolError(`packet length must be ${HEADER_SIZE}..${MAX_PACKET_SIZE}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0] >>> 4;
  if (version !== PROTOCOL_VERSION) throw new ProtocolError(`unsupported version ${version}`);
  const type = codeTypes[bytes[0] & 0x0f];
  if (!type) throw new ProtocolError('unknown message type');
  const ttl = bytes[5];
  if (ttl < 1 || ttl > MAX_TTL) throw new ProtocolError(`invalid ttl ${ttl}`);
  return {
    type,
    source: view.getUint16(1, false).toString(16).padStart(4, '0'),
    sequence: view.getUint16(3, false),
    ttl,
    timestamp: view.getUint32(6, false),
    payload: bytes.slice(HEADER_SIZE),
  };
}

export function encodeStateUpdate(state: StateUpdate): Uint8Array {
  assertUInt(state.zoneIndex, 0xffff, 'zone index');
  const bytes = new Uint8Array(STATE_PAYLOAD_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, state.zoneIndex, false);
  bytes[2] = quantise(state.density, 20, 255);
  bytes[3] = quantise(state.velocity, 50, 255);
  bytes[4] = Math.min(179, Math.floor(normaliseDirection(state.direction) / 2));
  bytes[5] = quantise(state.confidence, 255, 255);
  return bytes;
}

export function decodeStateUpdate(payload: Uint8Array): StateUpdate {
  if (payload.length !== STATE_PAYLOAD_SIZE) {
    throw new ProtocolError(`STATE_UPDATE must be ${STATE_PAYLOAD_SIZE} bytes`);
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    zoneIndex: view.getUint16(0, false),
    density: payload[2] / 20,
    velocity: payload[3] / 50,
    direction: payload[4] * 2,
    confidence: payload[5] / 255,
  };
}

export function messageKey(message: Pick<MeshMessage, 'source' | 'sequence'>): string {
  return `${message.source}:${message.sequence}`;
}

function quantise(value: number, scale: number, maximum: number): number {
  return Math.round(Math.min(maximum, Math.max(0, value * scale)));
}

function normaliseDirection(value: number): number {
  return ((value % 360) + 360) % 360;
}

function assertUInt(value: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new ProtocolError(`${name} must be uint${maximum === 0xffff ? '16' : maximum === 0xff ? '8' : '32'}`);
  }
}
