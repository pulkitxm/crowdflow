import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform, type EmitterSubscription, NativeModules } from 'react-native';
import * as WifiP2p from 'react-native-wifi-p2p';
import type { PeerInfo } from '../core/contracts';
import { BaseTransport } from './meshTransport';
import { hasWifiDirectModule } from './nativeCapabilities';
import { SessionHandles } from './sessionHandles';

/** Android Wi-Fi Direct discovery and compact message path. */
export class WifiDirectTransport extends BaseTransport {
  readonly kind = 'wifi-direct' as const;
  readonly name = 'Wi-Fi Direct';
  readonly priority = 70;
  private readonly handles = new SessionHandles();
  private readonly knownPeers = new Map<string, PeerInfo>();
  private readonly physicalAddresses = new Map<string, string>();
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

  async start(_nodeId: string): Promise<void> {
    await this.requestPermission();
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
        this.knownPeers.delete(id); this.physicalAddresses.delete(id);
      });
      this.publishPeers(this.peers());
    });
    this.connectionSubscription = WifiP2p.subscribeOnConnectionInfoUpdates((info) => {
      if (info.groupFormed) this.startReceiveLoop();
    });
    await WifiP2p.startDiscoveringPeers();
    this.updateStatus({ available: true, running: true, discoverable: true, detail: 'Discoverable + scanning' });
  }

  async stop(): Promise<void> {
    this.receiveLoop = false;
    WifiP2p.stopReceivingMessage();
    this.peersSubscription?.remove(); this.connectionSubscription?.remove();
    this.peersSubscription = undefined; this.connectionSubscription = undefined;
    await WifiP2p.stopDiscoveringPeers().catch(() => undefined);
    this.knownPeers.clear(); this.physicalAddresses.clear(); this.handles.clear();
    this.publishPeers([]);
    this.updateStatus({ running: false, discoverable: false, detail: 'Stopped' });
  }

  peers(): PeerInfo[] { return [...this.knownPeers.values()]; }

  async send(peerId: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length > 255) throw new Error('Mesh packets must fit 255 bytes');
    const address = this.physicalAddresses.get(peerId);
    if (!address) throw new Error('Wi-Fi Direct peer is unavailable');
    await WifiP2p.connect(address).catch(() => undefined);
    const info = await WifiP2p.getConnectionInfo();
    const destination = info.groupOwnerAddress?.hostAddress;
    if (!destination) throw new Error('Wi-Fi Direct group has no data endpoint');
    await WifiP2p.sendMessageTo(Buffer.from(bytes).toString('base64'), destination);
  }

  async broadcast(bytes: Uint8Array): Promise<void> {
    const peers = this.peers();
    if (peers.length === 0) return;
    const results = await Promise.allSettled(peers.map((peer) => this.send(peer.id, bytes)));
    if (!results.some((result) => result.status === 'fulfilled')) throw (results[0] as PromiseRejectedResult).reason;
  }

  private startReceiveLoop(): void {
    if (this.receiveLoop) return;
    this.receiveLoop = true;
    void (async () => {
      while (this.receiveLoop) {
        try {
          const encoded = await WifiP2p.receiveMessage({ meta: false });
          if (typeof encoded === 'string' && encoded.length > 0) {
            this.packets.emit({
              transport: this.kind, peerId: 'direct:connected',
              bytes: new Uint8Array(Buffer.from(encoded, 'base64')), receivedAt: Date.now(),
            });
          }
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    })();
  }

  private async requestPermission(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const permission = Platform.Version >= 33
      ? PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES
      : PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    await PermissionsAndroid.request(permission);
  }
}
