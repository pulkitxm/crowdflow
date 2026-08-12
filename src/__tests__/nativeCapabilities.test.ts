import { describe, expect, it } from 'vitest';
import { hasWifiDirectModule } from '../transports/nativeCapabilities';

describe('native capability probes', () => {
  it('uses the Wi-Fi P2P package native export on Android', () => {
    expect(hasWifiDirectModule('android', { WiFiP2PManagerModule: {} })).toBe(true);
    expect(hasWifiDirectModule('android', { WiFiP2PManager: {} })).toBe(false);
    expect(hasWifiDirectModule('ios', { WiFiP2PManagerModule: {} })).toBe(false);
  });
});
