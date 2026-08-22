
import type { Session } from '@crowdflow/contracts/wire';

export interface RaceTiming {
  date: string;
  utc_offset?: string;
  starts_at: string | null;
  ends_at: string | null;
  sessions?: Session[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

export function offsetMinutes(offset: string | undefined): number | null {
  if (!offset) return null;
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function atVenue(iso: string, offset: string | undefined): Date {
  const minutes = offsetMinutes(offset);
  const instant = new Date(iso);
  return minutes == null ? instant : new Date(instant.getTime() + minutes * 60_000);
}

export function venueClock(iso: string, offset: string | undefined): string {
  const at = atVenue(iso, offset);
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
}

export function venueDay(iso: string, offset: string | undefined): string {
  const at = atVenue(iso, offset);
  return `${DAYS[at.getUTCDay()]} ${at.getUTCDate()}`;
}

function monthName(iso: string): string {
  return MONTHS[new Date(iso).getUTCMonth()] ?? '';
}

export function weekendRange(race: RaceTiming): string {
  const start = race.starts_at;
  const end = race.ends_at ?? race.starts_at;
  if (!start || !end) return race.date ? `${venueDay(race.date, race.utc_offset)} ${monthName(race.date)}` : 'dates to be confirmed';
  const from = atVenue(start, race.utc_offset);
  const to = atVenue(end, race.utc_offset);
  const sameMonth = from.getUTCMonth() === to.getUTCMonth();
  const left = `${DAYS[from.getUTCDay()]} ${from.getUTCDate()}${sameMonth ? '' : ` ${MONTHS[from.getUTCMonth()]}`}`;
  const right = `${DAYS[to.getUTCDay()]} ${to.getUTCDate()} ${MONTHS[to.getUTCMonth()]}`;
  return `${left} – ${right}`;
}

export function countdown(race: RaceTiming, now: Date): string {
  const start = race.starts_at ?? race.date;
  const end = race.ends_at;
  if (!start) return '';
  const iso = now.toISOString();
  if (end && start <= iso && iso <= end) return 'Happening now';
  const ms = new Date(start).getTime() - now.getTime();
  if (ms < 0) return 'Finished';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 14) return `In ${Math.round(days / 7)} weeks`;
  if (days >= 2) return `In ${days} days`;
  if (days === 1) return 'Tomorrow';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `In ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return 'Starting shortly';
}

export function nextSession(race: RaceTiming, now: Date): Session | null {
  const iso = now.toISOString();
  const sessions = [...(race.sessions ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  return sessions.find((session) => session.end >= iso) ?? null;
}

export function byMonth<T extends { date: string }>(races: T[]): { month: string; races: T[] }[] {
  const groups: { month: string; races: T[] }[] = [];
  for (const race of [...races].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const month = race.date ? monthName(race.date) : 'Dates to be confirmed';
    const last = groups.at(-1);
    if (last && last.month === month) last.races.push(race);
    else groups.push({ month, races: [race] });
  }
  return groups;
}
