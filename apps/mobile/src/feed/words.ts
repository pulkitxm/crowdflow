/**
 * Every word the app puts on screen about the state of the crowd.
 *
 * Centralised for one reason: this is the file a reviewer reads to check the
 * app's vocabulary. The operator console's language — congestion, bottleneck,
 * intervention, capacity, confidence, horizon — is banned here, not because it
 * is wrong but because it is not the user's language and it does not change
 * where they put their feet. `src/copy.test.ts` scans the whole source tree for
 * those words so the ban survives the next feature.
 *
 * The mapping below is total over `WayAhead`. There is no fallback branch: if a
 * band is ever added upstream, this stops compiling instead of quietly saying
 * "Clear" about something that is not.
 */

import type { WayAhead } from './types';

/** The word itself. Short enough to read at a glance, in motion, in sunlight. */
export const WAY_AHEAD_WORD: Record<WayAhead, string> = {
  nominal: 'Clear',
  building: 'Slowing',
  critical: 'Backing up',
  unknown: 'No reports',
};

/**
 * The same fact as a sentence, for the one place per screen that gets to speak.
 *
 * Written from the user's side of the screen: what they will experience, not
 * what the model observed. "People are stopping and starting" is something you
 * can check against the world in front of you; "LOS E" is not.
 */
export const WAY_AHEAD_SENTENCE: Record<WayAhead, string> = {
  nominal: 'You can walk at your own pace.',
  building: 'Busy, but still moving.',
  critical: 'People are stopping and starting.',
  unknown: 'No phones are reporting from here yet.',
};

/**
 * The same four states said about a whole route rather than one leg.
 *
 * Only `unknown` differs, and it has to: a route is unknown when ANY leg of it
 * is, so "no phones are reporting from here" would be false about the three legs
 * that are reporting. Saying it accurately costs one string and keeps the app
 * from making a claim the user can catch it out on.
 */
export const WAY_AHEAD_ROUTE_SENTENCE: Record<WayAhead, string> = {
  nominal: WAY_AHEAD_SENTENCE.nominal,
  building: WAY_AHEAD_SENTENCE.building,
  critical: WAY_AHEAD_SENTENCE.critical,
  unknown: 'Nobody is reporting from part of this way.',
};

/**
 * How the crossing screen reads. A crossing is the one thing a spectator cannot
 * see for themselves, which is the whole justification for the space it takes.
 */
export const CROSSING_WORDS = {
  openNow: 'Open now',
  openUntil: (m: string) => `Open — closes in ${m}`,
  closedUntil: (m: string) => `Closed — opens in ${m}`,
  closedUnknown: 'Closed — no reopening time yet',
  openUnknown: 'Open',
} as const;

/**
 * The unknown state, said plainly wherever it appears.
 *
 * Invariant 5: unobserved is not empty. The temptation is to render silence as
 * green, because green looks better. This is the string that costs us that.
 */
export const UNKNOWN_NOTE = 'Nobody nearby is sharing from here, so this part is a guess.';
