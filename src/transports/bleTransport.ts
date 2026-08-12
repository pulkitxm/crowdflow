import { Buffer } from 'buffer';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import Peripheral, {
  AdvertiseMode,
  Permission,
  Property,
  TxPowerLevel,
  type WriteEvent,
} from 'react-native-multi-ble-peripheral';
import { BleManager, type Device, type Subscription } from 'react-native-ble-plx';
import type { PeerInfo } from '../core/contracts';
import { BaseTransport } from './meshTransport';
import { SessionHandles } from './sessionHandles';

const COMPANY_ID = 0xc0f1;
// 16-bit Bluetooth-base UUID keeps the Android advertisement below the 31-byte legacy limit.
const BEACON_SERVICE = '0000c0f1-0000-1000-8000-00805f9b34fb';
const MAILBOX_SERVICE = 'c0f10001-7a6b-4a40-9c73-97d98db48a01';
const MAILBOX_CHARACTERISTIC = 'c0f10002-7a6b-4a40-9c73-97d98db48a01';
const PEER_MAX_AGE_MS = 20_000;

/** BLE peripheral + central: advertises/scans and exchanges packets through a GATT mailbox. */
export class BleTransport extends BaseTransport {
  readonly kind = 'bluetooth' as const;
  readonly name = 'Bluetooth LE';
  readonly priority = 80;
  private readonly manager = new BleManager();
  private readonly handles = new SessionHandles();
  private readonly knownPeers = new Map<string, PeerInfo>();
  private readonly devices = new Map<string, Device>();
  private readonly peerPhysicalIds = new Map<string, string>();
  private peripheral?: Peripheral;
  private peripheralReady?: Promise<void>;
  private writeListener?: (event: NativeWriteEvent) => void;
  private stateSubscription?: Subscription;
  private peerSweep?: ReturnType<typeof setInterval>;
  private nodeId = '';

  constructor() {
    super();
    this.currentStatus = {
      kind: this.kind, name: this.name, available: false, running: false,
      discoverable: false, peerCount: 0, detail: 'Not started',
    };
  }

  async isAvailable(): Promise<boolean> {
    if (Platform.OS === 'web' || !NativeModules.ReactNativeMultiBlePeripheral) {
      this.updateStatus({ available: false, running: false, discoverable: false, detail: 'Requires an Expo development build' });
      return false;
    }
    const state = await this.manager.state().catch(() => 'Unknown');
    const available = state === 'PoweredOn';
    this.updateStatus({ available, detail: available ? 'Ready' : `Bluetooth ${state}` });
    return available;
  }

  override async prepare(): Promise<void> { await this.requestPermissions(); }

  async start(nodeId: string): Promise<void> {
    if (!(await this.isAvailable())) throw new Error('Bluetooth is unavailable');
    this.nodeId = nodeId;
    // iOS ignores manufacturer data in this module, so expose only the rotating ID as local name.
    // Do not do this on Android: setDeviceName there changes the user's global Bluetooth name.
    if (Platform.OS === 'ios') await Peripheral.setDeviceName(`cf-${nodeId}`);
    this.peripheral = new Peripheral();
    this.peripheralReady = new Promise((resolve, reject) => {
      this.peripheral!.once('ready', resolve);
      this.peripheral!.once('error', reject);
    });
    await this.peripheralReady;
    await this.peripheral.addService(MAILBOX_SERVICE, true);
    await this.peripheral.addCharacteristic(
      MAILBOX_SERVICE,
      MAILBOX_CHARACTERISTIC,
      Property.WRITE | Property.WRITE_NO_RESPONSE | Property.NOTIFY,
      Permission.WRITEABLE,
    );
    this.writeListener = (event: NativeWriteEvent) => {
      const service = event.serviceUuid ?? event.serviceUUID ?? event.service;
      const characteristic = event.characteristicUuid ?? event.characteristicUUID ?? event.characteristic;
      if (service?.toLowerCase() !== MAILBOX_SERVICE || characteristic?.toLowerCase() !== MAILBOX_CHARACTERISTIC) return;
      if (event.offset && event.offset > 0) return;
      const bytes = new Uint8Array(Buffer.from(event.value, 'base64'));
      if (bytes.length === 0 || bytes.length > 255) return;
      const peerId = event.device ? this.handles.get(event.device, 'ble-central') : 'ble:connected-central';
      this.packets.emit({ transport: this.kind, peerId, bytes, receivedAt: Date.now() });
    };
    this.peripheral.on('write', this.writeListener);
    await this.startAdvertising(nodeId);

    this.manager.startDeviceScan([BEACON_SERVICE, MAILBOX_SERVICE], { allowDuplicates: true }, (error, device) => {
      if (error) { this.updateStatus({ detail: `BLE scan: ${error.message}` }); return; }
      if (device) this.recordDevice(device);
    });
    this.stateSubscription = this.manager.onStateChange((state) => {
      const available = state === 'PoweredOn';
      this.updateStatus({ available, running: available && this.currentStatus.running, discoverable: available && this.currentStatus.discoverable,
        detail: available ? 'Advertising + scanning + GATT mailbox' : `Bluetooth ${state}` });
    }, true);
    this.peerSweep = setInterval(() => this.prunePeers(), 5_000);
    this.updateStatus({ available: true, running: true, discoverable: true, detail: 'Advertising + scanning + GATT mailbox' });
  }

  async updateNodeId(nodeId: string): Promise<void> {
    if (!this.currentStatus.running || nodeId === this.nodeId || !this.peripheral) return;
    await this.peripheral.stopAdvertising();
    this.nodeId = nodeId;
    if (Platform.OS === 'ios') await Peripheral.setDeviceName(`cf-${nodeId}`);
    await this.startAdvertising(nodeId);
  }

  async stop(): Promise<void> {
    this.stateSubscription?.remove(); this.stateSubscription = undefined;
    if (this.peerSweep) clearInterval(this.peerSweep); this.peerSweep = undefined;
    this.manager.stopDeviceScan();
    if (this.peripheral) {
      if (this.writeListener) this.peripheral.off('write', this.writeListener);
      await this.peripheral.stopAdvertising().catch(() => undefined);
      await this.peripheral.destroy().catch(() => undefined);
    }
    this.peripheral = undefined; this.peripheralReady = undefined; this.writeListener = undefined;
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
    let connected = await device.isConnected() ? device : await device.connect({ timeout: 5_000 });
    if (Platform.OS === 'android') connected = await connected.requestMTU(258).catch(() => connected);
    await connected.discoverAllServicesAndCharacteristics();
    const value = Buffer.from(bytes).toString('base64');
    try {
      await connected.writeCharacteristicWithResponseForService(MAILBOX_SERVICE, MAILBOX_CHARACTERISTIC, value);
    } catch {
      await connected.writeCharacteristicWithoutResponseForService(MAILBOX_SERVICE, MAILBOX_CHARACTERISTIC, value);
    }
  }

  async broadcast(bytes: Uint8Array): Promise<void> {
    const targets = this.peers().filter((peer) => this.peerPhysicalIds.has(peer.id));
    const sends = targets.map((peer) => this.send(peer.id, bytes));
    if (this.peripheral) sends.push(this.peripheral.sendNotification(
      MAILBOX_SERVICE, MAILBOX_CHARACTERISTIC, Buffer.from(bytes), false,
    ));
    if (sends.length === 0) return;
    const results = await Promise.allSettled(sends);
    // No subscribers/connected centrals is not a transport failure while the beacon is discoverable.
    if (targets.length > 0 && !results.some((result) => result.status === 'fulfilled')) {
      throw (results[0] as PromiseRejectedResult).reason;
    }
  }

  private async startAdvertising(nodeId: string): Promise<void> {
    if (!this.peripheral) throw new Error('BLE peripheral is not ready');
    await this.peripheral.startAdvertising(
      { [BEACON_SERVICE]: Buffer.from(nodeIdBytes(nodeId)) },
      {
        mode: AdvertiseMode.LOW_LATENCY,
        txPowerLevel: TxPowerLevel.MEDIUM,
        connectable: true,
        includeDeviceName: false,
        includeTxPowerLevel: false,
        manufacturerId: COMPANY_ID,
        manufacturerData: Buffer.from(nodeIdBytes(nodeId)),
      },
    );
  }

  private recordDevice(device: Device): void {
    const serviceEntry = Object.entries(device.serviceData ?? {})
      .find(([uuid]) => uuid.toLowerCase() === BEACON_SERVICE);
    const serviceData = serviceEntry ? Buffer.from(serviceEntry[1], 'base64') : undefined;
    const manufacturer = device.manufacturerData ? Buffer.from(device.manufacturerData, 'base64') : undefined;
    const advertisedId = serviceData && serviceData.length >= 2
      ? serviceData.subarray(0, 2).toString('hex')
      : manufacturer && manufacturer.length >= 2 ? manufacturer.subarray(-2).toString('hex') : undefined;
    const localNameId = (device.localName ?? device.name)?.match(/^cf-([0-9a-f]{4})$/i)?.[1]?.toLowerCase();
    const peerNodeId = advertisedId ?? localNameId;
    if (peerNodeId === this.nodeId) return;
    const id = this.handles.get(device.id, 'ble');
    this.devices.set(device.id, device); this.peerPhysicalIds.set(id, device.id);
    const existing = this.knownPeers.get(id);
    this.knownPeers.set(id, {
      id, nodeId: peerNodeId ?? existing?.nodeId, transport: this.kind,
      rssi: device.rssi ?? existing?.rssi, lastSeen: Date.now(),
    });
    this.publishPeers(this.peers());
  }

  private prunePeers(now = Date.now()): void {
    const stale = [...this.knownPeers.entries()]
      .filter(([, peer]) => now - peer.lastSeen > PEER_MAX_AGE_MS)
      .map(([id]) => id);
    if (stale.length === 0) return;
    stale.forEach((id) => {
      const physicalId = this.peerPhysicalIds.get(id);
      this.knownPeers.delete(id); this.peerPhysicalIds.delete(id);
      if (physicalId) this.devices.delete(physicalId);
    });
    this.publishPeers(this.peers());
  }

  private async requestPermissions(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const permissions = Platform.Version >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const results = await PermissionsAndroid.requestMultiple(permissions);
    if (permissions.some((permission) => results[permission] !== PermissionsAndroid.RESULTS.GRANTED)) {
      throw new Error('Bluetooth permission was not granted');
    }
  }
}

type NativeWriteEvent = WriteEvent & {
  service?: string;
  characteristic?: string;
  serviceUUID?: string;
  characteristicUUID?: string;
  device?: string;
  offset?: number;
};

function nodeIdBytes(nodeId: string): number[] {
  if (!/^[0-9a-f]{4}$/i.test(nodeId)) throw new Error('node ID must be four hex characters');
  return [Number.parseInt(nodeId.slice(0, 2), 16), Number.parseInt(nodeId.slice(2), 16)];
}
