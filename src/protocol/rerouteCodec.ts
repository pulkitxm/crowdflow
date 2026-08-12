import type { RerouteCommand, ReroutePriority } from '../core/contracts';
import type { VenueGraph } from '../venue/venueGraph';
import { HEADER_SIZE, MAX_PACKET_SIZE, ProtocolError } from './meshCodec';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const priorities: ReroutePriority[] = ['NORMAL', 'HIGH', 'EMERGENCY'];

export function encodeReroute(command: RerouteCommand, graph: VenueGraph): Uint8Array {
  const routeId = stringBytes(command.route_id, 32);
  const reason = stringBytes(command.reason, 120);
  if (command.avoid.length > 15 || command.preferred.length > 15) {
    throw new ProtocolError('reroute zone lists are limited to 15 entries');
  }
  const length =
    4 + 1 + 1 + 1 + routeId.length + 2 + 2 + 1 + command.avoid.length * 2 +
    1 + command.preferred.length * 2 + 1 + reason.length;
  if (length + HEADER_SIZE > MAX_PACKET_SIZE) throw new ProtocolError('reroute packet exceeds radio limit');
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  view.setUint32(offset, command.expires_at, false); offset += 4;
  bytes[offset++] = Math.round(clamp(command.fraction, 0, 1) * 255);
  bytes[offset++] = priorities.indexOf(command.priority);
  offset = putString(bytes, offset, routeId);
  view.setUint16(offset, graph.indexOf(command.source_zone), false); offset += 2;
  view.setUint16(offset, graph.indexOf(command.destination_zone), false); offset += 2;
  bytes[offset++] = command.avoid.length;
  command.avoid.forEach((zone) => { view.setUint16(offset, graph.indexOf(zone), false); offset += 2; });
  bytes[offset++] = command.preferred.length;
  command.preferred.forEach((zone) => { view.setUint16(offset, graph.indexOf(zone), false); offset += 2; });
  putString(bytes, offset, reason);
  return bytes;
}

export function decodeReroute(payload: Uint8Array, issuedAt: number, graph: VenueGraph): RerouteCommand {
  try {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let offset = 0;
    const expiresAt = view.getUint32(offset, false); offset += 4;
    const fraction = payload[offset++] / 255;
    const priority = priorities[payload[offset++]];
    if (!priority) throw new ProtocolError('unknown reroute priority');
    const route = getString(payload, offset); offset = route.offset;
    const source = graph.zoneAtIndex(view.getUint16(offset, false)).id; offset += 2;
    const destination = graph.zoneAtIndex(view.getUint16(offset, false)).id; offset += 2;
    const avoidCount = readCount(payload[offset++]);
    const avoid: string[] = [];
    for (let index = 0; index < avoidCount; index += 1) {
      avoid.push(graph.zoneAtIndex(view.getUint16(offset, false)).id); offset += 2;
    }
    const preferredCount = readCount(payload[offset++]);
    const preferred: string[] = [];
    for (let index = 0; index < preferredCount; index += 1) {
      preferred.push(graph.zoneAtIndex(view.getUint16(offset, false)).id); offset += 2;
    }
    const reason = getString(payload, offset); offset = reason.offset;
    if (offset !== payload.length) throw new ProtocolError('unexpected reroute bytes');
    return {
      type: 'REROUTE', route_id: route.value, issued_at: issuedAt, expires_at: expiresAt,
      source_zone: source, destination_zone: destination, avoid, preferred, fraction,
      reason: reason.value, priority,
    };
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(`malformed reroute: ${String(error)}`);
  }
}

function putString(target: Uint8Array, offset: number, value: Uint8Array): number {
  target[offset++] = value.length;
  target.set(value, offset);
  return offset + value.length;
}

function getString(source: Uint8Array, offset: number): { value: string; offset: number } {
  const length = source[offset++];
  if (offset + length > source.length) throw new ProtocolError('truncated string');
  return { value: decoder.decode(source.slice(offset, offset + length)), offset: offset + length };
}

function stringBytes(value: string, maximum: number): Uint8Array {
  const bytes = encoder.encode(value);
  if (bytes.length > maximum || bytes.length > 255) throw new ProtocolError('reroute string is too long');
  return bytes;
}

function readCount(value: number): number {
  if (value > 15) throw new ProtocolError('reroute zone count exceeds 15');
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
