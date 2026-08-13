import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CircuitPack, Position } from '@crowdflow/contracts';
import { circuitIntegrityProblems, isTrustworthy } from '@crowdflow/contracts';
import { VenueGraph } from '@crowdflow/core';
import { readPack } from '@crowdflow/cli/ingest';
import type { CircuitSummary, VenueGeometry } from './wire.js';

export interface LoadedCircuit { pack: CircuitPack; track: Position[]; graph: VenueGraph }
export function availableCircuits(root: string): string[] {
  const directory = join(root, 'circuits');
  return existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(directory, entry.name, 'pack', 'circuit.json'))).map((entry) => entry.name).sort() : [];
}
export function loadCircuit(root: string, id: string): LoadedCircuit {
  const pack = readPack(root, id);
  const path = join(root, 'circuits', id, 'pack', 'track.json');
  const track = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as [number, number][]).map(([x, y]) => ({ x, y })) : [];
  return { pack, track, graph: new VenueGraph(pack) };
}
export function geometry(circuit: LoadedCircuit): VenueGeometry {
  return { pack: circuit.pack, track: circuit.track, integrity_problems: integrityProblems(circuit.pack) };
}
export function summary(circuit: LoadedCircuit): CircuitSummary {
  return { id: circuit.pack.id, name: circuit.pack.name, zones: Object.keys(circuit.pack.zones ?? {}).length, edges: Object.keys(circuit.pack.edges ?? {}).length, crossings: Object.keys(circuit.pack.crossings ?? {}).length, track_length_m: circuit.pack.track_length_m, untrustworthy_widths: Object.values(circuit.pack.edges ?? {}).filter((edge) => !isTrustworthy(edge.width_m)).length };
}
export const integrityProblems = circuitIntegrityProblems;
