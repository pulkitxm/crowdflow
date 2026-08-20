
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOCATION_DISCLOSURE_VERSION } from '@crowdflow/contracts';

const KEY = 'crowdflow.location-consent.v2';

export interface ConsentRecord {
  version: string;
  granted_at: number;
  sharing: boolean;
}

export async function readConsent(): Promise<ConsentRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentRecord;
    if (typeof parsed?.version !== 'string' || typeof parsed?.granted_at !== 'number') return null;
    return { version: parsed.version, granted_at: parsed.granted_at, sharing: parsed.sharing !== false };
  } catch {
    return null;
  }
}

export function isCurrent(record: ConsentRecord | null): record is ConsentRecord {
  return record?.version === LOCATION_DISCLOSURE_VERSION;
}

export async function recordConsent(now = Date.now() / 1000): Promise<ConsentRecord> {
  const record: ConsentRecord = { version: LOCATION_DISCLOSURE_VERSION, granted_at: Math.round(now), sharing: true };
  await write(record);
  return record;
}

export async function setSharing(record: ConsentRecord, sharing: boolean): Promise<ConsentRecord> {
  const next: ConsentRecord = { ...record, sharing };
  await write(next);
  return next;
}

export async function withdrawConsent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
  }
}

async function write(record: ConsentRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(record));
  } catch {
  }
}
