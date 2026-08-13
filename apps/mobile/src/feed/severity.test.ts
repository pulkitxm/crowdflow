import { describe, expect, it } from 'vitest';

import { worstOf } from './severity';
import type { Step, WayAhead } from './types';

function step(way_ahead: WayAhead, id: string = way_ahead): Step {
  return { id, to: 'somewhere', walk_s: 120, way_ahead, crossing: null };
}

describe('a route is as good as its worst leg', () => {
  it('is clear only when every leg is', () => {
    expect(worstOf([step('nominal'), step('nominal', 'n2')])).toBe('nominal');
  });

  it('reports the jam, not the average', () => {
    // The failure mode: three clear legs and one jammed one averaging out to a
    // green headline shown to someone who is standing still.
    expect(worstOf([step('nominal'), step('critical'), step('nominal', 'n2')])).toBe('critical');
  });

  it('does not call an unreported stretch clear', () => {
    // Invariant 5. Silence is not good news.
    expect(worstOf([step('nominal'), step('unknown')])).toBe('unknown');
  });

  it('lets evidence outrank uncertainty', () => {
    expect(worstOf([step('unknown'), step('building')])).toBe('building');
    expect(worstOf([step('unknown'), step('critical')])).toBe('critical');
  });

  it('has an answer for an empty route', () => {
    expect(worstOf([])).toBe('nominal');
  });
});
