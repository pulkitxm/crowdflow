
import { Platform } from 'react-native';
import type { RadioObservation } from '@crowdflow/contracts';
import { ASSUMED_WIFI_SCAN_INTERVAL_S } from '@crowdflow/contracts';
import { anchorIdFor } from '@crowdflow/core/positioning';
import type { AnchorScanner, ScannerAvailability } from './types';

interface WifiEntry {
  BSSID: string;
  SSID?: string;
  level: number;
  frequency?: number;
  timestamp?: number;
}

interface WifiModule {
  loadWifiList(): Promise<WifiEntry[]>;
}

function nativeWifi(): WifiModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-wifi-reborn');
    const module = (loaded?.default ?? loaded) as WifiModule | undefined;
    return typeof module?.loadWifiList === 'function' ? module : null;
  } catch {
    return null;
  }
}

export class WifiSensor implements AnchorScanner {
  readonly source = 'wifi' as const;
  readonly intervalS = ASSUMED_WIFI_SCAN_INTERVAL_S;
  private module = nativeWifi();

  async availability(): Promise<ScannerAvailability> {
    if (Platform.OS !== 'android') {
      return { usable: false, reason: 'Wi-Fi positioning is Android only — iOS gives no app the list of nearby networks.' };
    }
    if (!this.module) {
      return { usable: false, reason: 'This build does not include Wi-Fi scanning. Bluetooth and GPS are still used.' };
    }
    return { usable: true };
  }

  async scan(now: number): Promise<RadioObservation[]> {
    if (!this.module) return [];
    const entries = await this.module.loadWifiList().catch(() => [] as WifiEntry[]);
    const observations: RadioObservation[] = [];
    for (const entry of entries) {
      if (!entry?.BSSID || typeof entry.level !== 'number') continue;
      observations.push({
        anchor_id: anchorIdFor('wifi_ap', entry.BSSID),
        kind: 'wifi_ap',
        rssi_dbm: entry.level,
        timestamp: now,
        frequency_mhz: typeof entry.frequency === 'number' ? entry.frequency : null,
      });
    }
    return observations;
  }
}
