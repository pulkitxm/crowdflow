#!/usr/bin/env bun
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenerator, type Config } from 'ts-json-schema-generator';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const config: Config = { path: join(packageRoot, 'src/types.ts'), tsconfig: join(packageRoot, 'tsconfig.json'), type: '*', expose: 'export', topRef: true, jsDoc: 'extended', additionalProperties: false, skipTypeCheck: false };
const EXPORTED = [
  'CrossingClosed', 'CrossingNotice', 'CrossingOpen', 'LinkStatus', 'RerouteCommand', 'RerouteOffer', 'Route', 'SafetyVerdict', 'Step', 'AheadView', 'GateChoice', 'ArrivalView', 'Availability', 'CoordinateFrame', 'Crossing', 'Edge', 'Position', 'SafetyConstraints', 'Sourced', 'Zone', 'CircuitPack', 'Confidence', 'CrowdNode', 'Session', 'EventProfile', 'Forecast', 'LeaveOption', 'HoldView', 'ScoreBreakdown', 'InterventionCandidate', 'MeshMessage', 'OfflineView', 'ReroutedView', 'WalkView', 'SpectatorView', 'TraceFragment', 'ZoneState', 'VenueState',
] as const;

export function documents(): Record<string, unknown> {
  const generator = createGenerator(config); const docs: Record<string, unknown> = {};
  for (const name of EXPORTED) docs[`${name}.json`] = canonical(generator.createSchema(name));
  const all = generator.createSchema('*') as any; const definitions = all.definitions ?? all.$defs ?? {};
  docs['crowdflow.json'] = canonical({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'CrowdFlow contracts', description: 'Generated from authored TypeScript contracts. Do not edit.', $defs: Object.fromEntries(EXPORTED.map((name) => [name, definitions[name] ?? generator.createSchema(name)])) });
  return docs;
}
export function render(document: unknown): string { return `${JSON.stringify(document, null, 2)}\n`; }
export function writeSchemas(): void {
  const directory = join(packageRoot, 'schema'); mkdirSync(directory, { recursive: true }); const expected = documents();
  for (const file of readdirSync(directory)) if (file.endsWith('.json') && !(file in expected)) rmSync(join(directory, file));
  for (const [file, document] of Object.entries(expected)) writeFileSync(join(directory, file), render(document));
}
function canonical(value: any): any {
  if (typeof value === 'string') return value.replaceAll('#/definitions/', '#/$defs/');
  if (Array.isArray(value)) return value.map(canonical); if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {}; for (const key of Object.keys(value).sort()) { const mapped = key === 'definitions' ? '$defs' : key; out[mapped] = canonical(value[key]); }
  if (out.$schema === 'http://json-schema.org/draft-07/schema#') out.$schema = 'https://json-schema.org/draft/2020-12/schema';
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { writeSchemas(); console.log(`schema ${EXPORTED.length} contracts -> packages/contracts/schema/crowdflow.json`); }
