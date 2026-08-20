import { describe, expect, it } from 'vitest';

import { isExpired, showableOffer } from './offer';
import type { RerouteOffer } from './types';

const NOW = 1_700_000_000;

function offer(patch: Partial<RerouteOffer['verdict']> = {}, expiresIn = 300): RerouteOffer {
  return {
    command: {
      command_id: 'cmd-1',
      issued_at: NOW - 10,
      expires_at: NOW + expiresIn,
      source_zone: 'a',
      destination_zone: 'b',
      target_fraction: 0.3,
      reason: 'The bridge at Village is filling up.',
      expected_cost_s: 240,
    },
    verdict: {
      command_id: 'cmd-1',
      outcome: 'approved',
      reason: 'Both routes stay below capacity.',
      dispatchable: true,
      ...patch,
    },
    instead: { id: 'r', from: 'a', to: 'b', steps: [], total_walk_s: 600 },
  };
}

describe('the safety gate, enforced on the client', () => {
  it('shows an approved offer with its price attached', () => {
    const showable = showableOffer(offer());
    expect(showable?.cost_s).toBe(240);
    expect(showable?.reason).toContain('filling up');
  });

  it('refuses a rejected command', () => {
    expect(showableOffer(offer({ outcome: 'rejected', dispatchable: false }))).toBeNull();
  });

  it('refuses an outcome whose served dispatch judgement is false', () => {
    expect(showableOffer(offer({ dispatchable: false }))).toBeNull();
  });

  it('refuses a modified command', () => {
    expect(showableOffer(offer({ outcome: 'modified', dispatchable: false }))).toBeNull();
  });

  it('refuses a verdict that belongs to a different command', () => {
    expect(showableOffer(offer({ command_id: 'cmd-other' }))).toBeNull();
  });
});

describe('expiry', () => {
  it('treats a command past its expiry as gone', () => {
    expect(isExpired(offer({}, -1), NOW)).toBe(true);
    expect(isExpired(offer({}, 300), NOW)).toBe(false);
  });
});
