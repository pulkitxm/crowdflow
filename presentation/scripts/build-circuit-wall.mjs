import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "../..");
const outputDir = path.resolve(scriptDir, "../assets/circuits");
const sourceRoot = "https://raw.githubusercontent.com/bacinger/f1-circuits/master";

const index = await readFile(path.join(repositoryRoot, "circuits/index.yaml"), "utf8");
const entries = index
  .split("\n  - id: ")
  .slice(1)
  .map((block) => {
    const lines = `    id: ${block}`;
    const field = (name) => lines.match(new RegExp(`^    ${name}: (.+)$`, "m"))?.[1]?.trim();
    return {
      id: field("id"),
      round: Number(field("round")),
      locality: field("locality"),
      source: field("geometry_source")?.split(/\s+/)[0],
      seed: field("status") === "seed",
    };
  });

if (entries.length !== 23 || entries.some((entry) => !entry.source)) {
  throw new Error(`Expected 23 complete circuit entries, found ${entries.length}`);
}

const geometries = await Promise.all(
  entries.map(async (entry) => {
    const response = await fetch(`${sourceRoot}/circuits/${entry.source}.geojson`);
    if (!response.ok) throw new Error(`${entry.source}: HTTP ${response.status}`);
    const geojson = await response.json();
    const coordinates = geojson.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coordinates)) throw new Error(`${entry.source}: missing LineString coordinates`);
    return { ...entry, coordinates };
  }),
);

const pathFor = (coordinates, width, height, padding = 8) => {
  const meanLatitude = coordinates.reduce((sum, [, latitude]) => sum + latitude, 0) / coordinates.length;
  const longitudeScale = Math.cos((meanLatitude * Math.PI) / 180);
  const points = coordinates.map(([longitude, latitude]) => [longitude * longitudeScale, -latitude]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  return points
    .map(([x, y], pointIndex) => {
      const px = offsetX + (x - minX) * scale;
      const py = offsetY + (y - minY) * scale;
      return `${pointIndex === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`;
    })
    .join(" ");
};

const escapeXml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const cellWidth = 292;
const cellHeight = 116;
const columns = 5;
const wallWidth = cellWidth * columns;
const wallHeight = cellHeight * 5;
const cells = geometries
  .map((entry, entryIndex) => {
    const x = entryIndex >= 20 ? (entryIndex - 19) * cellWidth : (entryIndex % columns) * cellWidth;
    const y = Math.floor(entryIndex / columns) * cellHeight;
    const seedClass = entry.seed ? " seed" : "";
    const toneClass = ` tone-${entryIndex % 3}`;
    const seedDot = entry.seed ? '\n    <circle class="seed-dot" cx="267" cy="94" r="5"/>' : "";
    return `
  <g class="circuit${seedClass}${toneClass}" transform="translate(${x} ${y})">
    <path class="cell" d="M3 3H263L289 29V113H3Z"/>
    <path class="speed" d="M260 12h14m-20 7h20m-26 7h26"/>
    <text class="round" x="18" y="29">${String(entry.round).padStart(2, "0")}</text>
    <path class="track" d="${pathFor(entry.coordinates, 200, 82, 6)}" transform="translate(73 4)"/>
    <rect class="name-bar" x="18" y="82" width="5" height="20"/>
    <text class="name" x="32" y="97">${escapeXml(entry.locality.toUpperCase())}</text>${seedDot}
  </g>`;
  })
  .join("");

const wallSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wallWidth} ${wallHeight}" role="img" aria-labelledby="title desc">
  <title id="title">2026 CrowdFlow circuit vector wall</title>
  <desc id="desc">Actual track outlines for all 23 circuits indexed in the CrowdFlow 2026 calendar.</desc>
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#141b24"/><stop offset="1" stop-color="#0c1118"/></linearGradient>
    <linearGradient id="active" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#26300e"/><stop offset="1" stop-color="#101608"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <style>
    .cell{fill:url(#panel);stroke:#27313d;stroke-width:1.2}.speed{fill:none;stroke:#34404e;stroke-width:1}.track{fill:none;stroke:#c5cdd7;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}.tone-1 .track{stroke:#98a9ba}.tone-2 .track{stroke:#d8dde3}.round,.name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.round{fill:#657180;font-size:17px;font-weight:700;letter-spacing:1px}.name{fill:#f4f5f1;font-size:13px;font-weight:800;letter-spacing:1px}.name-bar{fill:#4b5866}.seed .cell{fill:url(#active);stroke:#edff46;stroke-width:2}.seed .track{stroke:#edff46;stroke-width:4;filter:url(#glow)}.seed .round{fill:#edff46}.seed .name-bar,.seed-dot{fill:#edff46}.seed-dot{filter:url(#glow)}
  </style>${cells}
</svg>`;

const silverstone = geometries.find((entry) => entry.id === "silverstone");
if (!silverstone) throw new Error("Silverstone geometry missing");
const silverstoneSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" role="img" aria-labelledby="title desc">
  <title id="title">Silverstone Circuit</title>
  <desc id="desc">Actual Silverstone track outline sourced from the circuit geometry referenced by CrowdFlow.</desc>
  <path d="${pathFor(silverstone.coordinates, 800, 520, 30)}" fill="none" stroke="#edff46" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const graph = JSON.parse(await readFile(path.join(repositoryRoot, "circuits/silverstone/pack/graph.json"), "utf8"));
const track = JSON.parse(await readFile(path.join(repositoryRoot, "circuits/silverstone/pack/track.json"), "utf8"));
const zones = Object.values(graph.zones);
const edges = Object.values(graph.edges);
if (zones.length !== 1875 || edges.length !== 2404) throw new Error("Unexpected Silverstone venue graph size");
const allPoints = [...zones.map((zone) => [zone.position.x, zone.position.y]), ...track];
const xs = allPoints.map(([x]) => x);
const ys = allPoints.map(([, y]) => y);
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minY = Math.min(...ys);
const maxY = Math.max(...ys);
const graphWidth = 760;
const graphHeight = 470;
const graphPadding = 25;
const graphScale = Math.min((graphWidth - graphPadding * 2) / (maxX - minX), (graphHeight - graphPadding * 2) / (maxY - minY));
const offsetX = (graphWidth - (maxX - minX) * graphScale) / 2;
const offsetY = (graphHeight - (maxY - minY) * graphScale) / 2;
const project = ([x, y]) => [offsetX + (x - minX) * graphScale, graphHeight - offsetY - (y - minY) * graphScale];
const positions = new Map(zones.map((zone) => [zone.id, project([zone.position.x, zone.position.y])]));
const edgePath = edges.map((edge) => {
  const a = positions.get(edge.source);
  const b = positions.get(edge.destination);
  return a && b ? `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}` : "";
}).join("");
const zonePath = zones.map((zone) => {
  const [x, y] = positions.get(zone.id);
  return `M${(x - 1.4).toFixed(1)} ${(y - 1.4).toFixed(1)}l2.8 2.8m0-2.8l-2.8 2.8`;
}).join("");
const trackPath = track.map((point, pointIndex) => {
  const [x, y] = project(point);
  return `${pointIndex === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
}).join(" ");
const observed = zones.filter((_, zoneIndex) => zoneIndex % 89 === 0).slice(0, 21).map((zone) => {
  const [x, y] = positions.get(zone.id);
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.8"/>`;
}).join("");
const venueSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${graphWidth} ${graphHeight}" role="img" aria-labelledby="title desc">
  <title id="title">Silverstone venue graph</title>
  <desc id="desc">All 1,875 zones and 2,404 edges rendered from the same graph used by the live CrowdFlow dashboard.</desc>
  <style>.edge{fill:none;stroke:#334151;stroke-width:.7}.zone{fill:none;stroke:#627185;stroke-width:.65}.track{fill:none;stroke:#b4c0ce;stroke-width:2}.observed{fill:#3de0b3;stroke:#07120f;stroke-width:1}</style>
  <path class="edge" d="${edgePath}"/>
  <path class="zone" d="${zonePath}"/>
  <path class="track" d="${trackPath}"/>
  <g class="observed">${observed}</g>
</svg>`;

const licenseResponse = await fetch(`${sourceRoot}/LICENSE.md`);
if (!licenseResponse.ok) throw new Error(`License: HTTP ${licenseResponse.status}`);
await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDir, "circuit-wall.svg"), wallSvg),
  writeFile(path.join(outputDir, "silverstone.svg"), silverstoneSvg),
  writeFile(path.join(outputDir, "silverstone-venue.svg"), venueSvg),
  writeFile(path.join(outputDir, "LICENSE.md"), await licenseResponse.text()),
]);

console.log(`Generated ${geometries.length} circuit outlines and the Silverstone venue graph in ${outputDir}`);
