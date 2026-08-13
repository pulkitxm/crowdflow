import { VenueGraph } from '../routing/graph.js';
import { Simulation, type SimConfig } from './model.js';

export interface Cohort { count: number; origin: string; destination: string; start_s: number; spread_s: number }
export class Scenario {
  constructor(
    readonly name: string,
    readonly description: string,
    readonly cohorts: Cohort[],
    readonly durationS = 900,
    readonly seed = 42,
  ) {}
  build(graph: VenueGraph, overrides: Partial<SimConfig> = {}): Simulation {
    const simulation = new Simulation(graph, { seed: this.seed, ...overrides });
    for (const cohort of this.cohorts) simulation.addAgents(cohort.count, cohort.origin, cohort.destination, cohort.start_s, cohort.spread_s);
    return simulation;
  }
}

export function egress(_graph: VenueGraph, origins: string[] | string, exit: string, count = 2000, seed = 42, spreadS = 240): Scenario {
  const list = typeof origins === 'string' ? [origins] : origins;
  const per = Math.max(1, Math.trunc(count / list.length));
  return new Scenario(
    'post-race-egress', `${per * list.length} spectators leave ${list.length} stand(s) for ${exit} at the flag`,
    list.map((origin) => ({ count: per, origin, destination: exit, start_s: 0, spread_s: spreadS })),
    1800, seed,
  );
}
