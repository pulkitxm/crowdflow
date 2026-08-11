// Continuous crowd-density heat field.
//
// The map is a 1000 x 640 SVG space that stands in for roughly 1500m x 960m of
// circuit, so 1 SVG unit ~= 1.5 m. We spread every group of people (zone
// occupancy, gate queues, people walking a route) over the ground as a
// gaussian blob, sum them into a grid, and read the result as people per m².

import { EDGES, GATES, NODE_MAP, NODES, type VenueNode } from "./venue";
import { edgeKey, type SimState } from "./sim";

/** metres per SVG unit */
export const METRES_PER_UNIT = 1.5;
/** grid resolution in SVG units */
export const CELL = 8;
export const GRID_W = Math.ceil(1000 / CELL);
export const GRID_H = Math.ceil(640 / CELL);
const CELL_AREA_M2 = (CELL * METRES_PER_UNIT) ** 2;

/** density bands in people per m² */
export const HEAT_BANDS = [
  { value: 0.3, label: "Free flowing", color: "#22c55e" },
  { value: 1.2, label: "Busy", color: "#a3e635" },
  { value: 2.2, label: "Restricted", color: "#facc15" },
  { value: 3.5, label: "Congested", color: "#f97316" },
  { value: 5, label: "Crush risk", color: "#ef4444" },
];
export const HEAT_MAX = 6;

/** How wide (SVG units) a crowd of this capacity spreads on the ground. */
function spreadOf(n: VenueNode) {
  if (n.kind === "gate") return 12;
  if (n.kind === "facility") return 12;
  return 8 + Math.sqrt(n.capacity) * 0.105;
}

function stamp(grid: Float32Array, x: number, y: number, people: number, sigma: number) {
  if (people <= 0) return;
  const gx = x / CELL;
  const gy = y / CELL;
  const s = sigma / CELL;
  const rad = Math.ceil(s * 2.6);
  const x0 = Math.max(0, Math.floor(gx - rad));
  const x1 = Math.min(GRID_W - 1, Math.ceil(gx + rad));
  const y0 = Math.max(0, Math.floor(gy - rad));
  const y1 = Math.min(GRID_H - 1, Math.ceil(gy + rad));
  const inv = 1 / (2 * s * s);

  // normalise so the blob holds exactly `people`
  let total = 0;
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const dx = ix + 0.5 - gx;
      const dy = iy + 0.5 - gy;
      total += Math.exp(-(dx * dx + dy * dy) * inv);
    }
  }
  if (total <= 0) return;
  const k = people / total;
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const dx = ix + 0.5 - gx;
      const dy = iy + 0.5 - gy;
      const idx = iy * GRID_W + ix;
      grid[idx] = (grid[idx] ?? 0) + Math.exp(-(dx * dx + dy * dy) * inv) * k;
    }
  }
}

export interface HeatField {
  /** people per m², one entry per grid cell */
  grid: Float32Array;
  peak: number;
  /** total people represented in the field */
  people: number;
}

export function computeHeatField(state: SimState): HeatField {
  const grid = new Float32Array(GRID_W * GRID_H);
  let people = 0;

  // Standing / dwelling crowds in zones and around facilities
  for (const n of NODES) {
    if (n.kind === "gate") continue;
    const occ = state.occupancy[n.id] ?? 0;
    if (occ <= 0) continue;
    people += occ;
    // crowds compress as they fill up: the blob tightens rather than growing
    const load = Math.min(1.6, occ / n.capacity);
    stamp(grid, n.x, n.y, occ, spreadOf(n) * (1 - 0.28 * Math.min(1, load)));
  }

  // Queues bunched outside the gates
  for (const g of GATES) {
    const q = state.queues[g.id] ?? 0;
    if (q <= 0) continue;
    people += q;
    stamp(grid, g.x, g.y, q, 8 + Math.sqrt(q) * 0.16);
  }

  // People in transit, smeared along each walkway
  for (const e of EDGES) {
    const flow = state.flows[edgeKey(e.a, e.b)] ?? 0;
    if (flow <= 0) continue;
    const a = NODE_MAP[e.a];
    const b = NODE_MAP[e.b];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // people currently on the walkway ~= flow (per min) x minutes to walk it
    const walking = flow * Math.max(0.5, (len * METRES_PER_UNIT) / 80);
    people += walking;
    const steps = Math.max(2, Math.round(len / 18));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stamp(grid, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, walking / (steps + 1), 7);
    }
  }

  // convert head counts per cell into people per m²
  let peak = 0;
  for (let i = 0; i < grid.length; i++) {
    const v = (grid[i] ?? 0) / CELL_AREA_M2;
    grid[i] = v;
    if (v > peak) peak = v;
  }

  return { grid, peak, people };
}

const RAMP: Array<[number, [number, number, number]]> = [
  [0, [14, 60, 92]],
  [0.3, [34, 197, 94]],
  [1.2, [163, 230, 53]],
  [2.2, [250, 204, 21]],
  [3.5, [249, 115, 22]],
  [5, [239, 68, 68]],
  [6.5, [255, 240, 240]],
];

/** people/m² -> rgba */
export function heatColor(v: number): [number, number, number, number] {
  if (v <= 0.02) return [0, 0, 0, 0];
  let i = 0;
  while (i < RAMP.length - 2 && v > RAMP[i + 1]![0]) i++;
  const [v0, c0] = RAMP[i]!;
  const [v1, c1] = RAMP[i + 1]!;
  const t = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
  const alpha = Math.min(1, 0.18 + (v / 2.2) * 0.72);
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * t),
    Math.round(c0[1] + (c1[1] - c0[1]) * t),
    Math.round(c0[2] + (c1[2] - c0[2]) * t),
    Math.round(alpha * 255),
  ];
}
