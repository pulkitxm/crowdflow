import type { MeshMessage } from '../core/contracts';

export class MessageRateLimiter {
  private readonly lastAccepted = new Map<string, number>();

  allow(message: MeshMessage, now = Date.now()): boolean {
    const interval = message.type === 'STATE_UPDATE' ? 2_000 : message.type === 'HEARTBEAT' ? 8_000 : 0;
    if (interval === 0) return true;
    const key = `${message.source}:${message.type}`;
    const previous = this.lastAccepted.get(key);
    if (previous !== undefined && now - previous < interval) return false;
    this.lastAccepted.set(key, now);
    return true;
  }
}
