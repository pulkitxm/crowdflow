import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateCircuitPack, validateTraceFragment, type CircuitPack, type Position, type TraceFragment } from '@crowdflow/contracts';
import { round } from '@crowdflow/core/statistics';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const OSM_QUERY = `[out:json][timeout:180];(way["highway"~"^(footway|path|pedestrian|steps|service|track|cycleway|living_street|residential|unclassified)$"]({bbox});way["barrier"]({bbox});way["building"="grandstand"]({bbox});way["amenity"="parking"]({bbox});node["barrier"~"^(gate|entrance|stile|cycle_barrier|kissing_gate)$"]({bbox});node["highway"="crossing"]({bbox}););out geom;`;
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

export function bboxForTrack(coords: Array<[number, number]>, paddingDegrees = 0.012): [number, number, number, number] { const latitudes = coords.map(([lat]) => lat); const longitudes = coords.map(([, lon]) => lon); return [round(Math.min(...latitudes) - paddingDegrees, 6), round(Math.min(...longitudes) - paddingDegrees, 6), round(Math.max(...latitudes) + paddingDegrees, 6), round(Math.max(...longitudes) + paddingDegrees, 6)]; }
export async function fetchOsm(root: string, circuitId: string, bbox: [number, number, number, number], refresh = false): Promise<{ payload: any; cached: boolean }> { const directory = join(root, 'circuits', circuitId, 'raw'); const path = join(directory, 'osm.json'); if (!refresh && exists(path)) return { payload: JSON.parse(readFileSync(path, 'utf8')), cached: true }; const body = OSM_QUERY.replaceAll('{bbox}', bbox.join(',')); try { const response = await fetch(OVERPASS_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'crowdflow/0.2 venue import' }, body: new URLSearchParams({ data: body }) }); if (!response.ok) throw new Error(`Overpass ${response.status}`); const payload = await response.json(); mkdirSync(directory, { recursive: true }); writeFileSync(path, JSON.stringify(payload)); return { payload, cached: false }; } catch (error) { if (exists(path)) return { payload: JSON.parse(readFileSync(path, 'utf8')), cached: true }; throw error; } }
export async function loadTrackGeometry(root: string, source: string): Promise<{ coordinates: Array<[number, number]>; properties: Record<string, unknown> }> { const directory = join(root, 'circuits', '_geometry'); const path = join(directory, `${source}.geojson`); if (!exists(path)) { const response = await fetch(`https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits/${source}.geojson`); if (!response.ok) throw new Error(`track geometry ${response.status}`); mkdirSync(directory, { recursive: true }); writeFileSync(path, Buffer.from(await response.arrayBuffer())); } const data = JSON.parse(readFileSync(path, 'utf8')); const feature = data.features[0]; return { coordinates: feature.geometry.coordinates.map(([lon, lat]: [number, number]) => [lat, lon]), properties: feature.properties ?? {} }; }
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
function exists(path: string): boolean { try { readFileSync(path); return true; } catch { return false; } }
