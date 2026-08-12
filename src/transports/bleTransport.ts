import { Buffer } from 'buffer';
import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform, type EmitterSubscription } from 'react-native';
import BLEAdvertiser from 'react-native-ble-advertiser';
import { BleManager, type Device, type Subscription } from 'react-native-ble-plx';
import type { PeerInfo } from '../core/contracts';
import { BaseTransport } from './meshTransport';
import { SessionHandles } from './sessionHandles';

const COMPANY_ID = 0xc0f1;
const BEACON_UUID = '0000c0f1-0000-1000-8000-00805f9b34fb';
const MAILBOX_SERVICE = 'c0f10001-7a6b-4a40-9c73-97d98db48a01';
const MAILBOX_CHARACTERISTIC = 'c0f10002-7a6b-4a40-9c73-97d98db48a01';

interface AdvertiserDevice {
  deviceAddress?: string;
  rssi?: number;
  manufData?: number[];
  serviceUuids?: string[];
}

/** BLE advertisement discovery plus GATT writes for compact mesh packets. */
export class BleTransport extends BaseTransport {
  readonly kind = 'bluetooth' as const;
  readonly name = 'Bluetooth LE';
  readonly priority = 80;
  private readonly manager = new BleManager();
  private readonly handles = new SessionHandles();
  private readonly knownPeers = new Map<string, PeerInfo>();
  private readonly devices = new Map<string, Device>();
  private readonly peerPhysicalIds = new Map<string, string>();
  private advertiserSubscription?: EmitterSubscription;
  private stateSubscription?: Subscription;
  private nodeId = '';

  constructor() {
    super();
    this.currentStatus = {
      kind: this.kind, name: this.name, available: false, running: false,
      discoverable: false, peerCount: 0, detail: 'Not started',
    };
  }

  async isAvailable(): Promise<boolean> {
    if (Platform.OS === 'web' || !NativeModules.BLEAdvertiser) {
      this.updateStatus({ available: false, running: false, discoverable: false, detail: 'Requires an Expo development build' });
      return false;
    }
    const active = await BLEAdvertiser.isActive().catch(() => false);
    this.updateStatus({ available: active, detail: active ? 'Ready' : 'Bluetooth is off' });
    return active;
  }

  async start(nodeId: string): Promise<void> {
    await this.requestPermissions();
    if (!(await this.isAvailable())) throw new Error('Bluetooth is unavailable');
    this.nodeId = nodeId;
    BLEAdvertiser.setCompanyId(COMPANY_ID);
    const events = new NativeEventEmitter(NativeModules.BLEAdvertiser);
    this.advertiserSubscription = events.addListener('onDeviceFound', (device: AdvertiserDevice) => this.recordAdvertisement(device));
    this.stateSubscription = this.manager.onStateChange((state) => {
      const available = state === 'PoweredOn';
      this.updateStatus({ available, running: available && this.currentStatus.running, detail: available ? 'Advertising + scanning' : `Bluetooth ${state}` });
    }, true);

    await Promise.all([
      BLEAdvertiser.broadcast(BEACON_UUID, nodeIdBytes(nodeId), {
        advertiseMode: BLEAdvertiser.ADVERTISE_MODE_LOW_LATENCY,
        txPowerLevel: BLEAdvertiser.ADVERTISE_TX_POWER_MEDIUM,
        connectable: true,
        includeDeviceName: false,
        includeTxPowerLevel: false,
      }),
      BLEAdvertiser.scan([0xc0, 0xf1], {
        scanMode: BLEAdvertiser.SCAN_MODE_LOW_LATENCY,
        matchMode: BLEAdvertiser.MATCH_MODE_AGGRESSIVE,
        numberOfMatches: BLEAdvertiser.MATCH_NUM_MAX_ADVERTISEMENT,
        reportDelay: 0,
      }),
    ]);
    this.manager.startDeviceScan([MAILBOX_SERVICE], null, (error, device) => {
      if (error) { this.updateStatus({ detail: `GATT scan: ${error.message}` }); return; }
      if (device) this.recordGattDevice(device);
    });
    this.updateStatus({ available: true, running: true, discoverable: true, detail: 'Advertising + scanning' });
  }

  async updateNodeId(nodeId: string): Promise<void> {
    if (!this.currentStatus.running || nodeId === this.nodeId) return;
    await BLEAdvertiser.stopBroadcast().catch(() => undefined);
    this.nodeId = nodeId;
    await BLEAdvertiser.broadcast(BEACON_UUID, nodeIdBytes(nodeId), {
      advertiseMode: BLEAdvertiser.ADVERTISE_MODE_LOW_LATENCY,
      txPowerLevel: BLEAdvertiser.ADVERTISE_TX_POWER_MEDIUM,
      connectable: true,
      includeDeviceName: false,
    });
  }

  async stop(): Promise<void> {
    this.advertiserSubscription?.remove(); this.advertiserSubscription = undefined;
    this.stateSubscription?.remove(); this.stateSubscription = undefined;
    this.manager.stopDeviceScan();
    await Promise.allSettled([BLEAdvertiser.stopBroadcast(), BLEAdvertiser.stopScan()]);
    this.knownPeers.clear(); this.devices.clear(); this.peerPhysicalIds.clear(); this.handles.clear();
    this.publishPeers([]);
    this.updateStatus({ running: false, discoverable: false, detail: 'Stopped' });
  }

  peers(): PeerInfo[] { return [...this.knownPeers.values()]; }

  async send(peerId: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length > 255) throw new Error('BLE packets are limited to 255 bytes');
    const physicalId = this.peerPhysicalIds.get(peerId);
    const device = physicalId ? this.devices.get(physicalId) : undefined;
    if (!device) throw new Error('BLE peer has no GATT data path');
    const connected = await device.isConnected() ? device : await device.connect({ timeout: 5_000 });
    await connected.discoverAllServicesAndCharacteristics();
    await connected.writeCharacteristicWithResponseForService(
      MAILBOX_SERVICE, MAILBOX_CHARACTERISTIC, Buffer.from(bytes).toString('base64'),
    );
  }

  async broadcast(bytes: Uint8Array): Promise<void> {
    const targets = this.peers().filter((peer) => this.peerPhysicalIds.has(peer.id));
    if (targets.length === 0) return; // advertising still makes this transport useful/discoverable
    const results = await Promise.allSettled(targets.map((peer) => this.send(peer.id, bytes)));
    if (!results.some((result) => result.status === 'fulfilled')) throw (results[0] as PromiseRejectedResult).reason;
  }

  private recordAdvertisement(device: AdvertiserDevice): void {
    const physical = device.deviceAddress;
    const data = device.manufData;
    if (!physical || !data || data.length < 2) return;
    const peerNodeId = data.slice(-2).map((byte) => (byte & 0xff).toString(16).padStart(2, '0')).join('');
    if (peerNodeId === this.nodeId) return;
    const id = this.handles.get(physical, 'ble');
    this.peerPhysicalIds.set(id, physical);
    this.knownPeers.set(id, {
      id, nodeId: peerNodeId, transport: this.kind, rssi: device.rssi, lastSeen: Date.now(),
    });
    this.publishPeers(this.peers());
  }

  private recordGattDevice(device: Device): void {
    this.devices.set(device.id, device);
    const id = this.handles.get(device.id, 'ble');
    this.peerPhysicalIds.set(id, device.id);
    const existing = this.knownPeers.get(id);
    this.knownPeers.set(id, {
      id, nodeId: existing?.nodeId, transport: this.kind, rssi: device.rssi ?? existing?.rssi,
      lastSeen: Date.now(),
    });
    this.publishPeers(this.peers());
  }

  private async requestPermissions(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const permissions = Platform.Version >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    await PermissionsAndroid.requestMultiple(permissions);
  }
}

function nodeIdBytes(nodeId: string): number[] {
  if (!/^[0-9a-f]{4}$/i.test(nodeId)) throw new Error('node ID must be four hex characters');
  return [Number.parseInt(nodeId.slice(0, 2), 16), Number.parseInt(nodeId.slice(2), 16)];
}
