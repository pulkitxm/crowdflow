import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateCircuitPack, validateTraceFragment, type CircuitPack, type Position, type TraceFragment } from '@crowdflow/contracts';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export function readPack(root: string, circuitId: string): CircuitPack {
  const directory = join(root, 'circuits', circuitId, 'pack');
  const metadata = JSON.parse(readFileSync(join(directory, 'circuit.json'), 'utf8'));
  const graph = JSON.parse(readFileSync(join(directory, 'graph.json'), 'utf8'));
  return validateCircuitPack({
    ...metadata,
    zones: graph.zones,
    edges: graph.edges,
    crossings: JSON.parse(readFileSync(join(directory, 'crossings.json'), 'utf8')),
    constraints: JSON.parse(readFileSync(join(directory, 'constraints.json'), 'utf8')),
  } as CircuitPack);
}

export function readTrack(root: string, circuitId: string): Position[] {
  const path = join(root, 'circuits', circuitId, 'pack', 'track.json');
  try { return (JSON.parse(readFileSync(path, 'utf8')) as [number, number][]).map(([x, y]) => ({ x, y })); } catch { return []; }
}

export function readTraceFragments(path: string): TraceFragment[] {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.jsonl')) return text.split(/\r?\n/).filter(Boolean).map((line) => validateTraceFragment(JSON.parse(line) as TraceFragment));
  const value = JSON.parse(text) as TraceFragment[] | { fragments?: TraceFragment[] }; return (Array.isArray(value) ? value : value.fragments ?? []).map(validateTraceFragment);
}
export function writeTraceFragments(path: string, fragments: TraceFragment[]): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, fragments.map((fragment) => JSON.stringify(fragment)).join('\n') + (fragments.length ? '\n' : '')); }

export function writePack(root: string, pack: CircuitPack, track: Position[] = []): string {
  const directory = join(root, 'circuits', pack.id, 'pack'); mkdirSync(directory, { recursive: true });
  const { zones = {}, edges = {}, crossings = {}, constraints = {}, ...metadata } = pack;
  writeFileSync(join(directory, 'circuit.json'), JSON.stringify(metadata, null, 2) + '\n');
  writeFileSync(join(directory, 'graph.json'), JSON.stringify({ zones, edges }) + '\n');
  writeFileSync(join(directory, 'crossings.json'), JSON.stringify(crossings, null, 2) + '\n');
  writeFileSync(join(directory, 'constraints.json'), JSON.stringify(constraints, null, 2) + '\n');
  writeFileSync(join(directory, 'track.json'), JSON.stringify(track.map(({ x, y }) => [Number(x.toFixed(2)), Number(y.toFixed(2))])) + '\n'); return directory;
}
