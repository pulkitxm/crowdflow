// Circuit catalogue for the Crowd Flow Optimiser.
//
// Each circuit is described by its named corners (normalised 0..1 shape of the
// real track). From that we generate the venue graph: grandstand zones sitting
// just outside each corner, entry gates on the perimeter, facilities between
// stands, and the walkway network that connects them all.

import type { ScheduleItem, VenueEdge, VenueNode } from "./venue-types";
import { SILVERSTONE, SILVERSTONE_SPEC } from "./circuit-silverstone";

export interface CircuitCorner {
  name: string;
  /** normalised track coordinates, 0..1 */
  x: number;
  y: number;
  /** relative grandstand size, 1 = average */
  stand?: number;
  /** no grandstand here, shape point only */
  shapeOnly?: boolean;
}

export interface CircuitSpec {
  id: string;
  name: string;
  location: string;
  country: string;
  flag: string;
  lengthKm: number;
  laps: number;
  /** typical race-day attendance */
  attendance: number;
  blurb: string;
  corners: CircuitCorner[];
  /** index of the corner that follows the start/finish line */
  startIndex?: number;
}

export interface Circuit extends CircuitSpec {
  trackPath: string;
  pitLanePath: string;
  zones: VenueNode[];
  gates: VenueNode[];
  facilities: VenueNode[];
  nodes: VenueNode[];
  nodeMap: Record<string, VenueNode>;
  edges: VenueEdge[];
  schedule: ScheduleItem[];
}

export const VIEW_W = 1000;
export const VIEW_H = 640;

// --- geometry helpers -------------------------------------------------------

interface P {
  x: number;
  y: number;
}

function fitPoints(corners: CircuitCorner[]): P[] {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = 210;
  const padY = 130;
  const w = VIEW_W - padX * 2;
  const h = VIEW_H - padY * 2;
  const sx = w / Math.max(0.001, maxX - minX);
  const sy = h / Math.max(0.001, maxY - minY);
  const s = Math.min(sx, sy);
  const offX = padX + (w - (maxX - minX) * s) / 2;
  const offY = padY + (h - (maxY - minY) * s) / 2;
  return corners.map((c) => ({
    x: offX + (c.x - minX) * s,
    y: offY + (c.y - minY) * s,
  }));
}

/** Closed Catmull-Rom spline rendered as cubic beziers. */
function smoothClosedPath(pts: P[]): string {
  const n = pts.length;
  if (n < 3) return "";
  let d = `M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

function centroid(pts: P[]): P {
  const c = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: c.x / pts.length, y: c.y / pts.length };
}

function push(p: P, from: P, distance: number): P {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: Math.min(VIEW_W - 24, Math.max(24, p.x + (dx / len) * distance)),
    y: Math.min(VIEW_H - 24, Math.max(24, p.y + (dy / len) * distance)),
  };
}

function sectorOf(p: P, c: P): VenueNode["sector"] {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (Math.hypot(dx, dy) < 70) return "CENTRAL";
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "EAST" : "WEST";
  return dy > 0 ? "SOUTH" : "NORTH";
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// --- venue generation -------------------------------------------------------

const FACILITY_CYCLE: Array<NonNullable<VenueNode["facility"]>> = [
  "food",
  "toilets",
  "screen",
  "food",
  "medical",
  "toilets",
  "food",
  "screen",
  "info",
];

export function buildCircuit(spec: CircuitSpec): Circuit {
  const pts = fitPoints(spec.corners);
  const c = centroid(pts);
  const trackPath = smoothClosedPath(pts);

  const standIdx = spec.corners
    .map((corner, i) => ({ corner, i }))
    .filter(({ corner }) => !corner.shapeOnly);

  const standWeight = standIdx.reduce((s, { corner }) => s + (corner.stand ?? 1), 0);
  // grandstands hold ~62% of attendance comfortably, the rest is on the move
  const standCapacityPool = spec.attendance * 0.78;

  const zones: VenueNode[] = standIdx.map(({ corner, i }) => {
    const p = push(pts[i]!, c, 46);
    return {
      id: slug(corner.name),
      name: corner.name,
      kind: "zone",
      x: Math.round(p.x),
      y: Math.round(p.y),
      capacity: Math.round(((corner.stand ?? 1) / standWeight) * standCapacityPool),
      sector: sectorOf(p, c),
    };
  });

  // Paddock / pit complex sits inside the loop next to the start line
  const start = pts[spec.startIndex ?? 0]!;
  const paddockPoint = { x: (start.x + c.x * 2) / 3, y: (start.y + c.y * 2) / 3 };
  const paddock: VenueNode = {
    id: "paddock",
    name: "Paddock & Pit Complex",
    kind: "zone",
    x: Math.round(paddockPoint.x),
    y: Math.round(paddockPoint.y),
    capacity: Math.round(spec.attendance * 0.13),
    sector: "CENTRAL",
  };
  zones.push(paddock);

  const ring = zones.slice(0, -1); // perimeter stands in track order

  // Gates: spread around the outside, one per ~3 stands (min 5)
  const gateCount = Math.max(5, Math.min(9, Math.round(ring.length / 2.2)));
  const gates: VenueNode[] = [];
  for (let g = 0; g < gateCount; g++) {
    const idx = Math.round((g * ring.length) / gateCount) % ring.length;
    const anchor = ring[idx]!;
    const p = push({ x: anchor.x, y: anchor.y }, c, 116);
    gates.push({
      id: `g${g + 1}`,
      name: `Gate ${g + 1} · ${anchor.name}`,
      kind: "gate",
      x: Math.round(p.x),
      y: Math.round(p.y),
      capacity: Math.round((spec.attendance / gateCount) * 0.34),
      sector: sectorOf(p, c),
    });
  }

  // Facilities between consecutive stands
  const facilities: VenueNode[] = [];
  const facilityStep = ring.length > 9 ? 2 : 1;
  let fi = 0;
  for (let i = 0; i < ring.length; i += facilityStep) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const type = FACILITY_CYCLE[fi % FACILITY_CYCLE.length]!;
    const mid = push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, c, 34);
    const cap =
      type === "food" ? 1400 : type === "screen" ? 2600 : type === "toilets" ? 600 : type === "medical" ? 200 : 300;
    const label =
      type === "food"
        ? "Food Court"
        : type === "toilets"
          ? "Toilets"
          : type === "screen"
            ? "Big Screen"
            : type === "medical"
              ? "Medical Centre"
              : "Info Point";
    facilities.push({
      id: `f-${fi}-${type}`,
      name: `${label} · ${a.name}`,
      kind: "facility",
      x: Math.round(mid.x),
      y: Math.round(mid.y),
      capacity: cap,
      sector: sectorOf(mid, c),
      facility: type,
    });
    fi++;
  }

  const nodes = [...zones, ...gates, ...facilities];
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const dist = (a: VenueNode, b: VenueNode) => Math.hypot(a.x - b.x, a.y - b.y);
  const edges: VenueEdge[] = [];
  const seen = new Set<string>();
  const link = (a: string, b: string, throughput: number) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (a === b || seen.has(k)) return;
    seen.add(k);
    edges.push({ a, b, throughput: Math.round(throughput) });
  };

  // Concourse ring
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    link(a.id, b.id, 620 + Math.min(a.capacity, b.capacity) / 12);
  }
  // Cross links through the paddock
  for (let i = 0; i < ring.length; i += 2) {
    link(paddock.id, ring[i]!.id, 780 + ring[i]!.capacity / 14);
  }
  // Gates feed their two nearest stands
  for (const g of gates) {
    const near = [...ring].sort((a, b) => dist(g, a) - dist(g, b)).slice(0, 2);
    near.forEach((z, i) => link(g.id, z.id, i === 0 ? 1100 : 820));
  }
  // Facilities hang off the two stands they sit between
  for (const f of facilities) {
    const near = [...ring].sort((a, b) => dist(f, a) - dist(f, b)).slice(0, 2);
    for (const z of near) link(f.id, z.id, f.facility === "screen" ? 620 : 480);
  }

  // Pit lane drawn along the start/finish straight, just inside the track
  const nextIdx = ((spec.startIndex ?? 0) + 1) % pts.length;
  const s0 = pts[spec.startIndex ?? 0]!;
  const s1 = pts[nextIdx]!;
  const inset = (p: P, d: number) => push(p, c, -d);
  const a0 = inset(s0, 20);
  const a1 = inset(s1, 20);
  const b1 = inset(s1, 46);
  const b0 = inset(s0, 46);
  const pitLanePath = `M ${a0.x.toFixed(0)} ${a0.y.toFixed(0)} L ${a1.x.toFixed(0)} ${a1.y.toFixed(0)} L ${b1.x.toFixed(0)} ${b1.y.toFixed(0)} L ${b0.x.toFixed(0)} ${b0.y.toFixed(0)} Z`;

  // Event schedule — magnets picked from the biggest stands
  const biggest = [...ring].sort((a, b) => b.capacity - a.capacity);
  const pick = (i: number) => biggest[i % biggest.length]!.id;
  const foodSouth = facilities.find((f) => f.facility === "food")?.id ?? pick(0);
  const schedule: ScheduleItem[] = [
    { t: 0, label: "Gates open", magnet: [paddock.id, foodSouth], arrival: 1.2 },
    { t: 60, label: "Support race 1", magnet: [pick(0), pick(1), pick(2)], arrival: 1.6 },
    { t: 150, label: "Pit lane walk", magnet: [paddock.id], arrival: 1.9 },
    { t: 220, label: "Driver parade", magnet: [paddock.id, pick(3), pick(1)], arrival: 1.4 },
    { t: 280, label: "Main race start", magnet: [pick(0), pick(1), pick(2), pick(3)], arrival: 0.7 },
    { t: 400, label: "Chequered flag", magnet: [paddock.id, pick(4)], arrival: 0.2 },
    { t: 430, label: "Egress surge", magnet: gates.slice(0, 4).map((g) => g.id), arrival: 0 },
  ];

  return {
    ...spec,
    trackPath,
    pitLanePath,
    zones,
    gates,
    facilities,
    nodes,
    nodeMap,
    edges,
    schedule,
  };
}

// --- the catalogue ----------------------------------------------------------

export const CIRCUIT_SPECS: CircuitSpec[] = [
  SILVERSTONE_SPEC,
  {
    id: "monza",
    name: "Autodromo Nazionale Monza",
    location: "Monza, Lombardy",
    country: "Italy",
    flag: "🇮🇹",
    lengthKm: 5.793,
    laps: 53,
    attendance: 152000,
    blurb: "The Temple of Speed: huge tifosi crowds funnelled through a narrow park entrance.",
    startIndex: 0,
    corners: [
      { name: "Rettifilo Tribuna", x: 0.16, y: 0.86, stand: 1.6 },
      { name: "Variante del Rettifilo", x: 0.21, y: 0.6, stand: 1.2 },
      { name: "Curva Grande", x: 0.33, y: 0.36, stand: 1.1 },
      { name: "Variante della Roggia", x: 0.45, y: 0.26, stand: 0.9 },
      { name: "Lesmo 1", x: 0.6, y: 0.16, stand: 1 },
      { name: "Lesmo 2", x: 0.68, y: 0.24, stand: 0.9 },
      { name: "Serraglio", x: 0.56, y: 0.44, shapeOnly: true },
      { name: "Variante Ascari", x: 0.63, y: 0.55, stand: 1.2 },
      { name: "Back Straight", x: 0.88, y: 0.72, shapeOnly: true },
      { name: "Parabolica", x: 0.8, y: 0.92, stand: 1.5 },
      { name: "Curva Sud", x: 0.45, y: 0.95, stand: 1 },
    ],
  },
  {
    id: "monaco",
    name: "Circuit de Monaco",
    location: "Monte Carlo",
    country: "Monaco",
    flag: "🇲🇨",
    lengthKm: 3.337,
    laps: 78,
    attendance: 78000,
    blurb: "Tight street circuit where every walkway is a pinch point between harbour and hillside.",
    startIndex: 0,
    corners: [
      { name: "Start / Finish", x: 0.2, y: 0.8, stand: 1.3 },
      { name: "Sainte Dévote", x: 0.3, y: 0.62, stand: 1 },
      { name: "Beau Rivage", x: 0.28, y: 0.44, shapeOnly: true },
      { name: "Massenet", x: 0.31, y: 0.34, stand: 0.9 },
      { name: "Casino Square", x: 0.42, y: 0.29, stand: 1.2 },
      { name: "Mirabeau", x: 0.54, y: 0.31 },
      { name: "Grand Hotel Hairpin", x: 0.56, y: 0.4, stand: 1.1 },
      { name: "Portier", x: 0.64, y: 0.46 },
      { name: "Tunnel", x: 0.79, y: 0.52, shapeOnly: true },
      { name: "Nouvelle Chicane", x: 0.83, y: 0.68, stand: 1.1 },
      { name: "Tabac", x: 0.72, y: 0.74, stand: 0.9 },
      { name: "Swimming Pool", x: 0.61, y: 0.82, stand: 1.2 },
      { name: "La Rascasse", x: 0.42, y: 0.88, stand: 1 },
      { name: "Anthony Noghès", x: 0.27, y: 0.88 },
    ],
  },
  {
    id: "spa",
    name: "Circuit de Spa-Francorchamps",
    location: "Stavelot, Ardennes",
    country: "Belgium",
    flag: "🇧🇪",
    lengthKm: 7.004,
    laps: 44,
    attendance: 130000,
    blurb: "Seven kilometres of forest with long walks between stands and weather-driven surges.",
    startIndex: 0,
    corners: [
      { name: "La Source", x: 0.16, y: 0.22, stand: 1.3 },
      { name: "Eau Rouge", x: 0.2, y: 0.42, stand: 1.4 },
      { name: "Raidillon", x: 0.26, y: 0.52, stand: 1.2 },
      { name: "Kemmel Straight", x: 0.37, y: 0.72, shapeOnly: true },
      { name: "Les Combes", x: 0.47, y: 0.82, stand: 1.1 },
      { name: "Malmedy", x: 0.54, y: 0.73 },
      { name: "Rivage", x: 0.62, y: 0.68, stand: 0.9 },
      { name: "Pouhon", x: 0.65, y: 0.5, stand: 1.1 },
      { name: "Fagnes", x: 0.74, y: 0.42 },
      { name: "Stavelot", x: 0.88, y: 0.5, stand: 1 },
      { name: "Blanchimont", x: 0.74, y: 0.28, stand: 0.9 },
      { name: "Bus Stop Chicane", x: 0.32, y: 0.16, stand: 1.2 },
    ],
  },
  {
    id: "interlagos",
    name: "Autódromo José Carlos Pace",
    location: "Interlagos, São Paulo",
    country: "Brazil",
    flag: "🇧🇷",
    lengthKm: 4.309,
    laps: 71,
    attendance: 138000,
    blurb: "Compact, steeply banked site with dense grandstands packed around the main straight.",
    startIndex: 0,
    corners: [
      { name: "Start / Finish", x: 0.45, y: 0.14, stand: 1.5 },
      { name: "Senna S", x: 0.3, y: 0.2, stand: 1.3 },
      { name: "Curva do Sol", x: 0.21, y: 0.31, stand: 1 },
      { name: "Reta Oposta", x: 0.14, y: 0.5, shapeOnly: true },
      { name: "Descida do Lago", x: 0.25, y: 0.61, stand: 0.9 },
      { name: "Ferradura", x: 0.4, y: 0.68 },
      { name: "Laranja", x: 0.5, y: 0.76 },
      { name: "Pinheirinho", x: 0.42, y: 0.86, stand: 1 },
      { name: "Bico de Pato", x: 0.56, y: 0.88 },
      { name: "Mergulho", x: 0.69, y: 0.79, stand: 0.9 },
      { name: "Junção", x: 0.79, y: 0.7, stand: 1.1 },
      { name: "Subida dos Boxes", x: 0.71, y: 0.38, stand: 1.2 },
    ],
  },
  {
    id: "marina-bay",
    name: "Marina Bay Street Circuit",
    location: "Marina Bay, Singapore",
    country: "Singapore",
    flag: "🇸🇬",
    lengthKm: 4.94,
    laps: 62,
    attendance: 88000,
    blurb: "Night race threading public walkways, bridges and concert stages around the bay.",
    startIndex: 0,
    corners: [
      { name: "Pit Straight", x: 0.22, y: 0.24, stand: 1.3 },
      { name: "Turn 1 Sheares", x: 0.36, y: 0.18, stand: 1.1 },
      { name: "Republic Boulevard", x: 0.5, y: 0.22, shapeOnly: true },
      { name: "Memorial Corner", x: 0.62, y: 0.3, stand: 1 },
      { name: "Anderson Bridge", x: 0.72, y: 0.42, stand: 0.9 },
      { name: "Fullerton", x: 0.78, y: 0.56, stand: 1.2 },
      { name: "Esplanade Drive", x: 0.68, y: 0.68, stand: 1.1 },
      { name: "Bay Grandstand", x: 0.52, y: 0.78, stand: 1.4 },
      { name: "Turn 16", x: 0.36, y: 0.74 },
      { name: "Republic Avenue", x: 0.26, y: 0.6, shapeOnly: true },
      { name: "Turn 19", x: 0.18, y: 0.44, stand: 1 },
    ],
  },
];

const cache = new Map<string, Circuit>();

export function getCircuit(id: string): Circuit {
  if (id === SILVERSTONE.id) return SILVERSTONE;
  const cached = cache.get(id);
  if (cached) return cached;
  const spec = CIRCUIT_SPECS.find((s) => s.id === id) ?? SILVERSTONE_SPEC;
  if (spec.id === SILVERSTONE.id) return SILVERSTONE;
  const built = buildCircuit(spec);
  cache.set(spec.id, built);
  return built;
}

export const DEFAULT_CIRCUIT_ID = "silverstone";
