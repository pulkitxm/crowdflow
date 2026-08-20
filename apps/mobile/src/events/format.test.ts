import { describe, expect, it } from 'vitest';
import type { RaceSummary, Session } from '@crowdflow/api/wire';

import { byMonth, countdown, nextSession, offsetMinutes, venueClock, venueDay, weekendRange } from './format';
import { pickCurrent } from './registry';

/**
 * Dates, which is where this kind of app quietly goes wrong.
 *
 * The bug being guarded against is specific: every timestamp in this system is
 * UTC, every time a spectator reads is local, and a naive render applies the
 * PHONE's timezone to a VENUE's timestamp. It produces times that look
 * completely plausible and are an hour or eight out — and the consequence is
 * somebody arriving after a session started. That failure cannot be caught by
 * looking at the screen, which is why it is tested.
 */

const session = (name: string, kind: string, start: string, end: string): Session => ({
  id: name, kind, name, start, end, end_provenance: 'measured',
});

/** Silverstone 2026 as the API serves it: UTC instants, +01:00 venue offset. */
const BRITISH: RaceSummary = {
  id: '2026-09-silverstone', round: 9, season: 2026, name: 'British Grand Prix',
  circuit_id: 'silverstone', locality: 'Silverstone', country: 'United Kingdom', country_code: 'GBR',
  date: '2026-07-05', utc_offset: '+01:00',
  starts_at: '2026-07-03T11:30:00.000Z', ends_at: '2026-07-05T16:00:00.000Z',
  sessions: [
    session('Practice 1', 'practice', '2026-07-03T11:30:00.000Z', '2026-07-03T12:30:00.000Z'),
    session('Qualifying', 'qualifying', '2026-07-04T15:00:00.000Z', '2026-07-04T16:00:00.000Z'),
    session('Race', 'race', '2026-07-05T14:00:00.000Z', '2026-07-05T16:00:00.000Z'),
  ],
  session_times_published: true, has_map: true, calendar_generated_at: '2026-08-20T00:00:00.000Z',
};

/** Las Vegas: a negative offset, and one that pushes a session across midnight
 *  into the previous local day — the case a sign error renders as a whole
 *  different day rather than a wrong hour. */
const VEGAS: RaceSummary = {
  ...BRITISH,
  id: '2026-21-vegas', round: 21, name: 'Las Vegas Grand Prix', circuit_id: 'vegas',
  locality: 'Las Vegas', country: 'United States', date: '2026-11-22', utc_offset: '-08:00',
  starts_at: '2026-11-21T04:00:00.000Z', ends_at: '2026-11-23T06:00:00.000Z',
  sessions: [session('Race', 'race', '2026-11-23T04:00:00.000Z', '2026-11-23T06:00:00.000Z')],
};

describe('venue time', () => {
  it('parses an ISO offset both ways', () => {
    expect(offsetMinutes('+01:00')).toBe(60);
    expect(offsetMinutes('-08:00')).toBe(-480);
    expect(offsetMinutes('+05:30')).toBe(330);
    expect(offsetMinutes(undefined)).toBeNull();
    expect(offsetMinutes('garbage')).toBeNull();
  });

  it('renders a session time in the venue offset, not the phone one', () => {
    // 14:00Z at +01:00 is a 15:00 local start. Reading it with the phone's
    // getters would give whatever this machine's zone happens to be.
    expect(venueClock('2026-07-05T14:00:00.000Z', '+01:00')).toBe('15:00');
    expect(venueClock('2026-07-03T11:30:00.000Z', '+01:00')).toBe('12:30');
  });

  it('carries a negative offset back across midnight', () => {
    // 04:00Z on the 23rd is 20:00 on the 22nd in Las Vegas. A sign error here
    // shows the race on the wrong day, not merely at the wrong hour.
    expect(venueClock('2026-11-23T04:00:00.000Z', '-08:00')).toBe('20:00');
    expect(venueDay('2026-11-23T04:00:00.000Z', '-08:00')).toBe('Sun 22');
  });

  it('falls back to UTC when no offset was published', () => {
    expect(venueClock('2026-07-05T14:00:00.000Z', undefined)).toBe('14:00');
  });
});

describe('weekend shape', () => {
  it('spans first session to last, not just race day', () => {
    // The answer to "when should I be there" is the whole weekend. A single date
    // invites somebody to arrive on Sunday holding a Friday ticket.
    expect(weekendRange(BRITISH)).toBe('Fri 3 – Sun 5 July');
  });

  it('names both months when a weekend crosses one', () => {
    const crossing: RaceSummary = {
      ...BRITISH,
      starts_at: '2026-07-31T10:00:00.000Z',
      ends_at: '2026-08-02T16:00:00.000Z',
    };
    expect(weekendRange(crossing)).toBe('Fri 31 July – Sun 2 August');
  });

  it('uses the venue offset for the range too', () => {
    expect(weekendRange(VEGAS)).toBe('Fri 20 – Sun 22 November');
  });
});

describe('what to say about a race', () => {
  it('counts down in the units somebody would say out loud', () => {
    expect(countdown(BRITISH, new Date('2026-05-01T00:00:00Z'))).toBe('In 9 weeks');
    expect(countdown(BRITISH, new Date('2026-06-28T00:00:00Z'))).toBe('In 5 days');
    expect(countdown(BRITISH, new Date('2026-07-02T11:30:00Z'))).toBe('Tomorrow');
    expect(countdown(BRITISH, new Date('2026-07-03T08:30:00Z'))).toBe('In 3 hours');
    expect(countdown(BRITISH, new Date('2026-07-04T09:00:00Z'))).toBe('Happening now');
    expect(countdown(BRITISH, new Date('2026-09-01T00:00:00Z'))).toBe('Finished');
  });

  it('treats the whole weekend as happening now, not only race day', () => {
    // The Friday crowd is the reason this system exists.
    expect(countdown(BRITISH, new Date('2026-07-03T12:00:00Z'))).toBe('Happening now');
  });

  it('points at the next session that has not finished', () => {
    expect(nextSession(BRITISH, new Date('2026-07-03T00:00:00Z'))?.name).toBe('Practice 1');
    // Mid-session counts as next: it is the one still to watch.
    expect(nextSession(BRITISH, new Date('2026-07-03T12:00:00Z'))?.name).toBe('Practice 1');
    expect(nextSession(BRITISH, new Date('2026-07-03T13:00:00Z'))?.name).toBe('Qualifying');
    expect(nextSession(BRITISH, new Date('2026-07-06T00:00:00Z'))).toBeNull();
  });
});

describe('the picker\'s default', () => {
  const season = [
    { ...BRITISH, id: 'a', date: '2026-03-08', starts_at: '2026-03-06T00:00:00.000Z', ends_at: '2026-03-08T16:00:00.000Z' },
    { ...BRITISH, id: 'b', date: '2026-07-05' },
    { ...BRITISH, id: 'c', date: '2026-12-06', starts_at: '2026-12-04T00:00:00.000Z', ends_at: '2026-12-06T16:00:00.000Z' },
  ];

  it('prefers a race that is running', () => {
    expect(pickCurrent(season, new Date('2026-07-04T12:00:00Z'))?.id).toBe('b');
  });

  it('otherwise offers the next one', () => {
    expect(pickCurrent(season, new Date('2026-05-01T00:00:00Z'))?.id).toBe('b');
  });

  it('falls back to the last of the season rather than nothing', () => {
    // A picker that opens empty makes the user do work the data could have done.
    expect(pickCurrent(season, new Date('2027-01-01T00:00:00Z'))?.id).toBe('c');
    expect(pickCurrent([], new Date())).toBeNull();
  });
});

describe('grouping', () => {
  it('breaks the season into months, in order', () => {
    const groups = byMonth([
      { ...BRITISH, id: 'jul', date: '2026-07-05' },
      { ...BRITISH, id: 'mar', date: '2026-03-08' },
      { ...BRITISH, id: 'jul2', date: '2026-07-19' },
    ]);
    expect(groups.map((group) => group.month)).toEqual(['March', 'July']);
    expect(groups[1]!.races).toHaveLength(2);
  });
});
