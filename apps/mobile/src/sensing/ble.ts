/**
 * Bluetooth scanning: the rung that works on both platforms, and the one that
 * has to be installed.
 *
 * BLE is the fallback for the places the other two rungs fail — under a
 * grandstand, in a tunnel, inside a building — because it neither needs sky nor
 * depends on a Wi-Fi estate. What it needs instead is BEACONS, physically
 * mounted and surveyed, and the range is short: twenty to forty metres in a
 * crowd against a hundred or more for an access point. The honest consequence,
 * which the accuracy harness in `@crowdflow/core/positioning` will show for any
 * given layout, is that BLE is a LOCAL fallback rather than a venue-wide one. A
 * handful of beacons at the gates does not make a circuit positionable by
 * Bluetooth; it makes the gates positionable by Bluetooth.
 *
 * Beacons are identified by what they ADVERTISE, not by the device the scan
 * reports, and this is the detail that decides whether the rung works on iOS at
 * all. On Android `device.id` is a MAC address; on iOS it is a per-app UUID that
 * the OS rotates, so an anchor map keyed on it would match nothing on iPhone and
 * every beacon would read as unsurveyed. The iBeacon payload — UUID, major,
 * minor — is stable across both, so it is parsed out of the manufacturer data
 * and hashed into the anchor id.
 */

import type { RadioObservation } from '@crowdflow/contracts';
import { ASSUMED_BLE_SCAN_WINDOW_S } from '@crowdflow/contracts';
import { anchorIdFor } from '@crowdflow/core/positioning';
import type { AnchorScanner, ScannerAvailability } from './types';

interface BleDevice {
  id: string;
  rssi: number | null;
  serviceUUIDs?: string[] | null;
  /** base64 of the raw manufacturer-specific advertising data */
  manufacturerData?: string | null;
  localName?: string | null;
}

interface BleManagerLike {
  state(): Promise<string>;
  startDeviceScan(
    uuids: string[] | null,
    options: { allowDuplicates?: boolean } | null,
    listener: (error: unknown, device: BleDevice | null) => void,
  ): void;
  stopDeviceScan(): void;
  destroy(): void;
}

function bleManager(): BleManagerLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-ble-plx');
    const Manager = loaded?.BleManager;
    return typeof Manager === 'function' ? (new Manager() as BleManagerLike) : null;
  } catch {
    return null;
  }
}

export class BleSensor implements AnchorScanner {
  readonly source = 'ble' as const;
  readonly intervalS = ASSUMED_BLE_SCAN_WINDOW_S;
  private manager: BleManagerLike | null = null;
  private scanning = false;
  /**
   * Strongest reading per beacon since the last `scan()` call.
   *
   * A BLE scan is a subscription, not a request: advertisements arrive
   * continuously and the same beacon is heard many times a second. Keeping the
   * strongest reading per beacon is the same choice `AnchorMap` makes for
   * dual-band access points and for the same reason — the strongest sample is
   * the one with the least shadowing between transmitter and phone, which is
   * the one the log-distance model actually describes.
   */
  private heard = new Map<string, RadioObservation>();

  async availability(): Promise<ScannerAvailability> {
    this.manager ??= bleManager();
    if (!this.manager) return { usable: false, reason: 'This build does not include Bluetooth scanning.' };
    const state = await this.manager.state().catch(() => 'Unknown');
    if (state === 'PoweredOn') return { usable: true };
    if (state === 'PoweredOff') return { usable: false, reason: 'Bluetooth is switched off.' };
    if (state === 'Unauthorized') return { usable: false, reason: 'Bluetooth permission was declined.' };
    return { usable: false, reason: `Bluetooth is unavailable (${state}).` };
  }

  async start(): Promise<void> {
    this.manager ??= bleManager();
    if (!this.manager || this.scanning) return;
    this.scanning = true;
    // `allowDuplicates` is required, not an optimisation: without it the platform
    // reports each beacon once per scan session, so RSSI never updates and a
    // walking phone keeps solving against the strength it heard on arrival.
    this.manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error || !device || device.rssi == null) return;
      const anchorId = this.identify(device);
      if (!anchorId) return;
      const held = this.heard.get(anchorId);
      if (held && held.rssi_dbm >= device.rssi) return;
      this.heard.set(anchorId, { anchor_id: anchorId, kind: 'ble_beacon', rssi_dbm: device.rssi, timestamp: Date.now() / 1000 });
    });
  }

  async stop(): Promise<void> {
    if (!this.manager) return;
    if (this.scanning) this.manager.stopDeviceScan();
    this.scanning = false;
    this.heard.clear();
  }

  /** Everything heard since the last call, then start a fresh window. */
  async scan(_now: number): Promise<RadioObservation[]> {
    const observations = [...this.heard.values()];
    this.heard.clear();
    return observations;
  }

  /**
   * The stable identity of a beacon.
   *
   * In preference order: the iBeacon triple, then an advertised service UUID,
   * then the platform device id. The last is Android-only in practice and is
   * kept because a bare BLE tag with no iBeacon payload is still a usable anchor
   * on the platform where its id is stable — but a beacon estate meant to work
   * on iPhones must advertise iBeacon or a service UUID, and this ordering is
   * where that requirement is visible.
   */
  private identify(device: BleDevice): string | null {
    const beacon = iBeaconOf(device.manufacturerData ?? null);
    if (beacon) return anchorIdFor('ble_beacon', beacon);
    const service = device.serviceUUIDs?.[0];
    if (service) return anchorIdFor('ble_beacon', service);
    if (device.id) return anchorIdFor('ble_beacon', device.id);
    return null;
  }
}

/**
 * Parse an iBeacon advertisement into `uuid:major:minor`.
 *
 * The layout is fixed: Apple's company identifier 0x004C little-endian, then a
 * type byte 0x02, a length byte 0x15, a 16-byte proximity UUID, a big-endian
 * major, a big-endian minor and a calibrated transmit power. Returns null for
 * anything that is not exactly that, which is most of what a scan hears — phones,
 * headphones, watches, tyre sensors. Guessing at a non-beacon advertisement
 * would add anchors that move around the venue on their owners' wrists.
 */
export function iBeaconOf(manufacturerDataBase64: string | null): string | null {
  if (!manufacturerDataBase64) return null;
  const bytes = decodeBase64(manufacturerDataBase64);
  if (!bytes || bytes.length < 25) return null;
  if (bytes[0] !== 0x4c || bytes[1] !== 0x00 || bytes[2] !== 0x02 || bytes[3] !== 0x15) return null;
  const hex = [...bytes.slice(4, 20)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const major = (bytes[20]! << 8) | bytes[21]!;
  const minor = (bytes[22]! << 8) | bytes[23]!;
  return `${hex}:${major}:${minor}`;
}

/** Base64 without Node's Buffer, which does not exist in a React Native bundle. */
function decodeBase64(value: string): Uint8Array | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) return null;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
