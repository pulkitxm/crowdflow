import type { LOSBand } from '@crowdflow/contracts';
import { ControlLoop, RunMetrics, Scenario, type SimConfig, type Simulation, type TickResult } from '@crowdflow/core';
import type { LoadedCircuit } from './packs.js';
import type { ConsoleEvent, ScenarioOption, SessionInfo, SessionStatus, TickEnvelope } from '@crowdflow/contracts/wire';

export const STATUS_HEARTBEAT_MS = 500;
export class ScenarioSession {
  readonly sessionId = `ses-${crypto.randomUUID().slice(0, 8)}`;
  readonly sim: Simulation;
  readonly loop: ControlLoop;
  readonly metrics = new RunMetrics();
  status: SessionStatus = 'paused'; speed: number; tickIndex = 0;
  lastEnvelope: TickEnvelope | null = null; events: ConsoleEvent[] = [];
  private sequence = 0; private timer: NodeJS.Timeout | null = null;
  private memory = new Map<string, LOSBand>(); private listeners = new Set<(envelope: TickEnvelope) => void>();

  constructor(readonly circuit: LoadedCircuit, readonly scenario: Scenario, readonly option: ScenarioOption, readonly population: number, readonly participation: number, readonly intervene = true, speed = 1, overrides: Partial<SimConfig> = {}) {
    this.speed = speed; this.sim = scenario.build(circuit.graph, { participation, ...overrides }); this.loop = new ControlLoop(this.sim, circuit.graph, participation, intervene);
    this.log('session', 'info', `session armed — ${population} spectators, seed ${scenario.seed}`);
  }
  info(): SessionInfo {
    return { session_id: this.sessionId, circuit_id: this.circuit.pack.id, scenario: this.option.id, description: this.scenario.description, status: this.status, seed: this.scenario.seed, population: this.population, participation: this.participation, compliance: this.sim.config.compliance, tick_s: this.sim.config.tick_s, speed: this.speed, intervene: this.intervene, origins: this.option.origins ?? [], destination: this.option.destination ?? null, tick: this.tickIndex, time_s: this.sim.timeS, duration_s: this.scenario.durationS };
  }
  subscribe(listener: (envelope: TickEnvelope) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  note(kind: ConsoleEvent['kind'], severity: ConsoleEvent['severity'], message: string, zoneId?: string): ConsoleEvent { return this.log(kind, severity, message, zoneId); }
  control(action: 'play' | 'pause' | 'step' | 'speed', speed?: number): SessionInfo {
    if (action === 'play' && this.status !== 'completed') { this.status = 'running'; this.schedule(); }
    else if (action === 'pause') { this.status = 'paused'; if (this.timer) clearTimeout(this.timer); }
    else if (action === 'step' && this.status !== 'completed') this.tickOnce();
    else if (action === 'speed') { if (!speed || speed <= 0) throw new Error('speed must be positive'); this.speed = speed; }
    return this.info();
  }
  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.status = 'paused'; }
  tickOnce(): TickEnvelope {
    const started = performance.now(); const result = this.loop.tick(); this.tickIndex += 1;
    this.metrics.observe(result.state, this.sim.config.tick_s); if (result.dispatched) this.metrics.interventions += 1; if (result.verdict && !result.verdict.dispatchable) this.metrics.rejected_by_safety += 1;
    const zones = Object.keys(this.circuit.pack.zones ?? {}); const observed = Object.keys(result.state.zones ?? {}); const unknown = result.state.unobserved_zones ?? []; const silent = zones.filter((id) => !observed.includes(id) && !unknown.includes(id));
    const events = this.deriveEvents(result);
    const envelope: TickEnvelope = {
      tick: this.tickIndex, time_s: result.time_s, compute_ms: Number((performance.now() - started).toFixed(1)), state: result.state,
      forecasts: result.forecasts, actionable: result.forecasts.filter((forecast) => forecast.actionable).map((forecast) => forecast.zone_id), candidates: result.candidates,
      command: result.command, verdict: result.verdict, dispatched: result.dispatched, silent_zones: silent,
      low_confidence_zones: observed.filter((id) => !result.state.zones?.[id]?.confidence.reportable),
      coverage: { zones_total: zones.length, observed: observed.length, unknown: unknown.length, silent: silent.length, low_confidence: observed.filter((id) => !result.state.zones?.[id]?.confidence.reportable).length, fraction_observed: zones.length ? observed.length / zones.length : 0 },
      population: { total: this.sim.agents.length, waiting: this.sim.agents.length - this.sim.active - this.sim.arrived, active: this.sim.active, arrived: this.sim.arrived, observed_nodes: Object.values(result.state.zones ?? {}).reduce((sum, zone) => sum + zone.observed_nodes, 0), estimated_present: Object.values(result.state.zones ?? {}).reduce((sum, zone) => sum + zone.estimated_population, 0) },
      metrics: { peak_density: this.metrics.peak_density, critical_zone_seconds: this.metrics.critical_zone_seconds, building_zone_seconds: this.metrics.building_zone_seconds, peak_critical_zones: this.metrics.peak_critical_zones, total_queue_peak: this.metrics.total_queue_peak, arrived: this.metrics.arrived, mean_walk_s: this.metrics.mean_walk_s, p95_walk_s: this.metrics.p95_walk_s, interventions: this.metrics.interventions, rejected_by_safety: this.metrics.rejected_by_safety, samples: this.metrics.samples },
      nodes: this.sim.emit().map((node) => ({ x: node.position.x, y: node.position.y, speed_ms: node.speed_ms, accuracy_m: node.accuracy_m })), events,
    };
    this.lastEnvelope = envelope; for (const listener of this.listeners) listener(envelope); return envelope;
  }
  private schedule(): void {
    if (this.status !== 'running') return;
    if (this.tickIndex >= Math.trunc(this.scenario.durationS / this.sim.config.tick_s)) { this.status = 'completed'; return; }
    const started = performance.now(); this.tickOnce(); const wait = Math.max(0, this.sim.config.tick_s * 1000 / this.speed - (performance.now() - started));
    this.timer = setTimeout(() => this.schedule(), wait);
  }
  private log(kind: ConsoleEvent['kind'], severity: ConsoleEvent['severity'], message: string, zoneId?: string): ConsoleEvent {
    const event: ConsoleEvent = { seq: ++this.sequence, time_s: this.sim?.timeS ?? 0, kind, severity, message, zone_id: zoneId ?? null, detail: null };
    this.events.push(event); this.events = this.events.slice(-400); return event;
  }
  private deriveEvents(result: TickResult): ConsoleEvent[] {
    const fresh: ConsoleEvent[] = [];
    for (const [id, zone] of Object.entries(result.state.zones ?? {})) {
      const previous = this.memory.get(id); this.memory.set(id, zone.band);
      if (previous !== zone.band && !(previous == null && zone.band === 'nominal')) fresh.push(this.log('band', zone.band === 'critical' ? 'critical' : zone.band === 'building' ? 'warning' : 'info', `${this.circuit.pack.zones?.[id]?.name ?? id} ${previous ?? 'unknown'} -> ${zone.band}`, id));
    }
    if (result.verdict) fresh.push(this.log('safety', result.verdict.dispatchable ? 'info' : 'critical', `safety ${result.verdict.outcome.toUpperCase()}${result.dispatched ? ' — DISPATCHED' : ''}`));
    return fresh;
  }
}
