
import type { WayAhead } from './types';

export const WAY_AHEAD_WORD: Record<WayAhead, string> = {
  nominal: 'Clear',
  building: 'Slowing',
  critical: 'Backing up',
  unknown: 'No reports',
};

export const WAY_AHEAD_SENTENCE: Record<WayAhead, string> = {
  nominal: 'You can walk at your own pace.',
  building: 'Busy, but still moving.',
  critical: 'People are stopping and starting.',
  unknown: 'No phones are reporting from here yet.',
};

export const WAY_AHEAD_ROUTE_SENTENCE: Record<WayAhead, string> = {
  nominal: WAY_AHEAD_SENTENCE.nominal,
  building: WAY_AHEAD_SENTENCE.building,
  critical: WAY_AHEAD_SENTENCE.critical,
  unknown: 'Nobody is reporting from part of this way.',
};

export const CROSSING_WORDS = {
  openNow: 'Open now',
  openUntil: (m: string) => `Open — closes in ${m}`,
  closedUntil: (m: string) => `Closed — opens in ${m}`,
  closedUnknown: 'Closed — no reopening time yet',
  openUnknown: 'Open',
} as const;

export const UNKNOWN_NOTE = 'Nobody nearby is sharing from here, so this part is a guess.';
