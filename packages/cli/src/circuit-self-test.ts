import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  circuitIntegrityProblems,
  type CircuitCapability,
  type CircuitPack,
  type Position,
} from '@crowdflow/contracts';
import {
  arrival,
  egress,
  pointToPolylineDistanceM,
  type Scenario,
  validateCircuitGeometry,
  VenueGraph,
} from '@crowdflow/core';

export const CIRCUIT_SELF_TEST_SCHEMA = 'circuit-self-test.v1';
export const CIRCUIT_SELF_TEST_POPULATIONS = [1, 2, 100] as const;

export interface CircuitSimulationSelfTest {
  kind: 'arrival' | 'egress';
  population: number;
  ok: boolean;
  ticks: number;
  arrived: number;
  stranded: number;
  finite_positions: boolean;
  track_clearance_violations: number;
  deterministic: boolean;
  problems: string[];
}

export interface CircuitSelfTestResult {
  id: string;
  capability: CircuitCapability | 'unknown';
  profile: 'simulation_only' | 'review_required' | 'operational' | 'unknown';
  ok: boolean;
  zones: number;
  edges: number;
  contract_problems: string[];
  geometry_problems: string[];
  warnings: string[];
  simulations: CircuitSimulationSelfTest[];
}

export interface CircuitSelfTestReport {
  schema: typeof CIRCUIT_SELF_TEST_SCHEMA;
  ok: boolean;
  seed: number;
  populations: number[];
  totals: {
    circuits: number;
    passed: number;
    failed: number;
    simulations: number;
    simulation_failures: number;
  };
  circuits: CircuitSelfTestResult[];
}

interface LoadedCandidate {
  id: string;
  pack: CircuitPack | null;
  track: Position[];
  problems: string[];
}

interface SimulationOutcome {
  ticks: number;
  arrived: number;
  stranded: number;
  finitePositions: boolean;
  trackClearanceViolations: number;
  signature: string;
  problems: string[];
}

export function committedCircuitIds(root: string): string[] {
  const directory = join(root, 'circuits');
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(directory, entry.name, 'pack', 'circuit.json')))
    .map((entry) => entry.name)
    .sort();
}

export function selfTestCommittedCircuits(root: string, seed = 42): CircuitSelfTestReport {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('seed must be a non-negative integer');
  const circuits = committedCircuitIds(root).map((id) => selfTestCandidate(loadCandidate(root, id), seed));
  const simulations = circuits.flatMap((circuit) => circuit.simulations);
  const passed = circuits.filter((circuit) => circuit.ok).length;
  return {
    schema: CIRCUIT_SELF_TEST_SCHEMA,
    ok: circuits.length > 0 && passed === circuits.length,
    seed,
    populations: [...CIRCUIT_SELF_TEST_POPULATIONS],
    totals: {
      circuits: circuits.length,
      passed,
      failed: circuits.length - passed,
      simulations: simulations.length,
      simulation_failures: simulations.filter((simulation) => !simulation.ok).length,
    },
    circuits,
  };
}

export function selfTestCircuit(pack: CircuitPack, track: Position[], seed = 42): CircuitSelfTestResult {
  return selfTestCandidate({ id: pack.id, pack, track, problems: [] }, seed);
}

function selfTestCandidate(candidate: LoadedCandidate, seed: number): CircuitSelfTestResult {
  const capability: CircuitCapability | 'unknown' = candidate.pack?.capability ?? 'unknown';
  const profile: CircuitSelfTestResult['profile'] =
    capability === 'synthetic_simulation'
      ? 'simulation_only'
      : capability === 'venue_imported'
        ? 'review_required'
        : capability === 'venue_reviewed'
          ? 'operational'
          : 'unknown';
  const contractProblems = candidate.pack
    ? [...candidate.problems, ...circuitIntegrityProblems(candidate.pack)]
    : [...candidate.problems];
  const base = {
    id: candidate.id,
    capability,
    profile,
    zones: Object.keys(candidate.pack?.zones ?? {}).length,
    edges: Object.keys(candidate.pack?.edges ?? {}).length,
  };
  if (!candidate.pack || contractProblems.length) {
    return {
      ...base,
      ok: false,
      contract_problems: unique(contractProblems.length ? contractProblems : ['pack could not be loaded']),
      geometry_problems: [],
      warnings: [],
      simulations: [],
    };
  }
  const geometry = validateCircuitGeometry(candidate.pack, candidate.track);
  if (geometry.problems.length) {
    return {
      ...base,
      ok: false,
      contract_problems: [],
      geometry_problems: geometry.problems,
      warnings: geometry.warnings,
      simulations: [],
    };
  }
  const graph = new VenueGraph(candidate.pack);
  const simulations = buildSimulationCases(candidate.pack, graph, seed).flatMap((testCase) =>
    CIRCUIT_SELF_TEST_POPULATIONS.map((population) =>
      testSimulation(candidate.pack!, candidate.track, graph, testCase, population, seed),
    ),
  );
  if (!simulations.length) {
    simulations.push({
      kind: 'arrival',
      population: 0,
      ok: false,
      ticks: 0,
      arrived: 0,
      stranded: 0,
      finite_positions: true,
      track_clearance_violations: 0,
      deterministic: true,
      problems: ['no arrival or egress scenario could be built'],
    });
  }
  return {
    ...base,
    ok: simulations.every((simulation) => simulation.ok),
    contract_problems: [],
    geometry_problems: [],
    warnings: geometry.warnings,
    simulations,
  };
}

function buildSimulationCases(
  pack: CircuitPack,
  graph: VenueGraph,
  seed: number,
): Array<{ kind: 'arrival' | 'egress'; build: (population: number) => Scenario }> {
  const zones = Object.values(pack.zones ?? {}).sort((left, right) => left.id.localeCompare(right.id));
  const gates = zones.filter((zone) => zone.kind === 'gate');
  const views = zones.filter((zone) => zone.kind === 'viewing');
  const destinations = zones.filter((zone) => zone.kind === 'exit' || zone.kind === 'parking');
  const arrivalPair = gates
    .flatMap((gate) => views.map((view) => ({ gate: gate.id, view: view.id, route: graph.route(gate.id, view.id) })))
    .filter((pair) => pair.route.path.length > 1)
    .sort(
      (left, right) =>
        left.route.cost_s - right.route.cost_s ||
        left.gate.localeCompare(right.gate) ||
        left.view.localeCompare(right.view),
    )[0];
  const egressPair = destinations
    .map((destination) => ({
      destination: destination.id,
      origins: views.filter((view) => graph.route(view.id, destination.id).path.length > 1).map((view) => view.id),
    }))
    .filter((pair) => pair.origins.length > 0)
    .sort(
      (left, right) => right.origins.length - left.origins.length || left.destination.localeCompare(right.destination),
    )[0];
  const cases: Array<{ kind: 'arrival' | 'egress'; build: (population: number) => Scenario }> = [];
  if (arrivalPair) {
    cases.push({
      kind: 'arrival',
      build: (population) => arrival(graph, arrivalPair.gate, arrivalPair.view, population, seed, 0),
    });
  }
  if (egressPair) {
    cases.push({
      kind: 'egress',
      build: (population) => egress(graph, egressPair.origins, egressPair.destination, population, seed, 0),
    });
  }
  return cases;
}

function testSimulation(
  pack: CircuitPack,
  track: Position[],
  graph: VenueGraph,
  testCase: { kind: 'arrival' | 'egress'; build: (population: number) => Scenario },
  population: number,
  seed: number,
): CircuitSimulationSelfTest {
  const first = advanceSimulation(pack, track, graph, testCase.build(population), population, seed);
  const second = advanceSimulation(pack, track, graph, testCase.build(population), population, seed);
  const deterministic = first.signature === second.signature;
  const problems = [...first.problems];
  if (!deterministic) problems.push('simulation is not deterministic');
  return {
    kind: testCase.kind,
    population,
    ok: problems.length === 0,
    ticks: first.ticks,
    arrived: first.arrived,
    stranded: first.stranded,
    finite_positions: first.finitePositions,
    track_clearance_violations: first.trackClearanceViolations,
    deterministic,
    problems: unique(problems),
  };
}

function advanceSimulation(
  pack: CircuitPack,
  track: Position[],
  graph: VenueGraph,
  scenario: Scenario,
  population: number,
  seed: number,
): SimulationOutcome {
  const tickS = 30;
  const maximumTicks = 20_000;
  const simulation = scenario.build(graph, { seed, tick_s: tickS, participation: 1, speed_sigma: 0, compliance: 1 });
  const crossingEdges = new Set(Object.values(pack.crossings ?? {}).map((crossing) => crossing.edge_id));
  const problems: string[] = [];
  let finitePositions = true;
  let trackClearanceViolations = 0;
  let ticks = 0;
  if (simulation.agents.length !== population)
    problems.push(`expected ${population} agents, built ${simulation.agents.length}`);
  while (simulation.arrived < simulation.agents.length && ticks < maximumTicks) {
    simulation.step();
    ticks += 1;
    const agents = new Map(simulation.agents.map((agent) => [agent.id, agent]));
    for (const occupant of simulation.occupantPositions()) {
      if (!Number.isFinite(occupant.position.x) || !Number.isFinite(occupant.position.y)) finitePositions = false;
      const edgeId = agents.get(occupant.id)?.edge_id;
      if (
        !edgeId ||
        crossingEdges.has(edgeId) ||
        pointToPolylineDistanceM(occupant.position, track) + 1e-6 >= pack.track_clearance_m.value
      )
        continue;
      trackClearanceViolations += 1;
    }
    for (const node of simulation.emit())
      if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) finitePositions = false;
  }
  if (!finitePositions) problems.push('simulation emitted a non-finite position');
  if (trackClearanceViolations) problems.push(`${trackClearanceViolations} positions entered track clearance`);
  if (simulation.agents.length !== population) problems.push('simulation population changed');
  if (simulation.stranded) problems.push(`${simulation.stranded} agents were stranded`);
  if (simulation.arrived !== population) problems.push(`${population - simulation.arrived} agents did not arrive`);
  return {
    ticks,
    arrived: simulation.arrived,
    stranded: simulation.stranded,
    finitePositions,
    trackClearanceViolations,
    signature: JSON.stringify({
      ticks,
      arrived: simulation.arrived,
      stranded: simulation.stranded,
      walk: simulation.arrivedWalkTimes,
      agents: simulation.agents.map((agent) => [agent.id, agent.at, agent.arrived, agent.stranded, agent.walk_time_s]),
    }),
    problems: unique(problems),
  };
}

function loadCandidate(root: string, id: string): LoadedCandidate {
  const directory = join(root, 'circuits', id, 'pack');
  const problems: string[] = [];
  try {
    const metadata = readJson(join(directory, 'circuit.json')) as CircuitPack;
    const graph = readJson(join(directory, 'graph.json')) as Pick<CircuitPack, 'zones' | 'edges'>;
    const crossings = readJson(join(directory, 'crossings.json')) as CircuitPack['crossings'];
    const constraints = readJson(join(directory, 'constraints.json')) as CircuitPack['constraints'];
    const rawTrack = readJson(join(directory, 'track.json'));
    if (!Array.isArray(rawTrack)) problems.push('track.json must contain an array');
    const track = Array.isArray(rawTrack)
      ? rawTrack.map((point) =>
          Array.isArray(point) && point.length >= 2
            ? { x: Number(point[0]), y: Number(point[1]) }
            : { x: Number.NaN, y: Number.NaN },
        )
      : [];
    const pack: CircuitPack = {
      ...metadata,
      ...(graph.zones ? { zones: graph.zones } : {}),
      ...(graph.edges ? { edges: graph.edges } : {}),
      ...(crossings ? { crossings } : {}),
      ...(constraints ? { constraints } : {}),
    };
    return { id, pack, track, problems };
  } catch (error) {
    return { id, pack: null, track: [], problems: [error instanceof Error ? error.message : String(error)] };
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
