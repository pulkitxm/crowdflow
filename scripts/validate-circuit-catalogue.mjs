import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCircuitPack } from '../packages/contracts/src/validate.ts';
import { arrival, egress, pointToPolylineDistanceM, VenueGraph, validateCircuitGeometry } from '../packages/core/src/index.ts';
import { buildOutputs, checkOutputs, EXPECTED_VENUES } from './generate-circuit-catalogue.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readPack(id) {
  const directory = join(repositoryRoot, 'circuits', id, 'pack');
  const metadata = JSON.parse(readFileSync(join(directory, 'circuit.json'), 'utf8'));
  const graph = JSON.parse(readFileSync(join(directory, 'graph.json'), 'utf8'));
  return validateCircuitPack({
    ...metadata,
    zones: graph.zones,
    edges: graph.edges,
    crossings: JSON.parse(readFileSync(join(directory, 'crossings.json'), 'utf8')),
    constraints: JSON.parse(readFileSync(join(directory, 'constraints.json'), 'utf8')),
  });
}

function readTrack(id) {
  const path = join(repositoryRoot, 'circuits', id, 'pack', 'track.json');
  return JSON.parse(readFileSync(path, 'utf8')).map(([x, y]) => ({ x, y }));
}

function runSimulation(pack, graph, track, scenario) {
  const simulation = scenario.build(graph, { participation: 1, compliance: 1 });
  for (let tick = 0; tick < 2000 && simulation.arrived < simulation.agents.length; tick += 1) {
    simulation.step();
    for (const occupant of simulation.occupantPositions()) {
      if (pointToPolylineDistanceM(occupant.position, track) <= pack.track_clearance_m.value) throw new Error(`${pack.id}: simulated walker ${occupant.id} entered track clearance`);
    }
  }
  if (simulation.stranded) throw new Error(`${pack.id}: ${simulation.stranded} simulated walkers stranded`);
  if (simulation.arrived !== simulation.agents.length) throw new Error(`${pack.id}: simulation did not complete`);
  return simulation.arrivedWalkTimes;
}

function validateSimulation(pack, graph, track) {
  const views = Object.values(pack.zones)
    .filter((zone) => zone.kind === 'viewing')
    .map((zone) => zone.id);
  const parking = Object.values(pack.zones)
    .filter((zone) => zone.kind === 'parking')
    .map((zone) => zone.id);
  const gates = Object.values(pack.zones)
    .filter((zone) => zone.kind === 'gate')
    .map((zone) => zone.id);
  for (const gate of gates) {
    for (const view of views) {
      if (graph.route(gate, view).path.length < 2) throw new Error(`${pack.id}: ${gate} cannot reach ${view}`);
    }
  }
  for (const view of views) {
    for (const exit of parking) {
      if (graph.route(view, exit).path.length < 2) throw new Error(`${pack.id}: ${view} cannot reach ${exit}`);
    }
  }
  const egressScenario = egress(graph, views, parking[0], 24, 42, 0);
  const first = runSimulation(pack, graph, track, egressScenario);
  const second = runSimulation(pack, graph, track, egressScenario);
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error(`${pack.id}: seeded egress is not deterministic`);
  for (const [index, gate] of gates.entries()) {
    runSimulation(pack, graph, track, arrival(graph, gate, views[index % views.length], 4, 7, 0));
  }
}

function main() {
  const { outputs, manifest } = buildOutputs();
  const generationProblems = checkOutputs(outputs);
  if (generationProblems.length) throw new Error(generationProblems.join('\n'));
  if (manifest.circuits.length !== EXPECTED_VENUES) throw new Error(`manifest has ${manifest.circuits.length} venues`);
  for (const entry of manifest.circuits) {
    if (entry.georeferenced || entry.operational || entry.capability !== 'synthetic_simulation') throw new Error(`${entry.id}: unsafe catalogue capability claim`);
    const pack = readPack(entry.id);
    const track = readTrack(entry.id);
    const report = validateCircuitGeometry(pack, track);
    if (report.problems.length) throw new Error(`${entry.id}: ${report.problems.join('; ')}`);
    validateSimulation(pack, new VenueGraph(pack), track);
  }
  console.log(`${manifest.circuits.length} pinned synthetic circuits passed geometry, graph, and simulation validation`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
