/**
 * The record of what this person actually agreed to.
 *
 * Three fields and all three matter. The VERSION, because the sentence somebody
 * agreed to is part of the data — if the disclosure wording changes, an old
 * acknowledgement does not silently cover the new terms, and the server rejects
 * reports citing a version it no longer serves. The TIME, because "when did you
 * agree" is the first question anybody asks about consent and an app that
 * cannot answer it is not keeping a record, it is keeping a flag. And WHETHER
 * SENSING IS ON, separately from consent, because agreeing that a thing may
 * happen and having it happen right now are different states: turning sharing
 * off must not require withdrawing consent and re-reading four paragraphs.
 *
 * Persisted through AsyncStorage rather than the module-level flag this file
 * used to hold. That was honest about being a gap and it was the wrong gap to
 * leave open here: the previous version showed the disclosure again on every
 * cold start, and a screen people see repeatedly is a screen people learn to
 * dismiss without reading.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOCATION_DISCLOSURE_VERSION } from '@crowdflow/contracts';

const KEY = 'crowdflow.location-consent.v2';

export interface ConsentRecord {
  /** the disclosure that was shown, verbatim identifier */
  version: string;
  /** unix seconds */
  granted_at: number;
  /**
   * Whether sensing should be running.
   *
   * Separate from consent so that "stop sharing my position" is one switch and
   * not a withdrawal of agreement. Someone who pauses sharing on the drive home
   * and resumes it at the gate should not be re-consented in between.
   */
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
    // A record that cannot be read is treated as no record. The cost is showing
    // the disclosure again; the alternative is sensing on the strength of a
    // consent we cannot actually produce.
    return null;
  }
}

/**
 * Is this record an agreement to what the app currently does?
 *
 * Compared against the served version rather than merely being present. A
 * record from an older disclosure is a real agreement to something else, and it
 * is treated as absent — the person is asked again — rather than upgraded on
 * their behalf.
 */
export function isCurrent(record: ConsentRecord | null): record is ConsentRecord {
  return record?.version === LOCATION_DISCLOSURE_VERSION;
}

export async function recordConsent(now = Date.now() / 1000): Promise<ConsentRecord> {
  const record: ConsentRecord = { version: LOCATION_DISCLOSURE_VERSION, granted_at: Math.round(now), sharing: true };
  await write(record);
  return record;
}

/** Pause or resume sensing without touching the agreement itself. */
export async function setSharing(record: ConsentRecord, sharing: boolean): Promise<ConsentRecord> {
  const next: ConsentRecord = { ...record, sharing };
  await write(next);
  return next;
}

/**
 * Withdraw entirely.
 *
 * Deletes the record rather than marking it revoked. There is nothing this app
 * needs a history of withdrawals for, and a stored "used to consent, no longer
 * does" is a fact about a person that exists only because it was convenient to
 * keep.
 */
export async function withdrawConsent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to do and nothing to report: the caller has already stopped
    // sensing, and the disclosure returns on the next launch.
  }
}

async function write(record: ConsentRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage can be full or denied. Sensing still runs for this session on the
    // in-memory record; the disclosure returns next launch, which is the safe
    // direction to fail in.
  }
}
