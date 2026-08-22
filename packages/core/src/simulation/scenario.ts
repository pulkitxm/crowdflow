import { VenueGraph } from '../routing/graph.js';
import { Simulation, type Leg, type SimConfig } from './model.js';

export interface Cohort {
  count: number;
  origin: string;
  destination: string;
  start_s: number;
  spread_s: number;
  itinerary?: Leg[];
}
export class Scenario {
  populate: ((simulation: Simulation) => void) | null = null;

  constructor(
    readonly name: string,
    readonly description: string,
    readonly cohorts: Cohort[],
    readonly durationS = 900,
    readonly seed = 42,
  ) {}
  build(graph: VenueGraph, overrides: Partial<SimConfig> = {}): Simulation {
    const simulation = new Simulation(graph, { seed: this.seed, ...overrides });
    if (this.populate) {
      this.populate(simulation);
      return simulation;
    }
    for (const cohort of this.cohorts) {
      if (cohort.itinerary?.length)
        simulation.addItinerary(cohort.count, cohort.origin, cohort.itinerary, cohort.start_s, cohort.spread_s);
      else simulation.addAgents(cohort.count, cohort.origin, cohort.destination, cohort.start_s, cohort.spread_s);
    }
    return simulation;
  }
}

export function arrival(
  _graph: VenueGraph,
  gate: string,
  stand: string,
  count = 1500,
  seed = 42,
  spreadS = 300,
): Scenario {
  return new Scenario(
    'arrival',
    `${count} spectators arrive through ${gate} for ${stand}`,
    [{ count, origin: gate, destination: stand, start_s: 0, spread_s: spreadS }],
    1800,
    seed,
  );
}

export function egress(
  _graph: VenueGraph,
  origins: string[] | string,
  exit: string,
  count = 2000,
  seed = 42,
  spreadS = 240,
): Scenario {
  const list = typeof origins === 'string' ? [origins] : origins;
  if (!list.length) throw new Error('egress needs at least one origin');
  const base = Math.trunc(count / list.length);
  const remainder = count % list.length;
  const cohorts = list
    .map((origin, index) => ({
      count: base + (index < remainder ? 1 : 0),
      origin,
      destination: exit,
      start_s: 0,
      spread_s: spreadS,
    }))
    .filter((cohort) => cohort.count > 0);
  return new Scenario(
    'post-race-egress',
    `${count} spectators leave ${cohorts.length} stand(s) for ${exit} at the flag`,
    cohorts,
    1800,
    seed,
  );
}
