import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform, type EmitterSubscription, NativeModules } from 'react-native';
import * as WifiP2p from 'react-native-wifi-p2p';
import type { PeerInfo } from '../core/contracts';
import { BaseTransport } from './meshTransport';
import { hasWifiDirectModule } from './nativeCapabilities';
import { SessionHandles } from './sessionHandles';
import { parseWifiDirectPayload } from './wifiDirectPayload';

const CONNECTION_TIMEOUT_MS = 4_500;

/** Android Wi-Fi Direct discovery and compact message path. */
export class WifiDirectTransport extends BaseTransport {
  readonly kind = 'wifi-direct' as const;
  readonly name = 'Wi-Fi Direct';
  readonly priority = 70;
  private readonly handles = new SessionHandles();
  private readonly knownPeers = new Map<string, PeerInfo>();
  private readonly physicalAddresses = new Map<string, string>();
  private readonly peerEndpoints = new Map<string, string>();
  private readonly dataEndpoints = new Set<string>();
  private peersSubscription?: EmitterSubscription;
  private connectionSubscription?: EmitterSubscription;
  private receiveLoop = false;

  constructor() {
    super();
    this.currentStatus = {
      kind: this.kind, name: this.name, available: false, running: false,
      discoverable: false, peerCount: 0, detail: 'Android development build required',
    };
  }

  async isAvailable(): Promise<boolean> {
    const available = hasWifiDirectModule(Platform.OS, NativeModules);
    this.updateStatus({ available, detail: available ? 'Ready' : 'Unavailable on this platform' });
    return available;
  }

  override async prepare(): Promise<void> { await this.requestPermission(); }

  async start(_nodeId: string): Promise<void> {
    if (!(await this.isAvailable())) throw new Error('Wi-Fi Direct is unavailable');
    await WifiP2p.initialize();
    this.peersSubscription = WifiP2p.subscribeOnPeersUpdates(({ devices }) => {
      const active = new Set<string>();
      devices.forEach((device) => {
        const id = this.handles.get(device.deviceAddress, 'direct');
        active.add(id); this.physicalAddresses.set(id, device.deviceAddress);
        this.knownPeers.set(id, { id, transport: this.kind, lastSeen: Date.now() });
      });
      [...this.knownPeers.keys()].filter((id) => !active.has(id)).forEach((id) => {
        this.knownPeers.delete(id); this.physicalAddresses.delete(id); this.peerEndpoints.delete(id);
      });
      this.publishPeers(this.peers());
    });
    this.connectionSubscription = WifiP2p.subscribeOnConnectionInfoUpdates((info) => this.recordConnection(info));
    await WifiP2p.startDiscoveringPeers();
    const info = await WifiP2p.getConnectionInfo().catch(() => undefined);
    if (info) this.recordConnection(info);
    this.updateStatus({ available: true, running: true, discoverable: true,
      detail: info?.groupFormed ? 'Direct group + message socket' : 'Discoverable + scanning' });
  }

  async stop(): Promise<void> {
    this.receiveLoop = false;
    try { WifiP2p.stopReceivingMessage(); } catch { /* not initialized */ }
    this.peersSubscription?.remove(); this.connectionSubscription?.remove();
    this.peersSubscription = undefined; this.connectionSubscription = undefined;
    await WifiP2p.stopDiscoveringPeers().catch(() => undefined);
    await WifiP2p.cancelConnect().catch(() => undefined);
    await WifiP2p.removeGroup().catch(() => undefined);
    this.knownPeers.clear(); this.physicalAddresses.clear(); this.peerEndpoints.clear(); this.dataEndpoints.clear();
    this.handles.clear(); this.publishPeers([]);
    this.updateStatus({ running: false, discoverable: false, detail: 'Stopped' });
  }

  peers(): PeerInfo[] { return [...this.knownPeers.values()]; }

  async send(peerId: string, bytes: Uint8Array): Promise<void> {
    this.assertPacket(bytes);
    let destination = this.peerEndpoints.get(peerId);
    if (!destination) {
      const address = this.physicalAddresses.get(peerId);
      if (!address) throw new Error('Wi-Fi Direct peer is unavailable');
      const info = await this.ensureConnection(address);
      destination = !info.isGroupOwner ? info.groupOwnerAddress?.hostAddress : undefined;
      if (destination) {
        this.peerEndpoints.set(peerId, destination); this.dataEndpoints.add(destination);
      }
    }
    if (!destination) throw new Error('Waiting for the Wi-Fi Direct peer data endpoint');
    await this.sendTo(bytes, destination);
  }

  async broadcast(bytes: Uint8Array): Promise<void> {
    this.assertPacket(bytes);
    const endpoints = [...this.dataEndpoints];
    if (endpoints.length > 0) {
      const results = await Promise.allSettled(endpoints.map((address) => this.sendTo(bytes, address)));
      results.forEach((result, index) => {
        if (result.status === 'rejected') this.dataEndpoints.delete(endpoints[index]);
      });
      if (results.some((result) => result.status === 'fulfilled')) return;
      throw (results[0] as PromiseRejectedResult).reason;
    }
    const peer = this.peers()[0];
    if (peer) await this.send(peer.id, bytes);
  }

  private recordConnection(info: WifiP2p.WifiP2pInfo): void {
    if (!info.groupFormed) {
      this.receiveLoop = false; this.dataEndpoints.clear(); this.peerEndpoints.clear();
      try { WifiP2p.stopReceivingMessage(); } catch { /* no active socket */ }
      return;
    }
    const ownerAddress = info.groupOwnerAddress?.hostAddress;
    if (!info.isGroupOwner && ownerAddress) this.dataEndpoints.add(ownerAddress);
    this.startReceiveLoop();
    if (this.currentStatus.running) this.updateStatus({ detail: 'Direct group + message socket' });
  }

  private async ensureConnection(deviceAddress: string): Promise<WifiP2p.WifiP2pInfo> {
    let info = await WifiP2p.getConnectionInfo();
    if (!info.groupFormed) {
      await WifiP2p.connect(deviceAddress);
      const deadline = Date.now() + CONNECTION_TIMEOUT_MS;
      do {
        await delay(250);
        info = await WifiP2p.getConnectionInfo();
        if (info.groupFormed) break;
      } while (Date.now() < deadline);
    }
    if (!info.groupFormed) throw new Error('Wi-Fi Direct connection timed out');
    this.recordConnection(info);
    return info;
  }

  private startReceiveLoop(): void {
    if (this.receiveLoop) return;
    this.receiveLoop = true;
    void (async () => {
      while (this.receiveLoop) {
        try {
          const raw = await WifiP2p.receiveMessage({ meta: true }) as unknown;
          if (!this.receiveLoop) return;
          const payload = parseWifiDirectPayload(raw);
          if (!payload) continue;
          if (payload.fromAddress) this.dataEndpoints.add(payload.fromAddress);
          this.packets.emit({
            transport: this.kind,
            peerId: payload.fromAddress ? this.handles.get(payload.fromAddress, 'direct-session') : 'direct:connected',
            bytes: new Uint8Array(Buffer.from(payload.encoded, 'base64')),
            receivedAt: Date.now(),
          });
        } catch {
          if (this.receiveLoop) await delay(500);
        }
      }
    })();
  }

  private sendTo(bytes: Uint8Array, destination: string): Promise<unknown> {
    return WifiP2p.sendMessageTo(Buffer.from(bytes).toString('base64'), destination);
  }

  private assertPacket(bytes: Uint8Array): void {
    if (bytes.length > 255) throw new Error('Mesh packets must fit 255 bytes');
  }

  private async requestPermission(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const permission = Platform.Version >= 33
      ? PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES
      : PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    const result = await PermissionsAndroid.request(permission);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Nearby Wi-Fi permission was not granted');
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
