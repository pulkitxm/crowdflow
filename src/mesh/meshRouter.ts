import type { MeshMessage, MeshStats, ReceivedPacket } from '../core/contracts';
import { TypedEvent } from '../core/events';
import { LruSet } from '../core/lru';
import { decodeMeshMessage, encodeMeshMessage, messageKey } from '../protocol/meshCodec';
import type { TransportManager } from '../transports/transportManager';
import { MessageRateLimiter } from './messageRateLimiter';

/** Controlled flooding with TTL, dedupe, source limits, and relay jitter. */
export class MeshRouter {
  readonly messages = new TypedEvent<MeshMessage>();
  readonly statsChanged = new TypedEvent<MeshStats>();
  private readonly seen = new LruSet<string>(512);
  private readonly limiter = new MessageRateLimiter();
  private unsubscribe?: () => void;
  private stats: MeshStats = {
    sent: 0, received: 0, relayed: 0, duplicateDrops: 0, malformedDrops: 0, rateLimitDrops: 0,
  };

  constructor(
    private readonly transports: TransportManager,
    private readonly random: () => number = Math.random,
  ) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.transports.packets.subscribe((packet) => void this.onPacket(packet));
  }

  stop(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined; this.seen.clear();
  }

  snapshot(): MeshStats { return { ...this.stats }; }

  async originate(message: MeshMessage): Promise<void> {
    this.seen.seenOrAdd(messageKey(message));
    await this.transports.broadcast(encodeMeshMessage(message));
    this.increment('sent');
  }

  private async onPacket(packet: ReceivedPacket): Promise<void> {
    let message: MeshMessage;
    try { message = decodeMeshMessage(packet.bytes); }
    catch { this.increment('malformedDrops'); return; }
    this.increment('received');
    if (this.seen.seenOrAdd(messageKey(message))) { this.increment('duplicateDrops'); return; }
    if (!this.limiter.allow(message)) { this.increment('rateLimitDrops'); return; }
    this.messages.emit(message);
    if (message.ttl <= 1 || message.type === 'ACK' || message.type === 'HELLO') return;
    await delay(Math.floor(this.random() * 201));
    try {
      await this.transports.broadcast(encodeMeshMessage({ ...message, ttl: message.ttl - 1 }));
      this.increment('sent'); this.increment('relayed');
    } catch { /* another transport may become available on the next packet */ }
  }

  private increment(key: keyof MeshStats): void {
    this.stats = { ...this.stats, [key]: this.stats[key] + 1 };
    this.statsChanged.emit(this.snapshot());
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
