/**
 * The season calendar: which race, where, and when.
 *
 * Two sources, joined, because neither is sufficient alone and the repository
 * already depends on one of them — `circuits/index.yaml` was generated from
 * Jolpica, so its circuit ids are the ids this project uses.
 *
 *   JOLPICA (api.jolpi.ca) is the authority on WHICH RACES EXIST. It is the
 *   Ergast replacement — Ergast itself now returns 404, so anything still
 *   pointing at ergast.com is dead. Jolpica gives the round number, the race
 *   name a spectator would actually say ("British Grand Prix"), the circuit id
 *   this repo keys on, the locality and country, and session START times.
 *
 *   OPENF1 (api.openf1.org) is the authority on WHEN SESSIONS RUN. It publishes
 *   start AND end per session, includes the sprint sessions Ergast's schema has
 *   no field for, carries the venue's UTC offset, and flags cancellations.
 *
 * The join is BY RACE DATE, not by name. Jolpica's circuit ids and OpenF1's
 * `circuit_short_name` disagree in ways that are individually fixable and
 * collectively a maintenance liability — "spa" against "Spa-Francorchamps",
 * "red_bull_ring" against "Spielberg" — and a name-matching table would rot
 * silently the first time a venue is renamed. Two grands prix never share a
 * date, so the date is a natural key that needs no table.
 *
 * The output is committed data. A phone at a circuit with no signal still needs
 * to know when the race ends, and an app that cannot answer that without a
 * network call is an app that goes blank at exactly the wrong moment.
 */

import type { EventProfile, Provenance, Session } from '@crowdflow/contracts';
import { ASSUMED_SESSION_MINUTES } from '@crowdflow/contracts';

const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const OPENF1 = 'https://api.openf1.org/v1';

export interface CalendarFile {
  season: number;
  /** ISO 8601. A calendar is a snapshot; sessions move, and a reader is entitled
   *  to know how old this one is. */
  generated_at: string;
  sources: string[];
  /** Rounds whose session times came only from Jolpica, so every end time is
   *  assumed. Reported rather than buried: it is the difference between a
   *  timetable and an estimate. */
  rounds_without_published_ends: number[];
  events: EventProfile[];
}

interface JolpicaRace {
  season: string;
  round: string;
  raceName: string;
  date: string;
  time?: string;
  Circuit: {
    circuitId: string;
    circuitName: string;
    Location: { lat: string; long: string; locality: string; country: string };
  };
  FirstPractice?: { date: string; time?: string };
  SecondPractice?: { date: string; time?: string };
  ThirdPractice?: { date: string; time?: string };
  Qualifying?: { date: string; time?: string };
  Sprint?: { date: string; time?: string };
  SprintQualifying?: { date: string; time?: string };
  SprintShootout?: { date: string; time?: string };
}

interface OpenF1Session {
  session_key: number;
  session_type: string;
  session_name: string;
  date_start: string;
  date_end: string;
  circuit_short_name: string;
  country_code?: string;
  location?: string;
  gmt_offset?: string;
  year: number;
  is_cancelled?: boolean;
}

/** Map a session's published name onto the contract's `kind` vocabulary. */
export function sessionKind(name: string): Session['kind'] {
  const lower = name.toLowerCase();
  // Order matters: "Sprint Qualifying" is a qualifying session for the sprint,
  // and matching 'sprint' first would file it as the sprint race itself.
  if (lower.includes('qualifying') || lower.includes('shootout')) return 'qualifying';
  if (lower.includes('sprint')) return 'sprint';
  if (lower.includes('practice')) return 'practice';
  if (lower.includes('race') || lower === 'grand prix') return 'race';
  return 'support';
}

function isoOf(date: string, time?: string): string | null {
  if (!date) return null;
  // Jolpica gives '13:00:00Z'. A missing time means the source published a day
  // and not an hour, and inventing one would put a start time on screen that
  // nobody scheduled.
  if (!time) return null;
  return new Date(`${date}T${time.endsWith('Z') ? time : `${time}Z`}`).toISOString();
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/**
 * Jolpica's fixed session fields as a session list.
 *
 * Every end time here is assumed from the regulations, because Jolpica publishes
 * starts only. The provenance travels with each one.
 */
function sessionsFromJolpica(race: JolpicaRace): Session[] {
  const candidates: [string, { date: string; time?: string } | undefined][] = [
    ['Practice 1', race.FirstPractice],
    ['Practice 2', race.SecondPractice],
    ['Practice 3', race.ThirdPractice],
    ['Sprint Qualifying', race.SprintQualifying ?? race.SprintShootout],
    ['Sprint', race.Sprint],
    ['Qualifying', race.Qualifying],
    ['Race', { date: race.date, ...(race.time ? { time: race.time } : {}) }],
  ];
  const sessions: Session[] = [];
  for (const [name, slot] of candidates) {
    if (!slot?.date) continue;
    const start = isoOf(slot.date, slot.time);
    if (!start) continue;
    const kind = sessionKind(name);
    sessions.push({
      id: `${race.season}-${race.round}-${name.toLowerCase().replace(/\s+/g, '-')}`,
      kind,
      name,
      start,
      end: addMinutes(start, ASSUMED_SESSION_MINUTES[kind] ?? 60),
      end_provenance: 'assumed' as Provenance,
    });
  }
  return sessions.sort((a, b) => a.start.localeCompare(b.start));
}

/** OpenF1's sessions for one meeting, which carry real published end times. */
function sessionsFromOpenF1(season: number, round: string, sessions: OpenF1Session[]): Session[] {
  return sessions
    .filter((session) => !session.is_cancelled)
    .map((session): Session => ({
      id: `${season}-${round}-${session.session_key}`,
      kind: sessionKind(session.session_name || session.session_type),
      name: session.session_name,
      start: new Date(session.date_start).toISOString(),
      end: new Date(session.date_end).toISOString(),
      end_provenance: 'measured' as Provenance,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    // Both APIs are public and unauthenticated, and both ask callers to identify
    // themselves so they can talk to whoever is generating load. Sending a real
    // agent string is the cost of using someone else's free infrastructure.
    headers: { 'user-agent': 'crowdflow/0.2 (+https://github.com/pulkitxm/crowdflow)' },
  });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return await response.json() as T;
}

export interface ImportOptions {
  season: number;
  /** Skip OpenF1 and take Jolpica alone. Every end time is then assumed. */
  jolpicaOnly?: boolean;
}

export async function importCalendar(options: ImportOptions): Promise<CalendarFile> {
  const { season } = options;
  const jolpica = await fetchJson<{ MRData: { RaceTable: { Races: JolpicaRace[] } } }>(
    `${JOLPICA}/${season}.json?limit=100`,
  );
  const races = jolpica.MRData?.RaceTable?.Races ?? [];
  if (!races.length) throw new Error(`Jolpica has no races for ${season}`);

  // OpenF1 is enrichment, not a dependency. If it is unreachable the calendar
  // still builds from Jolpica alone with every end time marked assumed — a
  // degraded calendar beats no calendar, and the degradation is visible in the
  // provenance rather than in a log line nobody reads.
  let openf1: OpenF1Session[] = [];
  if (!options.jolpicaOnly) {
    try {
      openf1 = await fetchJson<OpenF1Session[]>(`${OPENF1}/sessions?year=${season}`);
    } catch {
      openf1 = [];
    }
  }

  // Index OpenF1's meetings by the date of their race session. Two grands prix
  // never share a date, which is what makes this a key rather than a heuristic.
  const byRaceDate = new Map<string, OpenF1Session[]>();
  // Grouped by circuit and month rather than by `meeting_key`, which the
  // sessions endpoint does not always carry — and a circuit never hosts two
  // grands prix in the same month.
  const meetings = new Map<string, OpenF1Session[]>();
  for (const session of openf1) {
    const key = `${session.circuit_short_name}|${session.date_start.slice(0, 7)}`;
    const bucket = meetings.get(key) ?? [];
    bucket.push(session);
    meetings.set(key, bucket);
  }
  for (const bucket of meetings.values()) {
    const race = bucket.find((session) => sessionKind(session.session_name || session.session_type) === 'race');
    if (race) byRaceDate.set(race.date_start.slice(0, 10), bucket);
  }

  const events: EventProfile[] = [];
  const assumedOnly: number[] = [];

  for (const race of races) {
    const matched = byRaceDate.get(race.date);
    const sessions = matched?.length
      ? sessionsFromOpenF1(season, race.round, matched)
      : sessionsFromJolpica(race);
    if (!matched?.length) assumedOnly.push(Number(race.round));

    const offset = matched?.[0]?.gmt_offset;
    const code = matched?.find((session) => session.country_code)?.country_code;

    events.push({
      circuit_id: race.Circuit.circuitId,
      name: race.raceName,
      round: Number(race.round),
      season,
      date: race.date,
      locality: race.Circuit.Location.locality,
      country: race.Circuit.Location.country,
      ...(code ? { country_code: code } : {}),
      ...(offset ? { utc_offset: normaliseOffset(offset) } : {}),
      sessions,
      // Deliberately not invented. Gate opening is a venue operations decision
      // published per event, and no data source here carries it — an assumed
      // "two hours before the first session" would be a number an operator
      // plans a gate rush against.
      gates_open: null,
    });
  }

  events.sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
  return {
    season,
    generated_at: new Date().toISOString(),
    sources: options.jolpicaOnly
      ? [`${JOLPICA}/${season}.json`]
      : [`${JOLPICA}/${season}.json`, `${OPENF1}/sessions?year=${season}`],
    rounds_without_published_ends: assumedOnly,
    events,
  };
}

/** OpenF1 writes an offset as '01:00:00'; ISO 8601 wants '+01:00'. */
function normaliseOffset(raw: string): string {
  const match = raw.match(/^(-?)(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  const sign = match[1] === '-' ? '-' : '+';
  return `${sign}${match[2]!.padStart(2, '0')}:${match[3]}`;
}
