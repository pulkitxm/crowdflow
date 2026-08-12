declare module 'react-native-ble-advertiser' {
  interface AdvertiseOptions {
    advertiseMode?: number;
    txPowerLevel?: number;
    includeDeviceName?: boolean;
    includeTxPowerLevel?: boolean;
    connectable?: boolean;
  }
  interface ScanOptions {
    scanMode?: number;
    matchMode?: number;
    numberOfMatches?: number;
    reportDelay?: number;
  }
  interface BLEAdvertiserModule {
    ADVERTISE_MODE_LOW_LATENCY: number;
    ADVERTISE_TX_POWER_MEDIUM: number;
    SCAN_MODE_LOW_LATENCY: number;
    MATCH_MODE_AGGRESSIVE: number;
    MATCH_NUM_MAX_ADVERTISEMENT: number;
    setCompanyId(value: number): void;
    broadcast(uuid: string, data: number[], options?: AdvertiseOptions): Promise<string>;
    stopBroadcast(): Promise<string>;
    scan(dataFilter: number[], options?: ScanOptions): Promise<string>;
    scanByService(uuid: string, options?: ScanOptions): Promise<string>;
    stopScan(): Promise<string>;
    getAdapterState(): Promise<string>;
    isActive(): Promise<boolean>;
  }
  const module: BLEAdvertiserModule;
  export default module;
}

declare module 'react-native-zeroconf' {
  interface ZeroconfService {
    name: string;
    fullName?: string;
    host?: string;
    port: number;
    addresses?: string[];
    txt?: Record<string, string>;
  }
  export const ImplType: { NSD: string; DNSSD: string };
  export default class Zeroconf {
    on(event: 'resolved' | 'published', listener: (service: ZeroconfService) => void): this;
    on(event: 'remove' | 'found', listener: (name: string) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    scan(type?: string, protocol?: string, domain?: string, implType?: string): void;
    stop(implType?: string): void;
    publishService(type: string, protocol: string, domain: string, name: string, port: number, txt?: Record<string, string>, implType?: string): void;
    unpublishService(name: string, implType?: string): void;
    removeDeviceListeners(): void;
  }
}
