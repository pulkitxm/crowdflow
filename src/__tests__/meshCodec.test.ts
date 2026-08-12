import { describe, expect, it } from 'vitest';
import { decodeMeshMessage, decodeStateUpdate, encodeMeshMessage, encodeStateUpdate, ProtocolError } from '../protocol/meshCodec';

describe('packed mesh codec', () => {
  it('round trips an 18-byte state packet', () => {
    const payload = encodeStateUpdate({ zoneIndex: 17, density: 2.75, velocity: 1.24, direction: 358, confidence: .91 });
    const bytes = encodeMeshMessage({
      type: 'STATE_UPDATE', source: '8f3a', sequence: 183, ttl: 4,
      timestamp: 1_723_300_102, payload,
    });
    expect(bytes).toHaveLength(18);
    const message = decodeMeshMessage(bytes);
    expect(message).toMatchObject({ type: 'STATE_UPDATE', source: '8f3a', sequence: 183, ttl: 4, timestamp: 1_723_300_102 });
    expect(decodeStateUpdate(message.payload)).toEqual({
      zoneIndex: 17, density: 2.75, velocity: 1.24, direction: 358,
      confidence: expect.closeTo(.91, 2),
    });
  });

  it('rejects invalid versions and ttl', () => {
    const valid = encodeMeshMessage({ type: 'HEARTBEAT', source: '0001', sequence: 1, ttl: 4, timestamp: 100, payload: new Uint8Array() });
    const badVersion = valid.slice(); badVersion[0] = 0x28;
    const badTtl = valid.slice(); badTtl[5] = 0;
    expect(() => decodeMeshMessage(badVersion)).toThrow(ProtocolError);
    expect(() => decodeMeshMessage(badTtl)).toThrow(ProtocolError);
  });
});
