/**
 * The season, as the app reads it.
 *
 * Same two-source discipline as `circuits/registry.ts`: the live API when one is
 * configured, a bundled fixture otherwise, and the fixture is labelled rather
 * than disguised. What is new is the shape — this returns RACES, not circuits.
 *
 * That change is not cosmetic. Nobody holds a ticket to a circuit id; they hold
 * one to the British Grand Prix on the fifth of July. Asking somebody to
 * recognise "silverstone" in a list of twenty-three lowercase strings is asking
 * them to do the data model's work, and it is the kind of thing that reads as
 * unfinished software however well the rest of the screen is drawn.
 */

import type { RaceSummary } from '@crowdflow/api/wire';

import { DEMO_RACES } from './demo';

export interface RaceSource {
  /** Whether this is the bundled fixture rather than the live feed. */
  demo: boolean;
  list(): Promise<RaceSummary[]>;
  /** The race a spectator is most likely looking for: the one running now,
   *  otherwise the next. Null only when no calendar exists at all. */
  current(now: Date): Promise<RaceSummary | null>;
}

async function json<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return (await response.json()) as T;
}

export function liveRaces(api: string): RaceSource {
  return {
    demo: false,
    list() { return json<RaceSummary[]>(api, '/api/events'); },
    async current() {
      // The server decides, not the phone. It owns the calendar and it has a
      // clock that has not been set by hand — a handset four minutes fast would
      // otherwise pick a different "current race" on the boundary of a weekend.
      try {
        return await json<RaceSummary>(api, '/api/events/current');
      } catch {
        return null;
      }
    },
  };
}

export function demoRaces(): RaceSource {
  const all = DEMO_RACES as unknown as RaceSummary[];
  return {
    demo: true,
    async list() { return [...all]; },
    async current(now: Date) { return pickCurrent(all, now); },
  };
}

/**
 * The running race, else the next, else the last.
 *
 * A weekend counts as "now" from its first session to its last, not just on race
 * day: the Friday crowd is the reason this system exists. Never returns null for
 * a non-empty calendar, because a picker that opens on nothing makes the user do
 * work the data could have done.
 */
export function pickCurrent(races: RaceSummary[], now: Date): RaceSummary | null {
  if (!races.length) return null;
  const iso = now.toISOString();
  const ordered = [...races].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const running = ordered.find((race) => race.starts_at && race.ends_at && race.starts_at <= iso && iso <= race.ends_at);
  if (running) return running;
  return ordered.find((race) => (race.starts_at ?? race.date) > iso) ?? ordered.at(-1) ?? null;
}

export function createRaceSource(api: string | undefined): RaceSource {
  return api ? liveRaces(api) : demoRaces();
}
