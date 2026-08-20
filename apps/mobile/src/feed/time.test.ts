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
  it('never understates what it is asking for', () => {
    expect(costMinutes(190)).toBe(4);
    expect(costText(190)).toBe('+4 min');
  });

  it('leaves an exact number alone', () => {
    expect(costText(240)).toBe('+4 min');
  });

  it('signs a saving as a saving without producing negative zero', () => {
    expect(costText(-120)).toBe('−2 min');
    expect(costText(-30)).toBe('−1 min');
  });

  it('states a zero cost plainly', () => {
    expect(costText(0)).toBe('no extra time');
  });
});

describe('countdowns', () => {
  const now = 1_000_000;

  it('counts up to the stated time', () => {
    expect(untilText(now + 8 * 60, now)).toBe('8 min');
  });

  it('reads a passed time as now, never as a negative', () => {
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
