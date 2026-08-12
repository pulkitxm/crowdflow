import { getRandomBytes } from 'expo-crypto';

/** Converts physical radio handles into random app-session handles before they reach the core. */
export class SessionHandles {
  private readonly handles = new Map<string, string>();

  get(physicalHandle: string, prefix: string): string {
    let value = this.handles.get(physicalHandle);
    if (!value) {
      value = `${prefix}:${Array.from(getRandomBytes(6), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      this.handles.set(physicalHandle, value);
    }
    return value;
  }

  clear(): void { this.handles.clear(); }
}
