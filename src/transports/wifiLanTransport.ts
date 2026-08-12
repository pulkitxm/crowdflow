import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import dgram from 'react-native-udp';
import Zeroconf, { ImplType } from 'react-native-zeroconf';
import type { PeerInfo } from '../core/contracts';
import { BaseTransport } from './meshTransport';

const PORT = 47_317;
const BROADCAST_HOST = '255.255.255.255';
const SERVICE_TYPE = 'crowdflow';

/**
 * Cross-platform Wi-Fi LAN transport: mDNS makes the node detectable and UDP carries packets.
 * Android Wi-Fi Direct runs beside it for internet-free P2P discovery.
 */
export class WifiLanTransport extends BaseTransport {
  readonly kind = 'wifi-lan' as const;
  readonly name = 'Wi-Fi LAN';
  readonly priority = 90;
  private readonly zeroconf = new Zeroconf();
  private readonly knownPeers = new Map<string, PeerInfo>();
  private socket?: ReturnType<typeof dgram.createSocket>;
  private serviceName = '';
  private nodeId = '';

  constructor() {
    super();
    this.currentStatus = {
      kind: this.kind, name: this.name, available: Platform.OS !== 'web', running: false,
      discoverable: false, peerCount: 0, detail: 'mDNS + UDP',
    };
  }

  async isAvailable(): Promise<boolean> {
    const available = Platform.OS !== 'web';
    this.updateStatus({ available, detail: available ? 'Ready' : 'Native development build required' });
    return available;
  }

  async start(nodeId: string): Promise<void> {
    if (!(await this.isAvailable())) throw new Error('Wi-Fi LAN transport is unavailable');
    this.nodeId = nodeId;
    this.serviceName = `crowdflow-${nodeId}`;
    this.zeroconf.on('resolved', (service) => {
      const peerNodeId = service.txt?.node;
      if (!peerNodeId || peerNodeId === this.nodeId) return;
      const host = service.addresses?.find((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address)) ?? service.host;
      if (!host) return;
      const id = `lan:${peerNodeId}`;
      this.knownPeers.set(id, {
        id, nodeId: peerNodeId, transport: this.kind, host, port: service.port, lastSeen: Date.now(),
      });
      this.publishPeers(this.peers());
    });
    this.zeroconf.on('remove', (name) => {
      const id = [...this.knownPeers.entries()].find(([, peer]) => name.endsWith(peer.nodeId ?? ''))?.[0];
      if (id) { this.knownPeers.delete(id); this.publishPeers(this.peers()); }
    });
    this.zeroconf.on('error', (error) => this.updateStatus({ detail: `mDNS: ${error.message}` }));

    this.socket = dgram.createSocket({ type: 'udp4', reusePort: true });
    (this.socket as unknown as { on: (event: string, listener: (...args: any[]) => void) => void }).on('message', (message: Buffer, remote: { address: string; port: number }) => {
      this.packets.emit({
        transport: this.kind, peerId: `lan-host:${remote.address}:${remote.port}`,
        bytes: new Uint8Array(message), receivedAt: Date.now(),
      });
    });
    await new Promise<void>((resolve, reject) => {
      (this.socket as unknown as { once: (event: string, listener: (...args: any[]) => void) => void }).once('error', reject);
      this.socket!.bind(PORT, '0.0.0.0', () => {
        try { this.socket!.setBroadcast(true); resolve(); } catch (error) { reject(error); }
      });
    });
    const impl = Platform.OS === 'android' ? ImplType.DNSSD : undefined;
    this.zeroconf.publishService(SERVICE_TYPE, 'udp', 'local.', this.serviceName, PORT, { node: nodeId, v: '1' }, impl);
    this.zeroconf.scan(SERVICE_TYPE, 'udp', 'local.', impl);
    this.updateStatus({ available: true, running: true, discoverable: true, detail: 'mDNS published + UDP listening' });
  }

  async updateNodeId(nodeId: string): Promise<void> {
    if (!this.currentStatus.running || nodeId === this.nodeId) return;
    const impl = Platform.OS === 'android' ? ImplType.DNSSD : undefined;
    this.zeroconf.unpublishService(this.serviceName, impl);
    this.nodeId = nodeId; this.serviceName = `crowdflow-${nodeId}`;
    this.zeroconf.publishService(SERVICE_TYPE, 'udp', 'local.', this.serviceName, PORT, { node: nodeId, v: '1' }, impl);
  }

  async stop(): Promise<void> {
    const impl = Platform.OS === 'android' ? ImplType.DNSSD : undefined;
    try { this.zeroconf.stop(impl); } catch { /* already stopped */ }
    try { if (this.serviceName) this.zeroconf.unpublishService(this.serviceName, impl); } catch { /* not published */ }
    this.zeroconf.removeDeviceListeners();
    this.socket?.close(); this.socket = undefined;
    this.knownPeers.clear(); this.publishPeers([]);
    this.updateStatus({ running: false, discoverable: false, detail: 'Stopped' });
  }

  peers(): PeerInfo[] { return [...this.knownPeers.values()]; }

  async send(peerId: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length > 255) throw new Error('Mesh packets must fit 255 bytes');
    const peer = this.knownPeers.get(peerId);
    if (!peer?.host || !peer.port) throw new Error('Wi-Fi peer endpoint is unavailable');
    await this.sendTo(bytes, peer.port, peer.host);
  }

  async broadcast(bytes: Uint8Array): Promise<void> {
    if (bytes.length > 255) throw new Error('Mesh packets must fit 255 bytes');
    const peers = this.peers();
    if (peers.length > 0) {
      const results = await Promise.allSettled(peers.map((peer) => this.send(peer.id, bytes)));
      if (results.some((result) => result.status === 'fulfilled')) return;
    }
    await this.sendTo(bytes, PORT, BROADCAST_HOST);
  }

  private sendTo(bytes: Uint8Array, port: number, host: string): Promise<void> {
    if (!this.socket) return Promise.reject(new Error('Wi-Fi UDP socket is stopped'));
    return new Promise((resolve, reject) => {
      const data = Buffer.from(bytes);
      this.socket!.send(data, 0, data.length, port, host, (error) => error ? reject(error) : resolve());
    });
  }
}
