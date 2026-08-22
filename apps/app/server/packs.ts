import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AnchorPack, CircuitPack, Position } from '@crowdflow/contracts';
import { circuitIntegrityProblems, isTrustworthy } from '@crowdflow/contracts';
import { VenueGraph } from '@crowdflow/core';
import { readPack } from '@crowdflow/cli/ingest';
import type { CircuitSummary, VenueGeometry } from '@crowdflow/contracts/wire';

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
/**
 * The radio survey for one circuit, or an honest empty one.
 *
 * Kept beside the pack rather than inside it because the two decay on different
 * clocks: the geography is good for a decade, the Wi-Fi estate is re-cabled
 * between events. A venue with no survey returns an empty pack with
 * `surveyed_at: null` rather than a 404, because "no anchors here" is a fact a
 * handset must act on — it means fall through to GNSS — and it should not have
 * to infer that from an error code.
 */
export function anchorPack(root: string, id: string): AnchorPack {
  const path = join(root, 'circuits', id, 'pack', 'anchors.json');
  if (!existsSync(path)) return { circuit_id: id, surveyed_at: null, anchors: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as AnchorPack;
  return { circuit_id: id, surveyed_at: parsed.surveyed_at ?? null, anchors: parsed.anchors ?? {} };
}

export const integrityProblems = circuitIntegrityProblems;
