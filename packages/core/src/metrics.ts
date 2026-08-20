import type { VenueState } from '@crowdflow/contracts';
import { ControlLoop, type TickResult } from './loop.js';
import { VenueGraph } from './routing/graph.js';
import { Scenario } from './simulation/scenario.js';
import { round } from './statistics.js';

export class RunMetrics {
  peak_density = 0; critical_zone_seconds = 0; building_zone_seconds = 0;
  peak_critical_zones = 0; total_queue_peak = 0; arrived = 0; mean_walk_s = 0;
  p95_walk_s = 0; interventions = 0; rejected_by_safety = 0; samples = 0;

  observe(state: VenueState, tickS: number): void {
    this.samples += 1;
    const zones = Object.values(state.zones ?? {});
    const critical = zones.filter((zone) => zone.band === 'critical');
    const building = zones.filter((zone) => zone.band === 'building');
    this.critical_zone_seconds += critical.length * tickS;
    this.building_zone_seconds += building.length * tickS;
    this.peak_critical_zones = Math.max(this.peak_critical_zones, critical.length);
    if (zones.length) {
      this.peak_density = Math.max(this.peak_density, ...zones.map((zone) => zone.density_persons_m2));
      this.total_queue_peak = Math.max(this.total_queue_peak, zones.reduce((sum, zone) => sum + (zone.queue_excess ?? 0), 0));
    }
  }

  finalise(walkTimes: number[]): this {
    const walks = [...walkTimes].sort((a, b) => a - b);
    this.arrived = walks.length;
    if (walks.length) {
      this.mean_walk_s = walks.reduce((a, b) => a + b, 0) / walks.length;
      this.p95_walk_s = walks[Math.min(walks.length - 1, Math.trunc(0.95 * walks.length))]!;
    }
    return this;
  }

  rows(): Array<[string, number]> {
    return [
      ['peak density (ped/m2)', round(this.peak_density, 3)],
      ['critical zone-seconds', round(this.critical_zone_seconds, 1)],
      ['building zone-seconds', round(this.building_zone_seconds, 1)],
      ['peak simultaneous critical zones', this.peak_critical_zones],
      ['peak queued (people)', Math.round(this.total_queue_peak)],
      ['arrived', this.arrived], ['mean walk (s)', round(this.mean_walk_s, 1)],
      ['p95 walk (s)', round(this.p95_walk_s, 1)], ['interventions dispatched', this.interventions],
      ['rejected by safety', this.rejected_by_safety],
    ];
  }
}

export class ABResult {
  constructor(readonly without: RunMetrics, readonly withIntervention: RunMetrics) {}
  get passesGate(): boolean {
    return this.withIntervention.critical_zone_seconds < this.without.critical_zone_seconds
      && this.withIntervention.peak_density <= this.without.peak_density;
  }
  summary(): Array<[string, number, number, number]> {
    return this.without.rows().map(([label, before], index) => {
      const after = this.withIntervention.rows()[index]![1];
      return [label, before, after, before ? round((after - before) / before * 100, 1) : 0];
    });
  }
}

export function runScenario(
  scenario: Scenario, graph: VenueGraph, intervene: boolean, participation: number, ticks: number,
): [RunMetrics, TickResult[]] {
  const simulation = scenario.build(graph, { participation });
  const loop = new ControlLoop(simulation, graph, participation, intervene);
  const metrics = new RunMetrics(); const results: TickResult[] = [];
  for (let i = 0; i < ticks; i++) {
    const result = loop.tick(); metrics.observe(result.state, simulation.config.tick_s);
    if (result.dispatched) metrics.interventions += 1;
    if (result.verdict && !result.verdict.dispatchable) metrics.rejected_by_safety += 1;
    results.push(result);
  }
  return [metrics.finalise(simulation.arrivedWalkTimes), results];
}

export function abTest(scenario: Scenario, graph: VenueGraph, participation: number, ticks: number): ABResult {
  const [without] = runScenario(scenario, graph, false, participation, ticks);
  const [withIntervention] = runScenario(scenario, graph, true, participation, ticks);
  return new ABResult(without, withIntervention);
}
