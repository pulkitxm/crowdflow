import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'circuits', 'silverstone', 'pack');
const metadata = JSON.parse(readFileSync(join(directory, 'circuit.json'), 'utf8'));
const graph = JSON.parse(readFileSync(join(directory, 'graph.json'), 'utf8'));
const crossings = JSON.parse(readFileSync(join(directory, 'crossings.json'), 'utf8'));
const constraints = JSON.parse(readFileSync(join(directory, 'constraints.json'), 'utf8'));
const track = JSON.parse(readFileSync(join(directory, 'track.json'), 'utf8')).map(([x, y]) => ({ x, y }));
const geometry = { pack: { ...metadata, ...graph, crossings, constraints }, track, integrity_problems: [] };
const output = `export const DEMO_GEOMETRY = ${JSON.stringify(geometry)} as const;\n`;
const target = join(root, 'apps', 'mobile', 'src', 'circuits', 'demo.ts');
if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== output) throw new Error('mobile demo differs from the Silverstone pack');
  process.stdout.write('mobile demo matches the Silverstone pack\n');
} else {
  writeFileSync(target, output);
  process.stdout.write(`mobile demo: ${Object.keys(graph.zones).length} zones, ${Object.keys(graph.edges).length} edges\n`);
}
