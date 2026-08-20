/**
 * Which race this person is going to.
 *
 * The app's one unavoidable question. Everything downstream — the venue frame,
 * the anchor map, the guidance, the crowd picture — is about one place on one
 * weekend, and none of it can start before this is answered.
 *
 * Persisted properly now, through AsyncStorage rather than the `localStorage`
 * shim the circuit choice used to use. That shim was honest about being a gap and
 * it was the wrong gap to leave: it meant the question returned on every cold
 * start on a real device, and a question somebody answers four times is a
 * question they stop reading.
 *
 * What is stored is a summary, not a reference. A phone at a circuit with no
 * signal must still know which race it is at and when the sessions are, and an id
 * alone would need a network call to become useful again.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RaceSummary, Session } from '@crowdflow/api/wire';

const KEY = 'crowdflow.race.v1';

export interface SelectedRace {
  id: string;
  round: number;
  season: number;
  name: string;
  circuit_id: string;
  locality: string;
  country: string;
  date: string;
  utc_offset?: string;
  starts_at: string | null;
  ends_at: string | null;
  /**
   * The weekend's timetable, stored rather than re-fetched.
   *
   * This is the field that makes the paragraph above true. A phone at a circuit
   * on a saturated network must still be able to answer "when does the race
   * end", and an id alone would need a call to become useful again. Five
   * sessions is a few hundred bytes; a blank timetable on race day is the app
   * failing at the one moment it is opened most.
   */
  sessions?: Session[];
  /** Whether this round has a committed circuit pack — i.e. whether the app can
   *  guide, or only tell you the timetable. Stored so an offline launch knows
   *  which of the two it is without asking. */
  has_map: boolean;
}

export function toSelected(race: RaceSummary): SelectedRace {
  return {
    id: race.id,
    round: race.round,
    season: race.season,
    name: race.name,
    circuit_id: race.circuit_id,
    locality: race.locality,
    country: race.country,
    date: race.date,
    ...(race.utc_offset ? { utc_offset: race.utc_offset } : {}),
    starts_at: race.starts_at,
    ends_at: race.ends_at,
    ...(race.sessions?.length ? { sessions: race.sessions } : {}),
    has_map: race.has_map,
  };
}

export async function storedRace(): Promise<SelectedRace | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SelectedRace;
    return parsed && typeof parsed.id === 'string' && typeof parsed.circuit_id === 'string' ? parsed : null;
  } catch {
    // A record that cannot be read is treated as absent. The cost is asking
    // again, which is the safe direction to fail in.
    return null;
  }
}

export async function storeRace(race: SelectedRace): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(race));
  } catch {
    // Storage full or denied. The choice holds for this session and is asked
    // again next launch.
  }
}

export async function forgetRace(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to report: the caller has already cleared its own state.
  }
}
