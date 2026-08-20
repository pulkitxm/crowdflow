/**
 * The season, as a spectator thinks about it.
 *
 * Everything else in this server is keyed on a circuit — geography that is good
 * for a decade. But nobody says "I am going to Silverstone on the 5th"; they say
 * "I have tickets for the British Grand Prix". A race is a round number, a name,
 * a place and three days, and the circuit is an implementation detail of it.
 *
 * Read from committed data rather than fetched. The calendar is imported by
 * `crowdflow calendar import`, reviewed, and committed — so a venue with a
 * saturated cell network still serves it, and a phone that cached it still knows
 * when the race ends. An API that proxied Jolpica live would add a third-party
 * outage to the list of things that can take the schedule off a spectator's
 * screen on race day.
 *
 * The load-bearing field is `has_map`. Twenty-two of the twenty-three rounds have
 * no committed circuit pack, which means the app can name the race and tell you
 * when it starts but cannot route you through the venue. Serving the whole
 * calendar and marking which rounds are guidable is the honest shape; serving
 * only the one round with a map would hide the gap, and inventing packs for the
 * rest would be worse.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EventProfile, Session } from '@crowdflow/contracts';
import type { RaceSummary } from './wire.js';

interface CalendarFile {
  season: number;
  generated_at: string;
  sources?: string[];
  rounds_without_published_ends?: number[];
  events?: EventProfile[];
}

/** Every committed season calendar, newest first. */
export function calendars(root: string): CalendarFile[] {
  const directory = join(root, 'circuits');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^calendar\.\d{4}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')) as CalendarFile)
    .sort((a, b) => b.season - a.season);
}

function packExists(root: string, circuitId: string): boolean {
  return existsSync(join(root, 'circuits', circuitId, 'pack', 'circuit.json'));
}

/** A stable id for one race. Season and round, because both are needed to be
 *  unique and neither changes once a season is published. */
export function raceId(event: EventProfile): string {
  return `${event.season ?? 0}-${String(event.round ?? 0).padStart(2, '0')}-${event.circuit_id}`;
}

function summarise(root: string, event: EventProfile, generatedAt: string): RaceSummary {
  const sessions = [...(event.sessions ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const race = sessions.find((session) => session.kind === 'race') ?? sessions.at(-1) ?? null;
  return {
    id: raceId(event),
    round: event.round ?? 0,
    season: event.season ?? 0,
    name: event.name,
    circuit_id: event.circuit_id,
    locality: event.locality ?? '',
    country: event.country ?? '',
    ...(event.country_code ? { country_code: event.country_code } : {}),
    date: event.date ?? race?.start.slice(0, 10) ?? '',
    ...(event.utc_offset ? { utc_offset: event.utc_offset } : {}),
    // The weekend, as the first session's start and the last one's end. Derived
    // rather than stored: a sprint weekend and a normal one have different shapes
    // and neither has a published "weekend start".
    starts_at: sessions[0]?.start ?? null,
    ends_at: sessions.at(-1)?.end ?? null,
    sessions,
    // Every end time assumed means the whole timetable is an estimate — and the
    // race end is the largest crowd-movement trigger of the day.
    session_times_published: sessions.length > 0 && sessions.every((session) => session.end_provenance === 'measured'),
    has_map: packExists(root, event.circuit_id),
    calendar_generated_at: generatedAt,
  };
}

/** Every race in the committed calendars, earliest first. */
export function races(root: string): RaceSummary[] {
  const all: RaceSummary[] = [];
  for (const calendar of calendars(root)) {
    for (const event of calendar.events ?? []) all.push(summarise(root, event, calendar.generated_at));
  }
  return all.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.round - b.round);
}

export function race(root: string, id: string): RaceSummary | null {
  return races(root).find((entry) => entry.id === id) ?? null;
}

/**
 * The race a spectator is most likely to be looking for, given the date.
 *
 * The one currently running if there is one, otherwise the next to come,
 * otherwise the most recent — never null when a calendar exists, because a
 * picker that opens on nothing makes the user do the server's work. A weekend
 * counts as "now" from its first session to its last, not just on race day: the
 * crowd on Friday is the reason this system exists.
 */
export function currentRace(root: string, now: Date): RaceSummary | null {
  const all = races(root);
  if (!all.length) return null;
  const iso = now.toISOString();
  const running = all.find((entry) => entry.starts_at && entry.ends_at && entry.starts_at <= iso && iso <= entry.ends_at);
  if (running) return running;
  return all.find((entry) => (entry.starts_at ?? entry.date) > iso) ?? all.at(-1) ?? null;
}

export type { Session };
