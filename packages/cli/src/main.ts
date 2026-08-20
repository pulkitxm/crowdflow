#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  CAPACITY_DENSITY, DENSITY_BUILDING_MAX, DENSITY_NOMINAL_MAX, FREE_FLOW_SPEED_MS,
  JAM_DENSITY_PERSONS_M2, LOS_A_MAX, LOS_B_MAX, LOS_C_MAX, LOS_D_MAX, LOS_E_MAX,
  MEASURED_NOT_ASSUMED, bandForDensity, losGradeForFlow,
} from '@crowdflow/contracts';
import { abTest, buildPack, comparePolicies, egress, parseOsm, refine, renderSvg, runScenario, summariseOsm, VenueGraph } from '@crowdflow/core';
import { planAnchors, positioningAccuracy, type AnchorPlanOptions } from '@crowdflow/core/positioning';
import type { AnchorPack } from '@crowdflow/contracts';
import { rehearseLivePhones } from './rehearse.js';
import { importCalendar, type CalendarFile } from './calendar.js';
import { createHfPredictor, downloadHubText, ensureRepo, FEATURE_NAMES, labelStates, renderModelCard, uploadHubFiles, writeDataset } from '@crowdflow/hf';
import { bboxForTrack, fetchOsm, loadTrackGeometry, readPack, readTraceFragments, readTrack, writePack, writeTraceFragments } from './ingest.js';

interface Options { [key: string]: string | boolean }
function parse(argv: string[]): { words: string[]; options: Options } { const words: string[] = []; const options: Options = {}; for (let i = 0; i < argv.length; i += 1) { const value = argv[i]!; if (!value.startsWith('--')) { words.push(value); continue; } const key = value.slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { options[key] = next; i += 1; } else options[key] = true; } return { words, options }; }
function number(options: Options, key: string, fallback: number): number { const value = options[key]; return typeof value === 'string' ? Number(value) : fallback; }
function string(options: Options, key: string): string | undefined { const value = options[key]; return typeof value === 'string' ? value : undefined; }
function root(): string { let current = dirname(fileURLToPath(import.meta.url)); while (current !== dirname(current)) { if (existsSync(join(current, 'circuits', 'index.yaml'))) return current; current = dirname(current); } return resolve('.'); }
function world(circuitId: string) { const pack = readPack(root(), circuitId); return { pack, graph: new VenueGraph(pack) }; }
function scenario(circuitId: string, count: number, seed: number) { const { pack, graph } = world(circuitId); const parks = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'parking'); if (!parks.length) throw new Error('no parking zone in pack'); const exit = parks.sort((a, b) => graph.reachable(b.id).size - graph.reachable(a.id).size)[0]!.id; const component = graph.reachable(exit); const stands = Object.values(pack.zones ?? {}).filter((zone) => zone.kind === 'viewing' && component.has(zone.id)).map((zone) => zone.id); if (!stands.length) throw new Error(`no grandstands connected to ${exit}`); return { pack, graph, stands, exit, scenario: egress(graph, stands, exit, count, seed) }; }

const { words, options } = parse(process.argv.slice(2));
try {
  if (words[0] === 'standards') printStandards();
  else if (words[0] === 'band') { const density = Number(words[1]); if (!Number.isFinite(density)) throw new Error('usage: crowdflow band <density-persons-m2>'); console.log(`${density.toFixed(2)} persons/m2 -> ${bandForDensity(density).toUpperCase()}`); }
  else if (words[0] === 'circuit' && words[1] === 'list') listCircuits();
  else if (words[0] === 'circuit' && words[1] === 'show') showCircuit(words[2] ?? 'silverstone');
  else if (words[0] === 'circuit' && words[1] === 'import') await importCircuit(words[2] ?? 'silverstone', options);
  else if (words[0] === 'circuit' && words[1] === 'validate') validateCircuit(words[2] ?? 'silverstone');
  else if (words[0] === 'circuit' && words[1] === 'render') renderCircuit(words[2] ?? 'silverstone', string(options, 'out'));
  else if (words[0] === 'sim' && words[1] === 'run') simRun(words[2] ?? 'silverstone', options);
  else if (words[0] === 'sim' && words[1] === 'traces') simTraces(words[2] ?? 'silverstone', options);
  else if (words[0] === 'sim' && words[1] === 'ab') simAb(words[2] ?? 'silverstone', options);
  else if (words[0] === 'mesh' && words[1] === 'compare') meshCompare(options);
  else if (words[0] === 'refine' && words[1] === 'run') refineRun(words[2] ?? 'silverstone', options);
  else if (words[0] === 'anchors' && words[1] === 'show') anchorsShow(words[2] ?? 'silverstone');
  else if (words[0] === 'anchors' && words[1] === 'plan') anchorsPlan(words[2] ?? 'silverstone', options);
  else if (words[0] === 'anchors' && words[1] === 'accuracy') anchorsAccuracy(words[2] ?? 'silverstone', options);
  else if (words[0] === 'live' && words[1] === 'rehearse') await liveRehearse(words[2] ?? 'silverstone', options);
  else if (words[0] === 'calendar' && words[1] === 'import') await calendarImport(options);
  else if (words[0] === 'calendar' && words[1] === 'show') calendarShow(options);
  else if (words[0] === 'hf' && words[1] === 'predict') await hfPredict(words[2] ?? 'silverstone', options);
  else if (words[0] === 'hf' && words[1] === 'export-dataset') await hfExportDataset(words[2] ?? 'silverstone', options);
  else if (words[0] === 'hf' && words[1] === 'upload') await hfUpload(options);
  else if (words[0] === 'hf' && words[1] === 'download') await hfDownload(options);
  else if (words[0] === 'hf' && words[1] === 'features') hfFeatures();
  else help();
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }

function printStandards(): void {
  console.log('Fruin walkway Level of Service — ped/m/min'); for (const [grade, max] of [['A', LOS_A_MAX], ['B', LOS_B_MAX], ['C', LOS_C_MAX], ['D', LOS_D_MAX], ['E', LOS_E_MAX]] as const) console.log(`  ${grade} < ${max}`); console.log(`  F >= ${LOS_E_MAX}`);
  console.log(`\nOperational density bands (authoritative)\n  NOMINAL  < ${DENSITY_NOMINAL_MAX.toFixed(3)} persons/m2\n  BUILDING < ${DENSITY_BUILDING_MAX.toFixed(3)} persons/m2\n  CRITICAL >= ${CAPACITY_DENSITY.toFixed(3)} persons/m2`);
  console.log(`\nfree speed ${FREE_FLOW_SPEED_MS} m/s; jam density ${JAM_DENSITY_PERSONS_M2} persons/m2`); console.log(`\nMeasured, never assumed:\n${MEASURED_NOT_ASSUMED.map((value) => `  ${value}`).join('\n')}`); console.log(`\nFlow grade example at ${LOS_C_MAX}: ${losGradeForFlow(LOS_C_MAX)}`);
}
function listCircuits(): void { for (const id of available()) { const pack = readPack(root(), id); console.log(`${id.padEnd(18)} ${pack.name.padEnd(35)} ${pack.track_length_m.toFixed(0)} m`); } }
function showCircuit(id: string): void { const pack = readPack(root(), id); console.log(`${pack.name}\n  geometry ${pack.geometry_source}\n  track ${pack.track_length_m} m; altitude ${pack.altitude_m} m\n  zones ${Object.keys(pack.zones ?? {}).length}; edges ${Object.keys(pack.edges ?? {}).length}; crossings ${Object.keys(pack.crossings ?? {}).length}\n  origin ${pack.frame.origin_lat}, ${pack.frame.origin_lon}`); }
function available(): string[] { const index = readFileSync(join(root(), 'circuits', 'index.yaml'), 'utf8'); return [...index.matchAll(/^\s+- id:\s*([^\s#]+)/gm)].map((match) => match[1]!).filter((id) => existsSync(join(root(), 'circuits', id, 'pack', 'circuit.json'))); }
async function importCircuit(id: string, opts: Options): Promise<void> { const index = parseYaml(readFileSync(join(root(), 'circuits', 'index.yaml'), 'utf8')) as { circuits: Array<Record<string, any>> }; const entry = index.circuits.find((value) => value.id === id); if (!entry) throw new Error(`unknown circuit ${id}`); const geometry = await loadTrackGeometry(root(), String(entry.geometry_source)); const bbox = bboxForTrack(geometry.coordinates); const osm = await fetchOsm(root(), id, bbox, opts.refresh === true); const parsed = parseOsm(osm.payload.elements ?? []); const result = buildPack({ circuit_id: id, name: String(entry.name), geometry_source: String(entry.geometry_source), track_length_m: Number(entry.track_length_m), altitude_m: Number(entry.altitude_m), track_latlon: geometry.coordinates, ways: parsed.ways, nodes: parsed.nodes, venue_buffer_m: number(opts, 'buffer-m', 900) }); writePack(root(), result.pack, result.track); console.log(`imported ${entry.name}: ${JSON.stringify(summariseOsm(parsed.ways, parsed.nodes))}`); console.log(`  ${result.stats.edges_out} edges, ${result.stats.zones_out} zones, ${result.stats.barrier_removed} barrier crossings removed, ${result.stats.assumed_widths} assumed widths (${osm.cached ? 'cached' : 'fetched'} OSM)`); }
function validateCircuit(id: string): void { const { pack, graph } = world(id); const problems: string[] = []; for (const edge of Object.values(pack.edges ?? {})) { if (!pack.zones?.[edge.source]) problems.push(`edge ${edge.id}: unknown source`); if (!pack.zones?.[edge.destination]) problems.push(`edge ${edge.id}: unknown destination`); } for (const crossing of Object.values(pack.crossings ?? {})) if (!pack.edges?.[crossing.edge_id]) problems.push(`crossing ${crossing.id}: unknown edge`); for (const exit of pack.constraints?.emergency_exits ?? []) if (!graph.reachable(exit).size) problems.push(`emergency exit ${exit}: unreachable`); console.log(`${pack.name}: ${Object.keys(pack.zones ?? {}).length} zones, ${Object.keys(pack.edges ?? {}).length} edges`); if (problems.length) throw new Error(problems.join('\n')); console.log('integrity OK'); }
function renderCircuit(id: string, out?: string): void { const pack = readPack(root(), id); const svg = renderSvg(pack, readTrack(root(), id)); const target = out ?? join(root(), 'circuits', id, `${id}.svg`); writeFileSync(target, svg); console.log(`wrote ${target}`); }
function simRun(id: string, opts: Options): void { const count = number(opts, 'count', 6000); const ticks = number(opts, 'ticks', 400); const participation = number(opts, 'participation', 0.18); const value = scenario(id, count, number(opts, 'seed', 42)); const [metrics] = runScenario(value.scenario, value.graph, opts.intervene === true, participation, ticks); console.log(`${value.pack.name} — ${value.scenario.name}`); for (const [label, metric] of metrics.rows()) console.log(`  ${String(metric).padStart(10)}  ${label}`); }
function simTraces(id: string, opts: Options): void { const out = string(opts, 'out'); if (!out) throw new Error('--out is required'); const count = number(opts, 'count', 6000); const ticks = number(opts, 'ticks', 400); const every = number(opts, 'every', 60); const value = scenario(id, count, number(opts, 'seed', 42)); const sim = value.scenario.build(value.graph, { participation: number(opts, 'participation', 0.18) }); const fragments = []; for (let tick = 0; tick < ticks; tick += 1) { sim.step(); sim.emit(); if ((tick + 1) % every === 0) fragments.push(...sim.emitTraceFragments()); } fragments.push(...sim.emitTraceFragments()); writeTraceFragments(out, fragments); console.log(`${fragments.length} private fragments -> ${out}`); }
function simAb(id: string, opts: Options): void { const count = number(opts, 'count', 6000); const participation = number(opts, 'participation', 0.18); const seed = number(opts, 'seed', 42); const value = scenario(id, count, seed); console.log(`A/B — ${value.pack.name}, ${value.scenario.name}\n  ${count} spectators, seed ${seed}, participation ${(participation * 100).toFixed(0)}%\n  identical seed both arms; only the intervention differs\n`); const result = abTest(value.scenario, value.graph, participation, number(opts, 'ticks', 400)); console.log(`  ${'metric'.padEnd(34)}${'without'.padStart(12)}${'with'.padStart(12)}${'change'.padStart(10)}`); for (const [label, before, after, change] of result.summary()) console.log(`  ${label.padEnd(34)}${before.toFixed(1).padStart(12)}${after.toFixed(1).padStart(12)}${(`${change >= 0 ? '+' : ''}${change.toFixed(1)}%`).padStart(10)}`); console.log(`\n  GATE ${result.passesGate ? 'PASSED' : 'FAILED'}`); if (!result.passesGate) process.exitCode = 1; }
function meshCompare(opts: Options): void { const ticks = number(opts, 'ticks', 200); const nodes = number(opts, 'nodes', 150); const span = number(opts, 'span', 400); const connectivity = number(opts, 'connectivity', 0.05); const seed = number(opts, 'seed', 7); const metrics = comparePolicies({ seed, node_count: nodes, span_m: span, data_plan_fraction: connectivity }, ticks); console.log(`Mesh routing — ${nodes} devices, seed ${seed}, ${ticks} ticks`); console.log(`  ${'class'.padEnd(8)}${'policy'.padEnd(24)}${'delivery'.padStart(10)}${'hops'.padStart(8)}${'copies/msg'.padStart(13)}${'lag s'.padStart(9)}`); for (const [kind, policy, delivery, hops, copies, lag] of metrics.rows()) console.log(`  ${kind.padEnd(8)}${policy.padEnd(24)}${delivery.toFixed(3).padStart(10)}${hops.toFixed(2).padStart(8)}${copies.toFixed(1).padStart(13)}${lag.toFixed(1).padStart(9)}`); console.log(`  mean coverage ${(metrics.mean_coverage * 100).toFixed(1)}%; elected uplinks ${metrics.mean_uplinks.toFixed(1)} of ${metrics.mean_online_nodes.toFixed(1)} online phones`); }
function refineRun(id: string, opts: Options): void { const path = string(opts, 'traces'); if (!path) throw new Error('--traces is required'); const participation = number(opts, 'participation', NaN); if (!(participation > 0 && participation <= 1)) throw new Error('--participation must be in (0, 1]'); const pack = readPack(root(), id); const report = refine(pack, readTraceFragments(path), participation); for (const line of report.summary()) console.log(`  ${line}`); if (opts.apply !== true && opts['adopt-desire-lines'] !== true) { console.log('  dry run — pack unchanged (pass --apply after review)'); return; } const adopt = opts['adopt-desire-lines'] === true; writePack(root(), report.apply(pack, adopt), readTrack(root(), id)); console.log(`  wrote ${Object.keys(report.refined_edges).length} measured edge updates${adopt ? ` and ${Object.keys(report.proposed_edges).length} reviewed desire lines` : ''}`); }
async function hfPredict(id: string, opts: Options): Promise<void> { const model = string(opts, 'model') ?? process.env.CROWDFLOW_HF_MODEL; if (!model) throw new Error('hf predict needs --model or CROWDFLOW_HF_MODEL'); const value = scenario(id, number(opts, 'count', 2000), number(opts, 'seed', 42)); const [, results] = runScenario(value.scenario, value.graph, false, number(opts, 'participation', 0.18), number(opts, 'ticks', 400)); const state = results.at(-1)!.state; const predictor = createHfPredictor({ model, token: string(opts, 'token'), endpointUrl: string(opts, 'endpoint'), horizonS: number(opts, 'horizon', 300) }); const forecasts = await predictor.forecast(state); console.log(`hf predict — ${value.pack.name}, ${model} (${Object.keys(state.zones ?? {}).length} observed zones)`); for (const forecast of forecasts.slice(0, 15)) console.log(`  ${forecast.zone_id.padEnd(16)} ${forecast.target_band.padEnd(9)} ${forecast.time_to_threshold_s == null ? 'no crossing'.padEnd(12) : `${forecast.time_to_threshold_s.toFixed(0)}s`.padStart(12)}  p ${(forecast.probability * 100).toFixed(0).padStart(3)}%`); }
async function hfExportDataset(id: string, opts: Options): Promise<void> { const out = string(opts, 'out'); if (!out) throw new Error('--out is required'); const seed = number(opts, 'seed', 42); const value = scenario(id, number(opts, 'count', 2000), seed); const [, results] = runScenario(value.scenario, value.graph, true, number(opts, 'participation', 0.18), number(opts, 'ticks', 400)); const rows = labelStates(results.map((result) => result.state), { scenario: value.scenario.name, seed, horizonS: number(opts, 'horizon', 180) }); writeDataset(out, rows); console.log(`${rows.length} labelled rows -> ${out}`); }
async function hfUpload(opts: Options): Promise<void> { const repo = string(opts, 'repo'); if (!repo) throw new Error('--repo is required'); const file = string(opts, 'file'); if (!file) throw new Error('--file is required'); const type = (string(opts, 'type') ?? 'dataset') === 'dataset' ? 'dataset' as const : 'model' as const; const accessToken = string(opts, 'token') ?? process.env.HF_TOKEN; if (!accessToken) throw new Error('--token or HF_TOKEN is required'); await ensureRepo(repo, type, { accessToken, visibility: 'public' }); const content = readFileSync(resolve(file), 'utf8'); await uploadHubFiles(repo, [{ path: basename(file), content }, { path: 'README.md', content: renderModelCard({ model_id: repo, task: type === 'dataset' ? 'crowdflow-congestion-dataset' : 'crowdflow-time-to-congestion', features: [...FEATURE_NAMES], outputs: ['time_to_threshold_s'] }) }], { accessToken, repoType: type }); console.log(`uploaded ${basename(file)} + README.md -> ${type}/${repo}`); }
async function hfDownload(opts: Options): Promise<void> { const repo = string(opts, 'repo'); if (!repo) throw new Error('--repo is required'); const path = string(opts, 'path'); if (!path) throw new Error('--path is required'); const out = string(opts, 'out'); if (!out) throw new Error('--out is required'); const type = (string(opts, 'type') ?? 'model') === 'dataset' ? 'dataset' as const : 'model' as const; const text = await downloadHubText(repo, path, { accessToken: string(opts, 'token'), repoType: type }); if (text == null) throw new Error(`${repo}/${path} not found`); writeFileSync(resolve(out), text); console.log(`wrote ${resolve(out)} (${text.length} bytes)`); }
function anchorsPath(id: string): string { return join(root(), 'circuits', id, 'pack', 'anchors.json'); }
function readAnchors(id: string): AnchorPack { const path = anchorsPath(id); if (!existsSync(path)) return { circuit_id: id, surveyed_at: null, anchors: {} }; return JSON.parse(readFileSync(path, 'utf8')) as AnchorPack; }

function anchorsShow(id: string): void {
  const anchorPack = readAnchors(id); const anchors = Object.values(anchorPack.anchors ?? {});
  if (!anchors.length) { console.log(`${id}: no anchor map. Radio positioning is unavailable here; handsets fall through to GNSS.`); return; }
  const measured = anchors.filter((anchor) => anchor.rssi_at_1m_dbm.provenance === 'measured' && anchor.path_loss_exponent.provenance === 'measured').length;
  console.log(`${id} — ${anchors.length} anchors (${anchors.filter((a) => a.kind === 'wifi_ap').length} Wi-Fi, ${anchors.filter((a) => a.kind === 'ble_beacon').length} BLE)`);
  // Surveyed-or-not is the headline, not a footnote: an unsurveyed plan produces
  // fixes, they are just fixes against positions nobody has confirmed.
  console.log(`  surveyed  ${anchorPack.surveyed_at ?? 'NEVER — this is a deployment plan, not a survey'}`);
  console.log(`  calibrated curves  ${measured} of ${anchors.length}${measured === anchors.length ? '' : ' — the rest are assumed and the solver charges them extra uncertainty'}`);
}

function anchorsPlan(id: string, opts: Options): void {
  const pack = readPack(root(), id);
  const environment = string(opts, 'environment') as AnchorPlanOptions['environment'];
  const plan = planAnchors(pack, { spacing_m: number(opts, 'spacing', 60), ...(environment ? { environment } : {}) });
  const count = Object.keys(plan.anchors ?? {}).length;
  console.log(`${pack.name} — ${count} planned anchor positions at ${number(opts, 'spacing', 60)} m spacing`);
  console.log('  every anchor is provenance=assumed: this is where hardware would go, not where hardware is');
  if (opts.write !== true) { console.log(`  dry run — nothing written (pass --write to create ${anchorsPath(id).replace(root() + '/', '')})`); return; }
  writeFileSync(anchorsPath(id), `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`  wrote ${anchorsPath(id)}`);
}

function anchorsAccuracy(id: string, opts: Options): void {
  const pack = readPack(root(), id); const anchorPack = readAnchors(id);
  if (!Object.keys(anchorPack.anchors ?? {}).length) throw new Error(`no anchor map for ${id} — run: crowdflow anchors plan ${id} --write`);
  const kinds = string(opts, 'kinds')?.split(',') as ('wifi_ap' | 'ble_beacon')[] | undefined;
  const report = positioningAccuracy(pack, anchorPack, { samples: number(opts, 'samples', 500), seed: number(opts, 'seed', 42), sigma_db: number(opts, 'sigma', 6), ...(kinds ? { kinds } : {}) });
  console.log(`${pack.name} — radio positioning, ${kinds ? kinds.join('+') : 'all radios'}`);
  console.log(`  ${report.anchors} anchors (${report.wifi_anchors} Wi-Fi, ${report.ble_anchors} BLE); ${report.sigma_db} dB shadowing, seed ${report.seed}`);
  console.log(`  heard enough to solve   ${report.solved} of ${report.samples} (${(100 * report.solved / report.samples).toFixed(1)}%)`);
  console.log(`  fix accepted by ladder  ${report.usable} of ${report.samples} (${(100 * report.usable / report.samples).toFixed(1)}%)`);
  console.log(`  true error              p50 ${report.p50_error_m} m; p95 ${report.p95_error_m} m`);
  console.log(`  claimed accuracy        p50 ${report.p50_claimed_m} m`);
  console.log(`  error inside 3 sigma    ${(100 * report.within_3_sigma).toFixed(1)}%`);
  console.log(`  anchors heard per scan  ${report.mean_anchors_heard.toFixed(1)}`);
  // A layout that cannot be trusted about its own error is worse than one that
  // is merely imprecise, because everything downstream weights on accuracy_m.
  if (report.within_3_sigma < 0.9) console.log('\n  WARNING: the accuracy estimate does not bound the true error. Do not trust these fixes.');
}

async function liveRehearse(id: string, opts: Options): Promise<void> {
  const api = string(opts, 'api') ?? 'http://127.0.0.1:8099';
  const radios = (string(opts, 'radios') ?? 'wifi,ble,gnss').split(',') as ('wifi' | 'ble' | 'gnss')[];
  const phones = number(opts, 'phones', 25);
  const ticks = number(opts, 'ticks', 10);
  console.log(`rehearsing ${phones} handsets on ${id} against ${api} — radios ${radios.join('+')}`);
  console.log('  every layer below the radio is the shipping code: anchor resolution, solve, ladder, pseudonym, ingest\n');
  const run = await rehearseLivePhones({
    api, circuitId: id, phones, ticks,
    intervalS: number(opts, 'interval', 2), seed: number(opts, 'seed', 42),
    sigmaDb: number(opts, 'sigma', 6), gnssSigmaM: number(opts, 'gnss-sigma', 9), radios,
    onTick: (tick, state) => console.log(`  tick ${String(tick).padStart(3)}  accepted ${String(state.accepted).padStart(5)}  rejected ${String(state.rejected).padStart(4)}  no fix ${state.no_fix}`),
  });
  console.log(`\n  handsets                ${run.phones}`);
  console.log(`  Wi-Fi solves            ${run.wifi_solves}`);
  console.log(`  BLE solves              ${run.ble_solves}`);
  console.log(`  ticks with no fix       ${run.no_fix}`);
  console.log(`  rung the ladder chose   ${Object.entries(run.by_source).map(([source, count]) => `${source}=${count}`).join(' ') || 'none'}`);
  console.log(`  server accepted         ${run.accepted}`);
  console.log(`  server rejected         ${run.rejected}`);
  // The one number a real walk test cannot produce: the simulator knows where
  // each handset was, so this is the true accuracy of the dots on the console.
  console.log(`  true position error     p50 ${run.p50_error_m} m; p95 ${run.p95_error_m} m`);
  if (run.problems.length) console.log(`  problems                ${run.problems.join('; ')}`);
  if (run.rejected > run.accepted) { console.log('\n  WARNING: more samples were rejected than accepted.'); process.exitCode = 1; }
}

function calendarPath(season: number): string { return join(root(), 'circuits', `calendar.${season}.json`); }

async function calendarImport(opts: Options): Promise<void> {
  const season = number(opts, 'season', 2026);
  console.log(`importing the ${season} calendar`);
  console.log('  races and rounds  api.jolpi.ca (the Ergast replacement; ergast.com itself now 404s)');
  console.log(`  session times     ${opts['jolpica-only'] === true ? 'skipped — every end time will be assumed' : 'api.openf1.org, joined by race date'}\n`);
  const calendar = await importCalendar({ season, jolpicaOnly: opts['jolpica-only'] === true });
  const published = calendar.events.length - calendar.rounds_without_published_ends.length;
  console.log(`  ${calendar.events.length} rounds; ${published} with published session end times`);
  if (calendar.rounds_without_published_ends.length) {
    // The chequered flag is the largest crowd-movement trigger of the day, so a
    // guessed race end is worth naming rather than counting.
    console.log(`  rounds on assumed durations: ${calendar.rounds_without_published_ends.join(', ')}`);
  }
  const withMaps = calendar.events.filter((event) => existsSync(join(root(), 'circuits', event.circuit_id, 'pack', 'circuit.json')));
  console.log(`  ${withMaps.length} of ${calendar.events.length} have a committed circuit pack, so only those can be guided`);
  // Upstream data quality, reported rather than corrected. A calendar importer
  // that quietly patches its sources is an importer nobody can audit — and the
  // next run would silently undo the patch anyway.
  const thin = calendar.events.filter((event) => (event.sessions?.length ?? 0) < 3);
  if (thin.length) console.log(`  thin session data upstream: ${thin.map((event) => `R${event.round} (${event.sessions?.length ?? 0})`).join(', ')}`);
  if (opts.write !== true) { console.log(`\n  dry run — nothing written (pass --write to create circuits/calendar.${season}.json)`); return; }
  writeFileSync(calendarPath(season), `${JSON.stringify(calendar, null, 2)}\n`);
  console.log(`\n  wrote ${calendarPath(season)}`);
}

function calendarShow(opts: Options): void {
  const season = number(opts, 'season', 2026);
  const path = calendarPath(season);
  if (!existsSync(path)) throw new Error(`no calendar for ${season} — run: crowdflow calendar import --season ${season} --write`);
  const calendar = JSON.parse(readFileSync(path, 'utf8')) as CalendarFile;
  console.log(`${calendar.season} season — ${calendar.events.length} rounds, generated ${calendar.generated_at.slice(0, 10)}`);
  for (const event of calendar.events) {
    const hasMap = existsSync(join(root(), 'circuits', event.circuit_id, 'pack', 'circuit.json'));
    const race = event.sessions?.find((session) => session.kind === 'race');
    const assumed = race?.end_provenance !== 'measured';
    console.log(`  R${String(event.round).padStart(2)}  ${event.date}  ${(event.name ?? '').padEnd(30)} ${(event.locality ?? '').padEnd(16)} ${String(event.sessions?.length ?? 0).padStart(2)} sessions${assumed ? ' (assumed ends)' : ''}${hasMap ? '  [MAP]' : ''}`);
  }
}

function hfFeatures(): void { console.log(`CrowdFlow tabular feature contract (${FEATURE_NAMES.length})\n  ${FEATURE_NAMES.join('\n  ')}`); }
function help(): void { console.log(`CrowdFlow TypeScript CLI\n\n  crowdflow standards\n  crowdflow band <density-persons-m2>\n  crowdflow circuit list|show|import|validate|render [id]\n  crowdflow sim run|traces|ab [id] [--count N --ticks N --seed N]\n  crowdflow mesh compare [--nodes N --ticks N --seed N]\n  crowdflow refine run [id] --traces file.jsonl --participation 0.18 [--apply]
  crowdflow anchors show|plan|accuracy [id] [--spacing M --write --samples N --sigma dB --kinds wifi_ap,ble_beacon]
  crowdflow live rehearse [id] [--api URL --phones N --ticks N --interval S --radios wifi,ble,gnss]
  crowdflow calendar import|show [--season 2026 --write --jolpica-only]\n  crowdflow hf predict|export-dataset|upload|download|features`); }
