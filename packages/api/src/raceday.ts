import { randomUUID } from 'node:crypto';
import type { EventProfile } from '@crowdflow/contracts';
import {
  ANOMALY_CATALOGUE,
  DAY_S,
  applyAnomaly,
  clearAnomaly,
  phaseAtSecond,
  raceDayPlan,
  raceState,
  type Anomaly,
  type AnomalyKind,
  type RaceDayPlan,
} from '@crowdflow/core';
import type { LoadedCircuit } from './packs.js';
import { ScenarioSession } from './session.js';
import type { RaceDayRequest, RaceDayStatus, ScenarioOption } from './wire.js';


function hhmmss(secondOfDay: number): string {
  const wrapped = ((Math.round(secondOfDay) % DAY_S) + DAY_S) % DAY_S;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(wrapped / 3600))}:${pad(Math.floor(wrapped / 60) % 60)}:${pad(wrapped % 60)}`;
}

export class RaceDayRun {
  readonly plan: RaceDayPlan;
  readonly session: ScenarioSession;
  readonly anomalies: Anomaly[] = [];

  constructor(readonly circuit: LoadedCircuit, event: EventProfile, utcOffset: string | null, request: RaceDayRequest) {
    const population = request.population ?? 20000;
    this.plan = raceDayPlan(circuit.pack, circuit.graph, event, utcOffset, population, request.seed ?? 42);
    const option: ScenarioOption = {
      id: 'race-day',
      name: `${this.plan.event_name} — full race day`,
      description: this.plan.scenario.description,
      origins: [],
      destination: null,
      origin_names: [],
      destination_name: null,
    };
    this.session = new ScenarioSession(
      circuit,
      this.plan.scenario,
      option,
      population,
      request.participation ?? 1,
      request.intervene ?? true,
      request.speed ?? 60,
      request.tick_s == null ? {} : { tick_s: request.tick_s },
    );
  }

  inject(kind: AnomalyKind, durationS?: number): Anomaly {
    const now = this.session.sim.timeS;
    const stillRunning = this.anomalies.find(
      (anomaly) => anomaly.kind === kind && anomaly.duration_s > 0 && now < anomaly.injected_at_s + anomaly.duration_s,
    );
    if (stillRunning) {
      throw new Error(`${stillRunning.label} is already active until ${hhmmss(stillRunning.injected_at_s + stillRunning.duration_s)}; stacking it would compound its effect rather than model a second one`);
    }
    const spec = durationS == null ? { kind } : { kind, duration_s: durationS };
    const anomaly = applyAnomaly(this.session.sim, spec, this.session.sim.timeS, `anom-${randomUUID().slice(0, 8)}`);
    this.anomalies.unshift(anomaly);
    return anomaly;
  }

  private byArea(): Array<{ kind: string; label: string; count: number }> {
    const zones = this.circuit.pack.zones ?? {};
    const labels: Record<string, string> = { parking: 'CAR PARKS', gate: 'GATES', concourse: 'CONCOURSE', viewing: 'GRANDSTANDS', exit: 'EXITS', amenity: 'AMENITIES', crossing: 'CROSSINGS' };
    const counts = new Map<string, number>();
    for (const zone of Object.values(zones)) counts.set(zone.kind, 0);
    for (const occupant of this.session.sim.occupantPositions()) {
      const kind = zones[occupant.zone]?.kind ?? 'unknown';
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind, count]) => ({ kind, label: labels[kind] ?? kind.toUpperCase(), count }));
  }

  private dayState(clockS: number): RaceDayStatus['day_state'] {
    const first = this.plan.phases.reduce((earliest, phase) => Math.min(earliest, phase.start_s), DAY_S);
    if (clockS >= DAY_S) return 'complete';
    if (clockS < first) return 'pre_event';
    return 'running';
  }

  status(): RaceDayStatus {
    const sim = this.session.sim;
    const clock = sim.timeS;
    for (const anomaly of this.anomalies) {
      if (anomaly.zone && anomaly.duration_s > 0 && clock >= anomaly.injected_at_s + anomaly.duration_s) clearAnomaly(sim, anomaly);
    }
    const current = phaseAtSecond(this.plan.phases, clock);
    return {
      circuit_id: this.plan.circuit_id,
      event_name: this.plan.event_name,
      date: this.plan.date,
      utc_offset: this.plan.utc_offset,
      population: this.plan.population,
      day_s: DAY_S,
      clock_s: clock,
      clock_local: clock >= DAY_S ? '24:00:00' : hhmmss(clock),
      day_state: this.dayState(clock),
      race_start_s: this.plan.race_start_s,
      race_end_s: this.plan.race_end_s,
      race_provenance: this.plan.race_provenance,
      current_phase_id: current?.id ?? null,
      phases: this.plan.phases.map((phase) => ({
        id: phase.id,
        kind: phase.kind,
        name: phase.name,
        start_s: phase.start_s,
        end_s: phase.end_s,
        provenance: phase.provenance,
        source: phase.source,
        crowd_effect: phase.crowd_effect,
        state: clock >= phase.end_s ? 'done' : clock >= phase.start_s ? 'active' : 'pending',
      })),
      crowd: {
        offsite: sim.agents.length - sim.active - sim.arrived,
        walking: sim.active - sim.dwelling,
        dwelling: sim.dwelling,
        departed: sim.arrived - sim.stranded,
        stranded: sim.stranded,
        total: sim.agents.length,
      },
      anomalies: this.anomalies,
      catalogue: ANOMALY_CATALOGUE,
      by_area: this.byArea(),
      race: raceState(clock, this.plan.race_start_s, this.plan.race_end_s, { seed: 42 }),
      crowd_source: 'simulation',
    };
  }
}
