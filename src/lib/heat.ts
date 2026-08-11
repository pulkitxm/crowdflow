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
export const CELL = 5;
export const GRID_W = Math.ceil(1000 / CELL);
export const GRID_H = Math.ceil(640 / CELL);
const CELL_AREA_M2 = (CELL * METRES_PER_UNIT) ** 2;

/** density bands in people per m² */
export const HEAT_BANDS = [
  { value: 0.15, label: "Free flowing", color: "#22c55e" },
  { value: 0.5, label: "Steady", color: "#a3e635" },
  { value: 1, label: "Busy", color: "#facc15" },
  { value: 1.6, label: "Restricted", color: "#f97316" },
  { value: 2.2, label: "Crush risk", color: "#ef4444" },
];
export const HEAT_MAX = 2.5;

/** How wide (SVG units) a crowd of this capacity spreads on the ground. */
function spreadOf(n: VenueNode) {
  if (n.kind === "gate") return 9;
  if (n.kind === "facility") return 9;
  return 7 + Math.sqrt(n.capacity) * 0.06;
}

/**
 * Separable box blur, run three times, which approximates a gaussian. This is
 * what turns a set of stamped blobs into one continuous field instead of a
 * constellation of dots.
 */
function blur(grid: Float32Array, radius: number) {
  if (radius < 1) return;
  const tmp = new Float32Array(grid.length);
  const w = GRID_W;
  const h = GRID_H;
  const passes = 3;
  const denom = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -radius; x <= radius; x++) {
        acc += grid[row + Math.min(w - 1, Math.max(0, x))] ?? 0;
      }
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / denom;
        const out = grid[row + Math.min(w - 1, Math.max(0, x - radius))] ?? 0;
        const inc = grid[row + Math.min(w - 1, Math.max(0, x + radius + 1))] ?? 0;
        acc += inc - out;
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -radius; y <= radius; y++) {
        acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x] ?? 0;
      }
      for (let y = 0; y < h; y++) {
        grid[y * w + x] = acc / denom;
        const out = tmp[Math.min(h - 1, Math.max(0, y - radius)) * w + x] ?? 0;
        const inc = tmp[Math.min(h - 1, Math.max(0, y + radius + 1)) * w + x] ?? 0;
        acc += inc - out;
      }
    }
  }
}

/** Smear `people` evenly along a line, so corridors read as ribbons. */
function stampLine(
  grid: Float32Array,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  people: number,
  sigma: number,
) {
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(3, Math.round(len / (CELL * 1.2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stamp(grid, ax + (bx - ax) * t, ay + (by - ay) * t, people / (steps + 1), sigma);
  }
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
    const sigma = spreadOf(n) * (1 - 0.22 * Math.min(1, load));
    // 70% stands/dwells at the node, 30% is spread out along the walkways that
    // leave it, so neighbouring crowds bleed into each other continuously.
    stamp(grid, n.x, n.y, occ * 0.42, sigma);
    // A wide, low halo: people spilling across the surrounding ground. This is
    // what makes the map a continuous field instead of isolated hotspots.
    stamp(grid, n.x, n.y, occ * 0.26, sigma * 4.2);
    const links = EDGES.filter((e) => e.a === n.id || e.b === n.id);
    if (links.length) {
      const share = (occ * 0.32) / links.length;
      for (const e of links) {
        const other = NODE_MAP[e.a === n.id ? e.b : e.a];
        if (!other) continue;
        stampLine(grid, n.x, n.y, n.x + (other.x - n.x) * 0.45, n.y + (other.y - n.y) * 0.45, share, sigma * 0.7);
      }
    }
  }

  // Queues bunched outside the gates
  for (const g of GATES) {
    const q = state.queues[g.id] ?? 0;
    if (q <= 0) continue;
    people += q;
    stamp(grid, g.x, g.y, q, 7 + Math.sqrt(q) * 0.1);
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
    stampLine(grid, a.x, a.y, b.x, b.y, walking, 6);
  }

  // One soft pass so the stamps fuse into a single continuous surface.
  blur(grid, 2);

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
  [0, [16, 122, 62]],
  [0.15, [34, 197, 94]],
  [0.5, [163, 230, 53]],
  [1, [250, 204, 21]],
  [1.6, [249, 115, 22]],
  [2.2, [239, 68, 68]],
  [2.6, [255, 210, 210]],
];

/** people/m² -> rgba */
export function heatColor(raw: number): [number, number, number, number] {
  if (raw <= 0.01) return [0, 0, 0, 0];
  // Perceptual compression: real venue densities sit low over most of the
  // ground, so we stretch the quiet end across the ramp instead of leaving
  // 90% of the map flat blue.
  const v = HEAT_MAX * Math.pow(Math.min(1, raw / HEAT_MAX), 0.55);
  let i = 0;
  while (i < RAMP.length - 2 && v > RAMP[i + 1]![0]) i++;
  const [v0, c0] = RAMP[i]!;
  const [v1, c1] = RAMP[i + 1]!;
  const t = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
  // Smooth, saturating opacity: quiet ground stays faint, busy ground reads solid.
  const alpha = Math.min(1, Math.pow(Math.min(1, raw / 0.3), 0.45) * 0.86 + 0.08);
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * t),
    Math.round(c0[1] + (c1[1] - c0[1]) * t),
    Math.round(c0[2] + (c1[2] - c0[2]) * t),
    Math.round(alpha * 255),
  ];
}
