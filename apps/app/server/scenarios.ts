import { ASSUMED_DEMO_POPULATION } from '@crowdflow/contracts';
import { arrival, egress, Scenario } from '@crowdflow/core';
import type { LoadedCircuit } from './packs.js';
import type { ScenarioOption } from '@crowdflow/contracts/wire';

export { ASSUMED_DEMO_POPULATION };
export function defaultExit(circuit: LoadedCircuit): string | null {
  const zones = Object.values(circuit.pack.zones ?? {});
  const exits = zones.filter((zone) => zone.kind === 'exit');
  const candidates = exits.length ? exits : zones.filter((zone) => zone.kind === 'parking');
  return (
    candidates.sort(
      (a, b) => circuit.graph.reachable(b.id).size - circuit.graph.reachable(a.id).size || a.id.localeCompare(b.id),
    )[0]?.id ?? null
  );
}
export function standsReaching(circuit: LoadedCircuit, destination: string): string[] {
  const component = circuit.graph.reachable(destination);
  return Object.values(circuit.pack.zones ?? {})
    .filter((zone) => zone.kind === 'viewing' && component.has(zone.id))
    .map((zone) => zone.id)
    .sort();
}
export function defaultGate(circuit: LoadedCircuit, stand: string): string | null {
  const component = circuit.graph.reachable(stand);
  return (
    Object.values(circuit.pack.zones ?? {})
      .filter((zone) => zone.kind === 'gate' && component.has(zone.id))
      .sort(
        (a, b) =>
          circuit.graph.neighbours(b.id).length - circuit.graph.neighbours(a.id).length || a.id.localeCompare(b.id),
      )[0]?.id ?? null
  );
}
export function scenarioOptions(circuit: LoadedCircuit): ScenarioOption[] {
  const exit = defaultExit(circuit);
  if (!exit) return [];
  const stands = standsReaching(circuit, exit);
  if (!stands.length) return [];
  const out: ScenarioOption[] = [
    {
      id: 'egress',
      name: 'Post-race egress',
      description: 'Everyone leaves at the flag. The hardest twenty minutes of the weekend.',
      origins: stands,
      destination: exit,
      origin_names: stands.map((id) => label(circuit, id)),
      destination_name: label(circuit, exit),
    },
  ];
  const gate = defaultGate(circuit, stands[0]!);
  if (gate)
    out.push({
      id: 'arrival',
      name: 'Gates open',
      description: 'Arrivals spread over an hour; a non-congesting control scenario.',
      origins: [gate],
      destination: stands[0]!,
      origin_names: [label(circuit, gate)],
      destination_name: label(circuit, stands[0]!),
    });
  return out;
}
export function buildScenario(
  circuit: LoadedCircuit,
  id: string,
  population: number,
  seed: number,
  origins?: string[] | null,
  destination?: string | null,
  timing: { joinRatePerS?: number; durationS?: number } = {},
): { scenario: Scenario; option: ScenarioOption } {
  const option = scenarioOptions(circuit).find((value) => value.id === id);
  if (!option) throw new Error(`unknown scenario ${id}`);
  const selectedOrigins = origins?.length ? origins : (option.origins ?? []);
  const selectedDestination = destination ?? option.destination;
  if (!selectedOrigins.length || !selectedDestination) throw new Error(`${id} needs an origin and destination`);
  const unknown = [...selectedOrigins, selectedDestination].filter((zone) => !circuit.pack.zones?.[zone]);
  if (unknown.length) throw new Error(`zones not in pack: ${[...new Set(unknown)].sort().join(', ')}`);
  const allowedOrigins = id === 'egress' ? new Set(['viewing']) : new Set(['gate', 'parking', 'exit']);
  const destinationKinds = id === 'egress' ? new Set(['exit', 'parking', 'gate']) : new Set(['viewing']);
  const invalidOrigins = selectedOrigins.filter((zone) => !allowedOrigins.has(circuit.pack.zones?.[zone]?.kind ?? ''));
  if (invalidOrigins.length) throw new Error(`invalid ${id} origins: ${invalidOrigins.join(', ')}`);
  if (!destinationKinds.has(circuit.pack.zones?.[selectedDestination]?.kind ?? ''))
    throw new Error(`invalid ${id} destination: ${selectedDestination}`);
  const unreachable = selectedOrigins.filter((zone) => circuit.graph.route(zone, selectedDestination).path.length < 2);
  if (unreachable.length)
    throw new Error(`origins without a route to ${selectedDestination}: ${unreachable.join(', ')}`);
  const resolved = {
    ...option,
    origins: [...selectedOrigins],
    destination: selectedDestination,
    origin_names: selectedOrigins.map((zone) => label(circuit, zone)),
    destination_name: label(circuit, selectedDestination),
  };
  const base = id === 'egress'
    ? egress(circuit.graph, selectedOrigins, selectedDestination, population, seed)
    : selectedOrigins.length === 1
      ? arrival(circuit.graph, selectedOrigins[0]!, selectedDestination, population, seed)
      : new Scenario('arrival', `${population} spectators arrive through ${selectedOrigins.length} gates`, selectedOrigins.map((origin, index) => ({ count: Math.floor(population / selectedOrigins.length) + (index < population % selectedOrigins.length ? 1 : 0), origin, destination: selectedDestination, start_s: 0, spread_s: 300 })), 1800, seed);
  const spread = timing.joinRatePerS == null ? null : population / timing.joinRatePerS;
  const cohorts = spread == null ? base.cohorts : base.cohorts.map((cohort) => ({ ...cohort, spread_s: spread }));
  return { scenario: new Scenario(base.name, base.description, cohorts, timing.durationS ?? base.durationS, seed), option: resolved };
}
function label(circuit: LoadedCircuit, id: string): string {
  return circuit.pack.zones?.[id]?.name ?? id;
}
