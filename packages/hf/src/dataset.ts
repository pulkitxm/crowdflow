import type { VenueState } from '@crowdflow/contracts';
import { writeFileSync } from 'node:fs';
import { zoneFeatures } from './features.js';

export interface DatasetRow {
  circuit_id: string;
  scenario: string;
  seed: number;
  zone_id: string;
  tick_s: number;
  features: Record<string, number>;
  /** seconds until the zone first reaches `critical`, or null if never within the horizon */
  congested_within_s: number | null;
}

export interface LabelOptions { scenario: string; seed: number; horizonS?: number }

/**
 * Turns an ordered sequence of venue-state snapshots into labelled training
 * rows: one row per observed zone per tick, labelled by looking ahead for the
 * first `critical` band. Pure and deterministic — the JSONL writer is separate.
 */
export function labelStates(states: VenueState[], options: LabelOptions): DatasetRow[] {
  const horizonS = options.horizonS ?? 180;
  const rows: DatasetRow[] = [];
  for (let i = 0; i < states.length; i += 1) {
    const state = states[i]!;
    const t0 = state.timestamp;
    for (const zone of Object.values(state.zones ?? {})) {
      let congestedWithin: number | null = null;
      for (let j = i + 1; j < states.length; j += 1) {
        const later = states[j]!;
        if (later.timestamp - t0 > horizonS) break;
        const laterZone = later.zones?.[zone.zone_id];
        if (laterZone?.band === 'critical') { congestedWithin = later.timestamp - t0; break; }
      }
      rows.push({
        circuit_id: state.circuit_id,
        scenario: options.scenario,
        seed: options.seed,
        zone_id: zone.zone_id,
        tick_s: t0,
        features: zoneFeatures(zone),
        congested_within_s: congestedWithin,
      });
    }
  }
  return rows;
}

/** Write rows as JSON Lines, one object per line. */
export function writeDataset(path: string, rows: DatasetRow[]): void {
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}
