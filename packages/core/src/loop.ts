import { randomUUID } from 'node:crypto';
import type { Forecast, InterventionCandidate, RerouteCommand, SafetyVerdict, VenueState } from '@crowdflow/contracts';
import { validCommandAt } from '@crowdflow/contracts';
import { InterventionEngine } from './intervention/whatif.js';
import { BaselinePredictor } from './prediction/baseline.js';
import { VenueGraph } from './routing/graph.js';
import { SafetyEngine } from './safety/engine.js';
import { Simulation } from './simulation/model.js';
import { StateEngine } from './state/engine.js';

export const COMMAND_TTL_S = 300;
export interface TickResult {
  time_s: number; state: VenueState; forecasts: Forecast[]; candidates: InterventionCandidate[];
  command: RerouteCommand | null; verdict: SafetyVerdict | null; dispatched: boolean;
}

export class ControlLoop {
  readonly stateEngine: StateEngine;
  readonly predictor: BaselinePredictor;
  readonly intervention: InterventionEngine;
  readonly safety: SafetyEngine;
  activeCommand: RerouteCommand | null = null;
  private lastInterventionS = -1e9;

  constructor(
    readonly sim: Simulation,
    readonly graph: VenueGraph,
    readonly participation: number,
    readonly intervene = true,
    horizonS = 300,
  ) {
    this.stateEngine = new StateEngine(graph.pack, participation);
    this.predictor = new BaselinePredictor(horizonS);
    this.intervention = new InterventionEngine(Math.min(horizonS, 120));
    this.safety = new SafetyEngine(graph.pack);
  }

  tick(sessionState: string | null = null): TickResult {
    if (sessionState != null && sessionState !== this.graph.sessionState) {
      this.graph.rebuild(sessionState); this.activeCommand = null; this.sim.avoid.clear(); this.sim.prefer.clear();
    }
    this.sim.step();
    const now = this.sim.timeS;
    this.stateEngine.ingest(this.sim.emit(), now);
    const state = this.stateEngine.snapshot(now, sessionState);
    const forecasts = this.predictor.forecast(state);
    const result: TickResult = { time_s: now, state, forecasts, candidates: [], command: null, verdict: null, dispatched: false };
    if (this.activeCommand && !validCommandAt(this.activeCommand, now)) {
      this.activeCommand = null; this.sim.avoid.clear(); this.sim.prefer.clear();
    }
    if (!this.intervene || this.activeCommand || now - this.lastInterventionS < 120) return result;
    const target = forecasts.find((forecast) => forecast.actionable);
    if (!target) return result;
    const alternative = this.alternativeTo(target.zone_id);
    if (!alternative) return result;
    const chosen = this.intervention.evaluate(this.sim, target.zone_id, alternative, new Set([target.zone_id]), new Set([alternative]));
    result.candidates = chosen.candidates; this.lastInterventionS = now;
    if (!chosen.selected) return result;
    const command: RerouteCommand = {
      command_id: `cmd-${randomUUID().slice(0, 8)}`, issued_at: now, expires_at: now + COMMAND_TTL_S,
      source_zone: target.zone_id, destination_zone: chosen.selected.to_zone,
      avoid: [target.zone_id], prefer: [chosen.selected.to_zone], target_fraction: chosen.selected.divert_fraction,
      reason: target.causes?.[0] ?? 'flow rising toward capacity', expected_cost_s: chosen.selected.projected_walk_time_delta_s,
    };
    const verdict = this.safety.review(command, state, this.graph);
    result.command = command; result.verdict = verdict;
    if (verdict.dispatchable) {
      this.activeCommand = command; this.sim.avoid = new Set(command.avoid); this.sim.prefer = new Set(command.prefer); result.dispatched = true;
    }
    return result;
  }

  private alternativeTo(zoneId: string): string | null {
    let best: string | null = null; let degree = -1;
    for (const [next] of this.graph.neighbours(zoneId)) {
      const current = this.graph.neighbours(next).length;
      if (current > degree) { best = next; degree = current; }
    }
    return best;
  }
}
