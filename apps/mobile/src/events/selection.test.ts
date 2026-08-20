import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RaceSummary } from '@crowdflow/api/wire';

/**
 * What the app remembers between launches, and what it serves with no server.
 *
 * AsyncStorage is mocked rather than stubbed, because its real entry point
 * imports React Native and the suite is Node. The mock is a Map, which is
 * exactly the contract the store depends on.
 */

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { store.set(key, value); },
    removeItem: async (key: string) => { store.delete(key); },
  },
}));

const { forgetRace, storeRace, storedRace, toSelected } = await import('./selection');
const { createRaceSource, demoRaces, liveRaces, pickCurrent } = await import('./registry');

const RACE: RaceSummary = {
  id: '2026-09-silverstone', round: 9, season: 2026, name: 'British Grand Prix',
  circuit_id: 'silverstone', locality: 'Silverstone', country: 'United Kingdom', country_code: 'GBR',
  date: '2026-07-05', utc_offset: '+01:00',
  starts_at: '2026-07-03T11:30:00.000Z', ends_at: '2026-07-05T16:00:00.000Z',
  sessions: [
    { id: 'p1', kind: 'practice', name: 'Practice 1', start: '2026-07-03T11:30:00.000Z', end: '2026-07-03T12:30:00.000Z', end_provenance: 'measured' },
    { id: 'r', kind: 'race', name: 'Race', start: '2026-07-05T14:00:00.000Z', end: '2026-07-05T16:00:00.000Z', end_provenance: 'measured' },
  ],
  session_times_published: true, has_map: true, calendar_generated_at: '2026-08-20T00:00:00.000Z',
};

beforeEach(() => { store.clear(); vi.unstubAllGlobals(); });

describe('the remembered race', () => {
  it('starts with nothing', async () => {
    expect(await storedRace()).toBeNull();
  });

  it('keeps the timetable, not just an id', async () => {
    await storeRace(toSelected(RACE));
    const held = await storedRace();
    expect(held?.id).toBe('2026-09-silverstone');
    expect(held?.circuit_id).toBe('silverstone');
    // The whole point of storing a summary rather than a reference: a phone on a
    // saturated network must still answer "when does the race end".
    expect(held?.sessions).toHaveLength(2);
    expect(held?.utc_offset).toBe('+01:00');
    expect(held?.has_map).toBe(true);
  });

  it('drops fields the API did not send rather than storing undefined', async () => {
    const { utc_offset, sessions, country_code, ...bare } = RACE;
    await storeRace(toSelected(bare as RaceSummary));
    const held = await storedRace();
    expect(held).not.toHaveProperty('utc_offset');
    expect(held).not.toHaveProperty('sessions');
  });

  it('treats a corrupted record as absent', async () => {
    store.set('crowdflow.race.v1', '{not json');
    // The cost is asking again, which is the safe direction to fail in.
    expect(await storedRace()).toBeNull();
  });

  it('rejects a record missing the fields everything downstream needs', async () => {
    store.set('crowdflow.race.v1', JSON.stringify({ name: 'British Grand Prix' }));
    expect(await storedRace()).toBeNull();
  });

  it('forgets on request', async () => {
    await storeRace(toSelected(RACE));
    await forgetRace();
    expect(await storedRace()).toBeNull();
  });
});

describe('the race source', () => {
  it('serves the whole committed season with no server', async () => {
    const source = demoRaces();
    expect(source.demo).toBe(true);
    const all = await source.list();
    expect(all).toHaveLength(23);
    // Listed, not filtered. Serving only the guidable rounds would hide the gap.
    expect(all.filter((race) => race.has_map)).toHaveLength(1);
    expect(all.every((race) => race.name.length > 0 && race.round > 0)).toBe(true);
  });

  it('offers a sensible default rather than an empty picker', async () => {
    const chosen = await demoRaces().current(new Date('2026-08-20T12:00:00Z'));
    // Today sits between rounds, so the next one is the answer.
    expect(chosen?.round).toBe(12);
    expect(chosen?.name).toContain('Grand Prix');
  });

  it('asks the server for the current race rather than deciding on the phone', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request) => ({ ok: true, json: async () => RACE }));
    vi.stubGlobal('fetch', fetcher);
    const chosen = await liveRaces('http://localhost:8099').current(new Date());
    expect(chosen?.id).toBe(RACE.id);
    // The server owns the calendar and has a clock nobody set by hand.
    expect(String(fetcher.mock.calls[0]![0])).toContain('/api/events/current');
  });

  it('returns null rather than throwing when the server has no calendar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await liveRaces('http://localhost:8099').current(new Date())).toBeNull();
  });

  it('propagates a failure from the list, which the picker must show', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    // A silently empty season list is indistinguishable from a cancelled season.
    await expect(liveRaces('http://localhost:8099').list()).rejects.toThrow('500');
  });

  it('picks live when an API is configured, the fixture otherwise', () => {
    expect(createRaceSource('http://localhost:8099').demo).toBe(false);
    expect(createRaceSource(undefined).demo).toBe(true);
  });

  it('never returns null for a non-empty calendar', () => {
    expect(pickCurrent([RACE], new Date('2030-01-01T00:00:00Z'))?.id).toBe(RACE.id);
    expect(pickCurrent([], new Date())).toBeNull();
  });
});
