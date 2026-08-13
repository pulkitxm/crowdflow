import type { CircuitPack, Forecast, VenueState } from '@crowdflow/contracts';
import { InterventionEngine, SafetyEngine, Simulation, VenueGraph } from '@crowdflow/core';
import type { ToolSchema } from './client.js';
import { ProposalLedger, proposalSummary, type Proposal } from './proposals.js';

export interface OpsContext { pack: CircuitPack; graph: VenueGraph; safety: SafetyEngine; state: VenueState; now: number; forecasts?: Forecast[]; simulation?: Simulation; intervention?: InterventionEngine }
interface ToolSpec { schema: ToolSchema; invoke(arguments_: Record<string, unknown>): Record<string, unknown> }
export class Toolbox {
  readonly ledger: ProposalLedger; private specs = new Map<string, ToolSpec>();
  constructor(readonly context: OpsContext) { this.ledger = new ProposalLedger(context.safety); this.build(); }
  schemas(): ToolSchema[] { return [...this.specs.values()].map((spec) => spec.schema); }
  get proposals(): Proposal[] { return [...this.ledger.proposals]; }
  invoke(name: string, arguments_: Record<string, unknown>): Record<string, unknown> {
    const spec = this.specs.get(name); if (!spec) return { error: `unknown tool ${name}`, available: [...this.specs.keys()] };
    try { return spec.invoke(arguments_); } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }
  private add(name: string, description: string, properties: Record<string, unknown>, required: string[], invoke: ToolSpec['invoke']): void {
    this.specs.set(name, { schema: { name, description, input_schema: { type: 'object', properties, required, additionalProperties: false } }, invoke });
  }
  private build(): void {
    this.add('get_venue_state', 'Current engine-computed crowd state; unobserved is unknown.', {}, [], () => {
      const zones = Object.values(this.context.state.zones ?? {}); return { circuit_id: this.context.state.circuit_id, observed_zones: zones.length, unobserved_zones: this.context.state.unobserved_zones?.length ?? 0, estimated_present: zones.reduce((sum, zone) => sum + zone.estimated_population, 0), band_counts: { nominal: zones.filter((zone) => zone.band === 'nominal').length, building: zones.filter((zone) => zone.band === 'building').length, critical: zones.filter((zone) => zone.band === 'critical').length }, worst_zones: [...zones].sort((a, b) => b.density_persons_m2 - a.density_persons_m2).slice(0, 8) };
    });
    this.add('get_zone_state', 'One zone, including confidence; never fabricates absent state.', { zone_id: { type: 'string' } }, ['zone_id'], (args) => {
      const id = requiredString(args, 'zone_id'); if (!(id in (this.context.pack.zones ?? {}))) throw new Error(`unknown zone ${id}`);
      const state = this.context.state.zones?.[id]; return state ? { observed: true, ...state } : { zone_id: id, observed: false, note: 'unknown, not empty' };
    });
    this.add('get_predictions', 'Forecasts already computed by the predictor.', {}, [], () => ({ forecasts: this.context.forecasts ?? [] }));
    this.add('find_alternative_route', 'Route computed by VenueGraph.', { origin: { type: 'string' }, destination: { type: 'string' }, avoid: { type: 'array', items: { type: 'string' } } }, ['origin', 'destination'], (args) => {
      const route = this.context.graph.route(requiredString(args, 'origin'), requiredString(args, 'destination'), this.context.state.zones, new Set(array(args.avoid))); return route.path.length ? { found: true, path: route.path, distance_m: route.distance_m, walk_time_s: route.eta_s } : { found: false, reason: route.rejected_reason };
    });
    this.add('simulate_intervention', 'Seeded counterfactual sweep including do nothing.', { from_zone: { type: 'string' }, to_zone: { type: 'string' } }, ['from_zone', 'to_zone'], (args) => {
      if (!this.context.simulation || !this.context.intervention) throw new Error('no simulation attached'); const from = requiredString(args, 'from_zone'); const to = requiredString(args, 'to_zone'); return this.context.intervention.evaluate(this.context.simulation, from, to, new Set([from]), new Set([to])) as unknown as Record<string, unknown>;
    });
    this.add('create_reroute', 'Propose only; safety reviews and nothing dispatches.', { source_zone: { type: 'string' }, destination_zone: { type: 'string' }, avoid: { type: 'array', items: { type: 'string' } }, prefer: { type: 'array', items: { type: 'string' } }, target_fraction: { type: 'number', minimum: 0, maximum: 1 }, reason: { type: 'string' } }, ['source_zone', 'destination_zone', 'target_fraction', 'reason'], (args) => {
      const source = requiredString(args, 'source_zone'); const destination = requiredString(args, 'destination_zone'); const avoid = array(args.avoid); const prefer = array(args.prefer); const fraction = Number(args.target_fraction); if (!(fraction >= 0 && fraction <= 1)) throw new Error('target_fraction must be in [0,1]');
      const baseline = this.context.graph.route(source, destination, this.context.state.zones); const diverted = this.context.graph.route(source, destination, this.context.state.zones, new Set(avoid), new Set(prefer)); if (!baseline.path.length || !diverted.path.length) throw new Error('cannot cost reroute');
      return proposalSummary(this.ledger.propose({ now: this.context.now, source_zone: source, destination_zone: destination, avoid, prefer, target_fraction: fraction, reason: requiredString(args, 'reason'), expected_cost_s: Number((diverted.eta_s - baseline.eta_s).toFixed(1)), state: this.context.state, graph: this.context.graph }));
    });
  }
}
function requiredString(args: Record<string, unknown>, key: string): string { if (typeof args[key] !== 'string' || !args[key]) throw new Error(`${key} must be a non-empty string`); return args[key]; }
function array(value: unknown): string[] { if (value == null) return []; if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('expected string array'); return value; }
