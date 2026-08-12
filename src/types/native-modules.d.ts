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
