/**
 * Wi-Fi scanning: the strongest rung where it exists, and it does not exist
 * everywhere.
 *
 * Two platform facts shape this entire file, and neither is a limitation to work
 * around:
 *
 * IOS HAS NO WI-FI SCAN API. Not restricted, not entitlement-gated — absent.
 * There is no public way for an iOS app to list the access points around it, and
 * there never has been. So this rung is permanently unavailable on iOS, the
 * sensor says so in words, and the ladder falls through to BLE and GNSS. Any
 * design that treats Wi-Fi positioning as the primary source is an Android-only
 * design, and it is better to know that at the start than to discover it during
 * a demo.
 *
 * ANDROID THROTTLES SCANS TO FOUR PER TWO MINUTES. Since Android 9. Asking more
 * often does not fail: it returns the PREVIOUS results with their original
 * timestamps, which is worse than failing, because a caller that does not check
 * the timestamps will happily solve the same stale scan every second and report
 * a phone as stationary while its owner walks to the exit. The interval here is
 * derived from the throttle, and the observation TTL in `AnchorMap` catches
 * anything that slips through.
 *
 * The consequence of that throttle is the reason dead reckoning exists in the
 * fuser: a Wi-Fi-only phone has thirty-second holes by design, not by accident.
 *
 * The native module is required lazily. It is a community package built for the
 * old architecture, so a build that cannot include it must degrade to GNSS
 * rather than fail to start — which is exactly what a missing module does here.
 */

import { Platform } from 'react-native';
import type { RadioObservation } from '@crowdflow/contracts';
import { ASSUMED_WIFI_SCAN_INTERVAL_S } from '@crowdflow/contracts';
import { anchorIdFor } from '@crowdflow/core/positioning';
import type { AnchorScanner, ScannerAvailability } from './types';

interface WifiEntry {
  BSSID: string;
  SSID?: string;
  /** RSSI in dBm */
  level: number;
  frequency?: number;
  /** device-boot microseconds, per Android's ScanResult */
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

  /**
   * One scan, as observations.
   *
   * The BSSID is hashed on the way out and the SSID is dropped entirely. Both
   * matter: a BSSID identifies a specific piece of hardware, and an SSID list is
   * a description of where somebody is precise enough to name the hospitality
   * unit they are standing in. Neither is needed to solve a position — the
   * anchor map is keyed on the hash — and neither leaves this method.
   */
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
        // Android's ScanResult timestamp is microseconds since boot, which is
        // not comparable with a unix clock. Rather than converting through an
        // uptime the JS side does not reliably have, the scan is stamped now —
        // correct to within the scan duration, and the throttle interval is what
        // actually bounds staleness here.
        timestamp: now,
        frequency_mhz: typeof entry.frequency === 'number' ? entry.frequency : null,
      });
    }
    return observations;
  }
}
