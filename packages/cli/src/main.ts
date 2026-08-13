#!/usr/bin/env -S node --import tsx
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abTest, egress, VenueGraph } from '@crowdflow/core';
import { readPack } from './ingest.js';

interface Options { [key: string]: string | boolean }
function parse(argv: string[]): { words: string[]; options: Options } {
  const words: string[] = []; const options: Options = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]!;
    if (!value.startsWith('--')) { words.push(value); continue; }
    const key = value.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { options[key] = next; i += 1; } else options[key] = true;
  }
  return { words, options };
}
function number(options: Options, key: string, fallback: number): number {
  const value = options[key]; return typeof value === 'string' ? Number(value) : fallback;
}
function root(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  while (current !== dirname(current)) {
    if (existsSync(join(current, 'circuits', 'index.yaml'))) return current;
    current = dirname(current);
  }
  return resolve('.');
}

const { words, options } = parse(process.argv.slice(2));
if (words[0] === 'sim' && words[1] === 'ab') {
  const circuitId = words[2] ?? 'silverstone';
  const count = number(options, 'count', 6000);
  const ticks = number(options, 'ticks', 400);
  const participation = number(options, 'participation', 0.18);
  const seed = number(options, 'seed', 42);
  const pack = readPack(root(), circuitId);
  const graph = new VenueGraph(pack);
  const parks = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'parking');
  if (!parks.length) throw new Error('no parking zone in pack');
  const exit = parks.sort((a, b) => graph.reachable(b.id).size - graph.reachable(a.id).size)[0]!.id;
  const component = graph.reachable(exit);
  const stands = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'viewing' && component.has(zone.id)).map((zone) => zone.id);
  if (!stands.length) throw new Error(`no grandstands connected to ${exit}`);
  const scenario = egress(graph, stands, exit, count, seed);
  console.log(`A/B — ${pack.name}, ${scenario.name}`);
  console.log(`  ${count} spectators, seed ${seed}, participation ${(participation * 100).toFixed(0)}%`);
  console.log('  identical seed both arms; only the intervention differs\n');
  const result = abTest(scenario, graph, participation, ticks);
  console.log(`  ${'metric'.padEnd(34)}${'without'.padStart(12)}${'with'.padStart(12)}${'change'.padStart(10)}`);
  console.log(`  ${'-'.repeat(68)}`);
  for (const [label, before, after, change] of result.summary()) {
    const delta = Math.abs(change) < 0.05 ? '' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
    console.log(`  ${label.padEnd(34)}${before.toFixed(1).padStart(12)}${after.toFixed(1).padStart(12)}${delta.padStart(10)}`);
  }
  console.log(`\n  GATE ${result.passesGate ? 'PASSED — intervention reduced both peak density and time beyond capacity' : 'FAILED — intervention did not measurably help'}`);
  if (!result.passesGate) process.exitCode = 1;
} else {
  console.log('CrowdFlow TypeScript CLI\n\n  crowdflow sim ab [circuit] --count 6000 --ticks 700 --seed 42');
}
