import type { RerouteCommand } from './contracts';

export type RandomBytes = (length: number) => Uint8Array;

const ROTATION_SECONDS = 15 * 60;

export class RotatingNodeIdentity {
  private value: string;
  private generatedAt: number;

  constructor(private readonly randomBytes: RandomBytes, now = epochSeconds()) {
    this.value = randomNodeId(randomBytes);
    this.generatedAt = now;
  }

  current(now = epochSeconds()): string {
    if (now - this.generatedAt >= ROTATION_SECONDS) {
      this.rotate(now);
    }
    return this.value;
  }

  rotate(now = epochSeconds()): string {
    this.value = randomNodeId(this.randomBytes);
    this.generatedAt = now;
    return this.value;
  }
}

export class SequenceCounter {
  private value: number;

  constructor(start = 0) {
    this.value = start & 0xffff;
  }

  next(): number {
    const current = this.value;
    this.value = (this.value + 1) & 0xffff;
    return current;
  }
}

export function rerouteBucket(nodeId: string, routeId: string): number {
  // FNV-1a is stable across JS engines and avoids platform hashCode differences.
  let hash = 0x811c9dc5;
  const value = `${nodeId}${routeId}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export function shouldComply(nodeId: string, command: RerouteCommand): boolean {
  if (command.priority === 'EMERGENCY') return true;
  const threshold = Math.floor(clamp(command.fraction, 0, 1) * 100);
  return rerouteBucket(nodeId, command.route_id) < threshold;
}

export function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function randomNodeId(randomBytes: RandomBytes): string {
  const bytes = randomBytes(2);
  if (bytes.length !== 2) throw new Error('secure random provider returned the wrong byte count');
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
