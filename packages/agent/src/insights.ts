import type { CircuitPack, VenueState } from '@crowdflow/contracts';
import { MAD_TO_SIGMA, MODIFIED_Z_OUTLIER } from '@crowdflow/contracts';

export interface Insight { id: string; kind: 'self_baseline'; metric: string; subject: string; subject_name: string; observed: number; baseline: number; deviation: number; relative_change: number; samples: number; sessions: string[]; headline: string }
export function modifiedZ(value: number, sample: number[], minimum = 8): number | null {
  if (sample.length < minimum) return null; const centre = median(sample); const mad = median(sample.map((item) => Math.abs(item - centre))); return mad <= 0 ? null : (value - centre) / (MAD_TO_SIGMA * mad);
}
export class InsightEngine {
  private series = new Map<string, number[]>();
  constructor(readonly pack: CircuitPack, readonly history = 240) {}
  observe(state: VenueState): void {
    for (const [id, zone] of Object.entries(state.zones ?? {})) for (const metric of ['density_persons_m2', 'outflow_per_min', 'mean_speed_ms'] as const) {
      const key = `${id}:${state.session_id ?? 'unassigned'}:${metric}`; const values = this.series.get(key) ?? []; values.push(zone[metric]); this.series.set(key, values.slice(-this.history));
    }
  }
  insights(): Insight[] {
    const out: Insight[] = [];
    for (const [key, values] of this.series) {
      if (values.length <= 8) continue; const [subject, session, metric] = key.split(':') as [string, string, string]; const observed = values.at(-1)!; const sample = values.slice(0, -1); const score = modifiedZ(observed, sample); if (score == null || Math.abs(score) < MODIFIED_Z_OUTLIER) continue; const baseline = median(sample); const name = this.pack.zones?.[subject]?.name ?? subject;
      out.push({ id: `self-${subject}-${metric}`, kind: 'self_baseline', metric, subject, subject_name: name, observed, baseline, deviation: score, relative_change: baseline ? (observed - baseline) / Math.abs(baseline) : 0, samples: sample.length, sessions: [session], headline: `${name} ${metric} is ${Math.abs(score).toFixed(1)} deviations from its baseline` });
    }
    return out.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
  }
}
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); const middle = Math.trunc(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; }
