import type { InterventionCandidate, ScoreBreakdown } from '@crowdflow/contracts';
import { DENSITY_BUILDING_MAX } from '@crowdflow/contracts';
import { density } from '../state/flow.js';
import { Simulation } from '../simulation/model.js';

export const DEFAULT_FRACTIONS = [0, 0.1, 0.2, 0.3, 0.4] as const;
export const WALK_COST_PER_MIN = 8;

export interface WhatIfResult { candidates: InterventionCandidate[]; selected: InterventionCandidate | null }
export class InterventionEngine {
  readonly fractions: number[];
  constructor(readonly horizonS = 300, fractions: readonly number[] = DEFAULT_FRACTIONS) {
    this.fractions = [...new Set([0, ...fractions])].sort((a, b) => a - b);
  }

  evaluate(sim: Simulation, fromZone: string, toZone: string, avoid: Set<string>, prefer: Set<string>): WhatIfResult {
    const results = this.fractions.map((fraction) => [fraction, ...this.runCandidate(sim, fraction, avoid, prefer)] as const);
    const baseline = results.find(([fraction]) => fraction === 0)!;
    let candidates: InterventionCandidate[] = results.map(([fraction, peak, walk, over]) => {
      const reduction = baseline[1] ? (baseline[1] - peak) / baseline[1] * 100 : 0;
      const walkDelta = walk - baseline[2];
      const headroom = Math.max(0, DENSITY_BUILDING_MAX - peak);
      const parts = {
        congestion_reduction: round(reduction, 2),
        walk_time_cost: round(Math.max(0, walkDelta / 60) * WALK_COST_PER_MIN, 2),
        capacity_headroom: round(Math.min(headroom, 2) * 15, 2),
        safety_margin: peak >= DENSITY_BUILDING_MAX ? 0 : 10,
        fairness: round(10 * (1 - fraction), 2),
      };
      const score: ScoreBreakdown = { ...parts, total: total(parts) };
      return {
        candidate_id: `divert-${Math.trunc(fraction * 100).toString().padStart(2, '0')}`,
        description: fraction === 0 ? 'No intervention' : `Divert ${(fraction * 100).toFixed(0)}% of ${fromZone} traffic to ${toZone}`,
        divert_fraction: fraction, from_zone: fromZone, to_zone: toZone, via: [...prefer].sort(),
        projected_peak_density_persons_m2: round(peak, 2), projected_walk_time_delta_s: round(walkDelta, 1),
        projected_bottleneck_duration_s: round(over, 1), score, selected: false,
      } satisfies InterventionCandidate;
    });
    const noAction = candidates.find((candidate) => candidate.divert_fraction === 0)!;
    const best = candidates.filter((candidate) => candidate.divert_fraction > 0)
      .sort((a, b) => b.score.total - a.score.total)[0];
    if (!best || best.score.total <= noAction.score.total) return { candidates, selected: null };
    candidates = candidates.map((candidate) => ({ ...candidate, selected: candidate.candidate_id === best.candidate_id }));
    return { candidates, selected: candidates.find((candidate) => candidate.selected) ?? null };
  }

  private runCandidate(sim: Simulation, fraction: number, avoid: Set<string>, prefer: Set<string>): [number, number, number] {
    const fork = sim.fork();
    fork.avoid = fraction > 0 ? new Set(avoid) : new Set();
    fork.prefer = fraction > 0 ? new Set(prefer) : new Set();
    if (fraction > 0) for (const [index, agent] of fork.agents.entries()) if (agent.complies && index % 100 >= fraction * 100) agent.complies = false;
    let peak = 0; let over = 0;
    for (let step = 0; step < Math.trunc(this.horizonS / fork.config.tick_s); step++) {
      fork.step();
      for (const [edgeId, count] of Object.entries(fork.edgeOccupancy())) {
        const edge = fork.graph.pack.edges?.[edgeId];
        if (!edge) continue;
        const current = density(count, edge.length_m, edge.width_m.value);
        peak = Math.max(peak, current);
        if (current >= DENSITY_BUILDING_MAX) over += fork.config.tick_s;
      }
    }
    const walk = fork.arrivedWalkTimes.length ? fork.arrivedWalkTimes.reduce((a, b) => a + b, 0) / fork.arrivedWalkTimes.length : 0;
    return [peak, walk, over];
  }
}

function total(score: Omit<ScoreBreakdown, 'total'>): number {
  return score.congestion_reduction + score.capacity_headroom + score.safety_margin + score.fairness - score.walk_time_cost;
}
function round(value: number, digits: number): number { return Number(value.toFixed(digits)); }
