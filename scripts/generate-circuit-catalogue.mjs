import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svgPathProperties } from 'svg-path-properties';

export const SOURCE_COMMIT = '9c93759b076d1b87eac265a009b21b399253220a';
export const SOURCE_REPOSITORY = 'https://github.com/julesr0y/f1-circuits-svg';
export const SOURCE_LICENSE = 'CC-BY-4.0';
export const SOURCE_ATTRIBUTION = 'ROY Jules (julesr0y)';
export const EXPECTED_CATALOGUE_SHA256 = 'adb4bd7e9227af7e450166f4640036c8b5a3c7f83a18880482b605726f38e6a7';
export const EXPECTED_LICENSE_SHA256 = 'd3f2bda6cdcbf904aa7f3e6bfc09c41aa19986ab721d05433081d968f426bdf4';
export const EXPECTED_VENUES = 78;
export const TRACK_SPAN_M = 1200;
export const TRACK_CLEARANCE_M = 25;
export const PEDESTRIAN_MARGIN_M = 100;
export const PARKING_OFFSET_M = 60;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogueRoot = join(repositoryRoot, 'circuits', 'catalogue');
const sourceRoot = join(catalogueRoot, 'source');
const cataloguePath = join(sourceRoot, 'circuits.json');
const layoutsPath = join(sourceRoot, 'layouts.json');
const aliasesPath = join(catalogueRoot, 'aliases.json');
const manifestPath = join(catalogueRoot, 'catalogue.json');
const rawBase = `https://raw.githubusercontent.com/julesr0y/f1-circuits-svg/${SOURCE_COMMIT}`;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function compactSvg(value) {
  return `${value.replace(/>\s+</g, '><').trim()}\n`;
}

function latestYear(seasons) {
  const years = String(seasons).match(/\d{4}/g)?.map(Number) ?? [];
  if (!years.length) throw new Error(`layout seasons contain no year: ${seasons}`);
  return Math.max(...years);
}

function selectedLayout(circuit) {
  return circuit.layouts.map((layout) => ({ ...layout, latest_year: latestYear(layout.seasons) })).sort((left, right) => right.latest_year - left.latest_year || left.layoutId.localeCompare(right.layoutId))[0];
}

function localId(sourceId, aliases) {
  return aliases.source_to_local[sourceId] ?? sourceId;
}

function svgPathData(svg) {
  const paths = [...svg.matchAll(/<path\b[^>]*\bd=(["'])(.*?)\1/gs)].map((match) => match[2]);
  if (!paths.length) throw new Error('SVG contains no path data');
  return paths.map((path) => ({ path, length: new svgPathProperties(path).getTotalLength() })).sort((left, right) => right.length - left.length)[0].path;
}

function round(value) {
  return Number(value.toFixed(3));
}

function samePoint(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y) < 0.001;
}

function sampleTrack(svg) {
  const properties = new svgPathProperties(svgPathData(svg));
  const rawLength = properties.getTotalLength();
  if (!(rawLength > 0) || !Number.isFinite(rawLength)) throw new Error('SVG path length is invalid');
  const samples = Math.max(96, Math.min(512, Math.ceil(rawLength / 2)));
  const raw = Array.from({ length: samples }, (_, index) => properties.getPointAtLength((rawLength * index) / samples));
  const xs = raw.map((point) => point.x);
  const ys = raw.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = TRACK_SPAN_M / Math.max(maxX - minX, maxY - minY);
  const points = raw.map((point) => ({ x: round((point.x - minX) * scale), y: round((maxY - point.y) * scale) }));
  const deduplicated = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  if (!samePoint(deduplicated[0], deduplicated.at(-1))) deduplicated.push({ ...deduplicated[0] });
  return deduplicated;
}

function polylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    total += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return round(total);
}

function sourced(value, note) {
  return { value, provenance: 'assumed', note };
}

function syntheticGraph(track) {
  const xs = track.map((point) => point.x);
  const ys = track.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const margin = TRACK_CLEARANCE_M + PEDESTRIAN_MARGIN_M;
  const left = minX - margin;
  const right = maxX + margin;
  const top = minY - margin;
  const bottom = maxY + margin;
  const horizontal = (right - left) / 4;
  const vertical = (bottom - top) / 4;
  const perimeter = [
    ['gate_nw', 'gate', left, top, 'Synthetic north-west gate'],
    ['view_nw', 'viewing', left + horizontal, top, 'Synthetic north-west viewing area'],
    ['view_n', 'viewing', left + horizontal * 2, top, 'Synthetic north viewing area'],
    ['view_ne', 'viewing', left + horizontal * 3, top, 'Synthetic north-east viewing area'],
    ['gate_ne', 'gate', right, top, 'Synthetic north-east gate'],
    ['view_en', 'viewing', right, top + vertical, 'Synthetic east-north viewing area'],
    ['view_e', 'viewing', right, top + vertical * 2, 'Synthetic east viewing area'],
    ['view_es', 'viewing', right, top + vertical * 3, 'Synthetic east-south viewing area'],
    ['gate_se', 'gate', right, bottom, 'Synthetic south-east gate'],
    ['view_se', 'viewing', left + horizontal * 3, bottom, 'Synthetic south-east viewing area'],
    ['view_s', 'viewing', left + horizontal * 2, bottom, 'Synthetic south viewing area'],
    ['view_sw', 'viewing', left + horizontal, bottom, 'Synthetic south-west viewing area'],
    ['gate_sw', 'gate', left, bottom, 'Synthetic south-west gate'],
    ['view_ws', 'viewing', left, top + vertical * 3, 'Synthetic west-south viewing area'],
    ['view_w', 'viewing', left, top + vertical * 2, 'Synthetic west viewing area'],
    ['view_wn', 'viewing', left, top + vertical, 'Synthetic west-north viewing area'],
  ];
  const parking = [
    ['park_nw', left - PARKING_OFFSET_M, top - PARKING_OFFSET_M, 'Synthetic north-west parking'],
    ['park_ne', right + PARKING_OFFSET_M, top - PARKING_OFFSET_M, 'Synthetic north-east parking'],
    ['park_se', right + PARKING_OFFSET_M, bottom + PARKING_OFFSET_M, 'Synthetic south-east parking'],
    ['park_sw', left - PARKING_OFFSET_M, bottom + PARKING_OFFSET_M, 'Synthetic south-west parking'],
  ];
  const zones = {};
  for (const [id, kind, x, y, name] of perimeter) zones[id] = { id, kind, name, position: { x: round(x), y: round(y) } };
  for (const [id, x, y, name] of parking) zones[id] = { id, kind: 'parking', name, position: { x: round(x), y: round(y) } };
  const edges = {};
  const addEdge = (id, source, destination) => {
    const geometry = [zones[source].position, zones[destination].position];
    edges[id] = {
      id,
      source,
      destination,
      length_m: polylineLength(geometry),
      width_m: sourced(6, 'Synthetic simulator corridor, not a measured venue width'),
      bidirectional: true,
      geometry,
    };
  };
  for (let index = 0; index < perimeter.length; index += 1) {
    addEdge(`perimeter_${index + 1}`, perimeter[index][0], perimeter[(index + 1) % perimeter.length][0]);
  }
  addEdge('parking_nw', 'park_nw', 'gate_nw');
  addEdge('parking_ne', 'park_ne', 'gate_ne');
  addEdge('parking_se', 'park_se', 'gate_se');
  addEdge('parking_sw', 'park_sw', 'gate_sw');
  return {
    zones,
    edges,
    trackBounds: [round(maxX - minX), round(maxY - minY)],
    venueBounds: [round(left - PARKING_OFFSET_M - 20), round(top - PARKING_OFFSET_M - 20), round(right + PARKING_OFFSET_M + 20), round(bottom + PARKING_OFFSET_M + 20)],
    emergencyExits: parking.map(([id]) => id),
  };
}

function packFiles(entry, svg) {
  const track = sampleTrack(svg);
  const graph = syntheticGraph(track);
  const sourcePath = `circuits/minimal/black/${entry.layout_id}.svg`;
  const metadata = {
    id: entry.id,
    name: entry.name,
    geometry_source: `julesr0y/f1-circuits-svg@${SOURCE_COMMIT}/${sourcePath}`,
    layout_id: entry.layout_id,
    capability: 'synthetic_simulation',
    track_length_m: polylineLength(track),
    altitude_m: 0,
    track_clearance_m: sourced(TRACK_CLEARANCE_M, 'Assumed exclusion around unreferenced visual track artwork'),
    frame: {
      origin_lat: 0,
      origin_lon: 0,
      track_bounds_m: graph.trackBounds,
      venue_bounds_m: graph.venueBounds,
    },
  };
  const directory = join(repositoryRoot, 'circuits', entry.id, 'pack');
  return new Map([
    [join(directory, 'circuit.json'), stableJson(metadata)],
    [join(directory, 'graph.json'), stableJson({ zones: graph.zones, edges: graph.edges })],
    [join(directory, 'crossings.json'), stableJson({})],
    [
      join(directory, 'constraints.json'),
      stableJson({
        never_route_through: [],
        never_route_edges: [],
        emergency_exits: graph.emergencyExits,
        accessible_routes: [],
      }),
    ],
    [join(directory, 'track.json'), stableJson(track.map((point) => [point.x, point.y]))],
  ]);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'crowdflow-circuit-catalogue/1.0' } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function inBatches(values, size, task) {
  for (let offset = 0; offset < values.length; offset += size) {
    await Promise.all(values.slice(offset, offset + size).map(task));
  }
}

export async function refreshSource() {
  const catalogue = await fetchText(`${rawBase}/circuits.json`);
  const license = await fetchText(`${rawBase}/LICENSE`);
  if (sha256(catalogue) !== EXPECTED_CATALOGUE_SHA256) throw new Error('pinned circuits.json checksum mismatch');
  if (sha256(license) !== EXPECTED_LICENSE_SHA256) throw new Error('pinned LICENSE checksum mismatch');
  const circuits = JSON.parse(catalogue);
  if (circuits.length !== EXPECTED_VENUES) throw new Error(`expected ${EXPECTED_VENUES} source venues, found ${circuits.length}`);
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(cataloguePath, stableJson(circuits));
  const layouts = circuits.map(selectedLayout);
  const layoutEntries = [];
  await inBatches(layouts, 8, async (layout) => {
    const sourcePath = `circuits/minimal/black/${layout.layoutId}.svg`;
    const svg = await fetchText(`${rawBase}/${sourcePath}`);
    layoutEntries.push([layout.layoutId, compactSvg(svg)]);
  });
  layoutEntries.sort(([left], [right]) => left.localeCompare(right));
  writeFileSync(layoutsPath, stableJson(Object.fromEntries(layoutEntries)));
  rmSync(join(sourceRoot, 'layouts'), { recursive: true, force: true });
  rmSync(join(sourceRoot, 'LICENSE'), { force: true });
}

export function buildOutputs() {
  if (!existsSync(cataloguePath) || !existsSync(layoutsPath)) throw new Error('source snapshot missing, run with --refresh-source');
  const catalogueBytes = readFileSync(cataloguePath);
  const aliases = JSON.parse(readFileSync(aliasesPath, 'utf8'));
  const layouts = JSON.parse(readFileSync(layoutsPath, 'utf8'));
  const circuits = JSON.parse(catalogueBytes.toString('utf8'));
  if (circuits.length !== EXPECTED_VENUES) throw new Error(`expected ${EXPECTED_VENUES} source venues, found ${circuits.length}`);
  const entries = circuits.map((circuit) => {
    const layout = selectedLayout(circuit);
    const id = localId(circuit.id, aliases);
    const svg = layouts[layout.layoutId];
    if (typeof svg !== 'string') throw new Error(`source SVG missing: ${layout.layoutId}`);
    return {
      id,
      source_id: circuit.id,
      name: circuit.name,
      country_id: circuit.countryId,
      latitude: circuit.latitude,
      longitude: circuit.longitude,
      layout_id: layout.layoutId,
      seasons: layout.seasons,
      latest_season_year: layout.latest_year,
      svg_path: `source/layouts.json#${layout.layoutId}`,
      svg_sha256: sha256(svg),
      capability: 'synthetic_simulation',
      georeferenced: false,
      operational: false,
      svg,
    };
  });
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== EXPECTED_VENUES) throw new Error('alias mapping creates duplicate local IDs');
  const publicEntries = entries.map(({ svg, ...entry }) => entry);
  const manifest = {
    schema_version: 1,
    source: {
      repository: SOURCE_REPOSITORY,
      commit: SOURCE_COMMIT,
      license: SOURCE_LICENSE,
      attribution: SOURCE_ATTRIBUTION,
      catalogue_sha256: EXPECTED_CATALOGUE_SHA256,
      license_sha256: EXPECTED_LICENSE_SHA256,
    },
    selection: 'layout with the highest year parsed from seasons',
    geometry: 'visual SVG artwork normalized to a synthetic local frame; not georeferenced or operational',
    circuits: publicEntries,
  };
  const outputs = new Map([[manifestPath, stableJson(manifest)]]);
  for (const entry of entries) {
    for (const [path, content] of packFiles(entry, entry.svg)) outputs.set(path, content);
  }
  return { outputs, manifest };
}

export function writeOutputs(outputs) {
  for (const [path, content] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

export function checkOutputs(outputs) {
  const problems = [];
  for (const [path, expected] of outputs) {
    const relative = path.replace(`${repositoryRoot}/`, '');
    if (!existsSync(path)) problems.push(`${relative}: missing`);
    else if (readFileSync(path, 'utf8') !== expected) problems.push(`${relative}: differs from deterministic generation`);
  }
  return problems;
}

async function main() {
  const refresh = process.argv.includes('--refresh-source');
  const check = process.argv.includes('--check');
  if (refresh) await refreshSource();
  const { outputs, manifest } = buildOutputs();
  if (check) {
    const problems = checkOutputs(outputs);
    if (problems.length) throw new Error(problems.join('\n'));
    console.log(`${manifest.circuits.length} circuit packs match pinned deterministic generation`);
    return;
  }
  writeOutputs(outputs);
  console.log(`${manifest.circuits.length} synthetic circuit packs generated from ${SOURCE_COMMIT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
