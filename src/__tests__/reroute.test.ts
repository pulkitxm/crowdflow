import { describe, expect, it } from 'vitest';
import type { RerouteCommand } from '../core/contracts';
import { shouldComply } from '../core/identity';
import { decodeReroute, encodeReroute } from '../protocol/rerouteCodec';
import { HEADER_SIZE } from '../protocol/meshCodec';
import { demoVenue } from '../venue/demoVenue';

const command: RerouteCommand = {
  type: 'REROUTE', route_id: 'route_17', issued_at: 1_723_300_110, expires_at: 1_723_300_400,
  source_zone: 'gate_a', destination_zone: 'food_court', avoid: ['zone_c17'], preferred: ['zone_c11'],
  fraction: .30, reason: 'Congestion predicted in Corridor C17', priority: 'NORMAL',
};

describe('reroute handling', () => {
  it('round trips under the radio limit', () => {
    const bytes = encodeReroute(command, demoVenue);
    expect(bytes.length + HEADER_SIZE).toBeLessThanOrEqual(255);
    expect(decodeReroute(bytes, command.issued_at, demoVenue)).toEqual({
      ...command, fraction: expect.closeTo(.30, 2),
    });
  });

  it('selects roughly the commanded fraction deterministically', () => {
    const selected = Array.from({ length: 10_000 }, (_, index) => shouldComply(index.toString(16).padStart(4, '0'), command))
      .filter(Boolean).length;
    expect(selected).toBeGreaterThan(2_800); expect(selected).toBeLessThan(3_200);
    expect(shouldComply('8f3a', command)).toBe(shouldComply('8f3a', command));
  });

  it('always obeys emergency guidance', () => {
    expect(shouldComply('8f3a', { ...command, fraction: 0, priority: 'EMERGENCY' })).toBe(true);
    expect(shouldComply('8f3a', { ...command, fraction: 0 })).toBe(false);
  });
});
