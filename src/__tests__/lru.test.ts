import { describe, expect, it } from 'vitest';
import { LruSet } from '../core/lru';

describe('mesh dedupe LRU', () => {
  it('drops duplicates and evicts the least recently used key', () => {
    const seen = new LruSet<string>(2);
    expect(seen.seenOrAdd('a')).toBe(false);
    expect(seen.seenOrAdd('b')).toBe(false);
    expect(seen.seenOrAdd('a')).toBe(true);
    expect(seen.seenOrAdd('c')).toBe(false);
    expect(seen.seenOrAdd('b')).toBe(false);
  });
});
