
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
  sessions?: Session[];
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
    return null;
  }
}

export async function storeRace(race: SelectedRace): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(race));
  } catch {
  }
}

export async function forgetRace(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
  }
}
