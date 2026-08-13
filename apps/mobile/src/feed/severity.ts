/**
 * Reducing a route's legs to the one word the headline gets to say.
 *
 * A route is as good as its worst leg, not its average. Three clear stretches
 * and one jammed one is a jammed walk — the two minutes standing still is the
 * only part anyone will remember, and averaging it away would produce a screen
 * that says "Clear" to someone who is not moving.
 *
 * The ordering places `unknown` above `nominal` but below `building`:
 *
 *   - above nominal, because a stretch nobody is reporting from is not a stretch
 *     we have checked, and a headline of "Clear" would be a claim we cannot make
 *     (invariant 5);
 *   - below building, because a leg we can see is slowing is a stronger fact than
 *     a leg we cannot see at all, and uncertainty must not shout down evidence.
 *
 * The per-leg word is never lost either way: the leg keeps its own pill and, when
 * unknown, a sentence saying nobody is reporting from it.
 */

import type { Step, WayAhead } from './types';

const SEVERITY: Record<WayAhead, number> = {
  nominal: 0,
  unknown: 1,
  building: 2,
  critical: 3,
};

export function worstOf(steps: readonly Step[]): WayAhead {
  return steps.reduce<WayAhead>(
    (worst, step) => (SEVERITY[step.way_ahead] > SEVERITY[worst] ? step.way_ahead : worst),
    'nominal',
  );
}
