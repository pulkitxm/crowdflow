import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CircuitPack } from '@crowdflow/contracts';

export function readPack(root: string, circuitId: string): CircuitPack {
  const directory = join(root, 'circuits', circuitId, 'pack');
  const metadata = JSON.parse(readFileSync(join(directory, 'circuit.json'), 'utf8'));
  const graph = JSON.parse(readFileSync(join(directory, 'graph.json'), 'utf8'));
  return {
    ...metadata,
    zones: graph.zones,
    edges: graph.edges,
    crossings: JSON.parse(readFileSync(join(directory, 'crossings.json'), 'utf8')),
    constraints: JSON.parse(readFileSync(join(directory, 'constraints.json'), 'utf8')),
  } as CircuitPack;
}
