
import type { RadioObservation } from '@crowdflow/contracts';
import { ASSUMED_BLE_SCAN_WINDOW_S } from '@crowdflow/contracts';
import { anchorIdFor } from '@crowdflow/core/positioning';
import type { AnchorScanner, ScannerAvailability } from './types';

interface BleDevice {
  id: string;
  rssi: number | null;
  serviceUUIDs?: string[] | null;
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

  async scan(_now: number): Promise<RadioObservation[]> {
    const observations = [...this.heard.values()];
    this.heard.clear();
    return observations;
  }

  private identify(device: BleDevice): string | null {
    const beacon = iBeaconOf(device.manufacturerData ?? null);
    if (beacon) return anchorIdFor('ble_beacon', beacon);
    const service = device.serviceUUIDs?.[0];
    if (service) return anchorIdFor('ble_beacon', service);
    if (device.id) return anchorIdFor('ble_beacon', device.id);
    return null;
  }
}

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
