import { describe, expect, it } from 'vitest';
import { parseWifiDirectPayload } from '../transports/wifiDirectPayload';

describe('Wi-Fi Direct receive normalization', () => {
  it('accepts package string and metadata response modes', () => {
    expect(parseWifiDirectPayload('AQID')).toEqual({ encoded: 'AQID', fromAddress: undefined });
    expect(parseWifiDirectPayload({ message: 'AQID', fromAddress: '192.168.49.12' })).toEqual({
      encoded: 'AQID', fromAddress: '192.168.49.12',
    });
  });

  it('rejects malformed and oversized packet text before allocation', () => {
    expect(parseWifiDirectPayload({ message: 'not base64!' })).toBeUndefined();
    expect(parseWifiDirectPayload('A'.repeat(344))).toBeUndefined();
    expect(parseWifiDirectPayload({ fromAddress: '192.168.49.12' })).toBeUndefined();
  });
});
