import type { MeshClass, MeshMessage } from '@crowdflow/contracts';
import { ASSUMED_MESH_BUFFER_MESSAGES, ASSUMED_URGENT_BURST_RELAYS, ASSUMED_URGENT_RELAYS_PER_MIN, dedupeRetentionS, sprayCopiesFor } from '@crowdflow/contracts';

export type MessageKey = `${string}:${number}`;
export const messageKey = (message: MeshMessage): MessageKey => `${message.source}:${message.sequence}`;
export interface Carried { message: MeshMessage; initial_ttl: number; received_at: number; copies: number; forwarded_to: Set<string> }
export class DedupeCache {
  private seen = new Map<MessageKey, number>();
  constructor(readonly retentionS = dedupeRetentionS()) {}
  has(key: MessageKey): boolean { return this.seen.has(key); }
  checkAndAdd(key: MessageKey, now: number): boolean { const fresh = !this.seen.has(key); this.seen.set(key, now); return fresh; }
  expire(now: number): void { for (const [key, time] of this.seen) if (now - time > this.retentionS) this.seen.delete(key); }
}
const RANK: Record<MeshClass, number> = { state: 0, uplink: 1, urgent: 2 };
export class MessageBuffer {
  private held = new Map<MessageKey, Carried>(); evictions = 0;
  constructor(readonly capacity = ASSUMED_MESH_BUFFER_MESSAGES) {}
  get size(): number { return this.held.size; } has(key: MessageKey): boolean { return this.held.has(key); }
  add(carried: Carried): boolean {
    const key = messageKey(carried.message); if (this.held.has(key)) return false;
    if (this.held.size >= this.capacity) { const victim = [...this.held.values()].sort((a, b) => RANK[a.message.traffic_class] - RANK[b.message.traffic_class] || a.received_at - b.received_at)[0]!; if (RANK[carried.message.traffic_class] <= RANK[victim.message.traffic_class]) return false; this.held.delete(messageKey(victim.message)); this.evictions += 1; }
    this.held.set(key, carried); return true;
  }
  drop(key: MessageKey): void { this.held.delete(key); }
  relayable(): Carried[] { return [...this.held.values()].filter((carried) => carried.message.ttl > 0).sort((a, b) => a.received_at - b.received_at); }
}
export class SprayAndWait {
  readonly name = 'spray-and-wait';
  consider(carried: Carried, peerId: string, peerOnline: boolean, peerSeen: boolean): number | null {
    if (carried.forwarded_to.has(peerId) || peerSeen) return null; if (carried.copies <= 1) return peerOnline ? 1 : null; return Math.trunc(carried.copies / 2);
  }
  commit(carried: Carried, copies: number): void { carried.copies = Math.max(1, carried.copies - copies); }
}
export class TokenBucket {
  private tokens: number; private last: number;
  constructor(readonly ratePerS = ASSUMED_URGENT_RELAYS_PER_MIN / 60, readonly capacity = ASSUMED_URGENT_BURST_RELAYS, now = 0) { this.tokens = capacity; this.last = now; }
  available(now: number): boolean { this.refill(now); return this.tokens >= 1; }
  take(now: number): boolean { if (!this.available(now)) return false; this.tokens -= 1; return true; }
  private refill(now: number): void { if (now <= this.last) return; this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.ratePerS); this.last = now; }
}
export class RateLimitedEpidemic {
  readonly name = 'rate-limited-epidemic';
  constructor(readonly budget = new TokenBucket()) {}
  consider(carried: Carried, peerId: string, peerSeen: boolean, now: number): boolean { return !carried.forwarded_to.has(peerId) && !peerSeen && this.budget.available(now); }
  commit(now: number): boolean { return this.budget.take(now); }
}
export function initialCopies(traffic: MeshClass, population: number): number { return traffic === 'urgent' ? 1 : sprayCopiesFor(population); }
