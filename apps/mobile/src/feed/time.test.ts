import { describe, expect, it } from 'vitest';

import { costMinutes, costText, freshnessText, journeyMinutes, journeyText, minutesUntil, untilText } from './time';

describe('journeys round to nearest', () => {
  it('rounds a journey down when that is nearer', () => {
    expect(journeyMinutes(614)).toBe(10);
  });

  it('never prints a bare zero', () => {
    expect(journeyText(20)).toBe('under a minute');
    expect(journeyText(0)).toBe('under a minute');
  });

  it('prints whole minutes above that', () => {
    expect(journeyText(600)).toBe('10 min');
  });
});

describe('costs round up', () => {
  // The failure this exists to prevent: a redirect that really costs 3m10s being
  // sold as "3 min". The user accepts the price before they can see the walk, so
  // the rounding error has to land in their favour or the app stops being trusted.
  it('never understates what it is asking for', () => {
    expect(costMinutes(190)).toBe(4);
    expect(costText(190)).toBe('+4 min');
  });

  it('leaves an exact number alone', () => {
    expect(costText(240)).toBe('+4 min');
  });

  it('signs a saving as a saving', () => {
    expect(costText(-120)).toBe('−2 min');
  });
});

describe('countdowns', () => {
  const now = 1_000_000;

  it('counts up to the stated time', () => {
    expect(untilText(now + 8 * 60, now)).toBe('8 min');
  });

  it('reads a passed time as now, never as a negative', () => {
    // A crossing whose stated closing time has gone by while the phone was out of
    // contact must not render "closes in -3 min".
    expect(minutesUntil(now - 200, now)).toBe(0);
    expect(untilText(now - 200, now)).toBe('now');
  });
});

describe('freshness is stated, not hidden', () => {
  const now = 1_000_000;

  it('says just now for fresh data', () => {
    expect(freshnessText(now - 8, now)).toBe('Updated just now');
  });

  it('says the age in minutes for stale data', () => {
    expect(freshnessText(now - 200, now)).toBe('Updated 3 minutes ago');
    expect(freshnessText(now - 65, now)).toBe('Updated a minute ago');
  });

  it('does not go backwards if a clock is skewed', () => {
    expect(freshnessText(now + 30, now)).toBe('Updated just now');
  });
});
