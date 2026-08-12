import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import { decodeBroadcastBody } from '../gateway/broadcastPayload';

const packet = Uint8Array.from([0x18, 0x8f, 0x3a, 0, 1, 4, 0, 0, 0, 1]);
const encoded = Buffer.from(packet).toString('base64');

describe('gateway broadcast body', () => {
  it('accepts canonical base64 and the documented JSON envelope', () => {
    expect(decodeBroadcastBody(encoded)).toEqual(packet);
    expect(decodeBroadcastBody(JSON.stringify({ packet: encoded }))).toEqual(packet);
  });

  it('rejects missing, malformed, and ambiguous bodies', () => {
    expect(() => decodeBroadcastBody(undefined)).toThrow(/base64/);
    expect(() => decodeBroadcastBody('{bad')).toThrow(/valid JSON/);
    expect(() => decodeBroadcastBody('{"other":"value"}')).toThrow(/packet string/);
    expect(() => decodeBroadcastBody('raw packet bytes')).toThrow(/canonical base64/);
  });
});
