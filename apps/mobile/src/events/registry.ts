
import type { RaceSummary } from '@crowdflow/api/wire';

import { DEMO_RACES } from './demo';

export interface RaceSource {
  demo: boolean;
  list(): Promise<RaceSummary[]>;
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
