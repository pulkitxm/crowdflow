// Mock venue model for the Crowd Flow Optimiser MVP.
// Coordinates live in a 1000 x 640 SVG space.

export type NodeKind = "gate" | "zone" | "facility";

export interface VenueNode {
  id: string;
  name: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** Max comfortable people in this area */
  capacity: number;
  /** North / East / South / West / Central */
  sector: "NORTH" | "EAST" | "SOUTH" | "WEST" | "CENTRAL";
  facility?: "food" | "toilets" | "medical" | "screen" | "info" | "parking";
}

export interface VenueEdge {
  a: string;
  b: string;
  /** people per minute the walkway can carry */
  throughput: number;
}

export const TRACK_PATH =
  "M 430 118 C 560 96, 700 108, 812 146 C 900 176, 918 252, 862 302 C 806 352, 720 344, 668 386 C 616 428, 634 486, 566 512 C 498 538, 446 500, 404 452 C 362 404, 268 396, 236 330 C 204 264, 236 152, 430 118 Z";

export const PIT_LANE_PATH = "M 452 296 L 700 296 L 706 330 L 452 330 Z";

export const ZONES: VenueNode[] = [
  { id: "copse", name: "Copse", kind: "zone", x: 452, y: 132, capacity: 9000, sector: "NORTH" },
  { id: "maggotts", name: "Maggotts", kind: "zone", x: 292, y: 178, capacity: 6000, sector: "NORTH" },
  { id: "becketts", name: "Becketts", kind: "zone", x: 246, y: 268, capacity: 7000, sector: "NORTH" },
  { id: "stowe", name: "Stowe", kind: "zone", x: 796, y: 158, capacity: 11000, sector: "NORTH" },
  { id: "vale", name: "Vale", kind: "zone", x: 872, y: 252, capacity: 5000, sector: "EAST" },
  { id: "club", name: "Club", kind: "zone", x: 800, y: 342, capacity: 8500, sector: "EAST" },
  { id: "abbey", name: "Abbey", kind: "zone", x: 700, y: 402, capacity: 7500, sector: "EAST" },
  { id: "village", name: "Village", kind: "zone", x: 596, y: 474, capacity: 6500, sector: "SOUTH" },
  { id: "loop", name: "The Loop", kind: "zone", x: 494, y: 508, capacity: 4500, sector: "SOUTH" },
  { id: "luffield", name: "Luffield", kind: "zone", x: 392, y: 468, capacity: 8000, sector: "SOUTH" },
  { id: "brooklands", name: "Brooklands", kind: "zone", x: 322, y: 396, capacity: 6000, sector: "WEST" },
  { id: "woodcote", name: "Woodcote", kind: "zone", x: 250, y: 430, capacity: 5000, sector: "WEST" },
  { id: "paddock", name: "Paddock & Pit Complex", kind: "zone", x: 566, y: 268, capacity: 12000, sector: "CENTRAL" },
];

export const GATES: VenueNode[] = [
  { id: "g1", name: "Gate 1 · Main Entrance", kind: "gate", x: 520, y: 604, capacity: 3000, sector: "SOUTH" },
  { id: "g2", name: "Gate 2 · South Car Park", kind: "gate", x: 320, y: 570, capacity: 2200, sector: "SOUTH" },
  { id: "g3", name: "Gate 3 · Village East", kind: "gate", x: 706, y: 556, capacity: 2400, sector: "SOUTH" },
  { id: "g4", name: "Gate 4 · Woodcote", kind: "gate", x: 132, y: 452, capacity: 1800, sector: "WEST" },
  { id: "g5", name: "Gate 5 · Becketts", kind: "gate", x: 140, y: 196, capacity: 1600, sector: "WEST" },
  { id: "g6", name: "Gate 6 · Hangar North", kind: "gate", x: 470, y: 46, capacity: 2600, sector: "NORTH" },
  { id: "g7", name: "Gate 7 · Stowe North", kind: "gate", x: 898, y: 78, capacity: 2000, sector: "NORTH" },
  { id: "g8", name: "Gate 8 · Club East", kind: "gate", x: 962, y: 334, capacity: 1700, sector: "EAST" },
];

export const FACILITIES: VenueNode[] = [
  { id: "f-food-n", name: "Food Court North", kind: "facility", x: 600, y: 122, capacity: 1400, sector: "NORTH", facility: "food" },
  { id: "f-food-s", name: "Food Court South", kind: "facility", x: 470, y: 430, capacity: 1600, sector: "SOUTH", facility: "food" },
  { id: "f-food-e", name: "Food Court East", kind: "facility", x: 760, y: 262, capacity: 1200, sector: "EAST", facility: "food" },
  { id: "f-wc-w", name: "Toilets West", kind: "facility", x: 300, y: 330, capacity: 600, sector: "WEST", facility: "toilets" },
  { id: "f-wc-e", name: "Toilets East", kind: "facility", x: 848, y: 400, capacity: 600, sector: "EAST", facility: "toilets" },
  { id: "f-med-1", name: "Medical Centre 1", kind: "facility", x: 660, y: 176, capacity: 200, sector: "NORTH", facility: "medical" },
  { id: "f-med-2", name: "Medical Centre 2", kind: "facility", x: 386, y: 340, capacity: 200, sector: "WEST", facility: "medical" },
  { id: "f-screen-1", name: "Big Screen · Village", kind: "facility", x: 640, y: 512, capacity: 3000, sector: "SOUTH", facility: "screen" },
  { id: "f-screen-2", name: "Big Screen · Becketts", kind: "facility", x: 190, y: 312, capacity: 2500, sector: "WEST", facility: "screen" },
  { id: "f-info", name: "Info Point · Main", kind: "facility", x: 556, y: 556, capacity: 300, sector: "SOUTH", facility: "info" },
];

export const NODES: VenueNode[] = [...ZONES, ...GATES, ...FACILITIES];

export const NODE_MAP: Record<string, VenueNode> = Object.fromEntries(
  NODES.map((n) => [n.id, n]),
);

export const EDGES: VenueEdge[] = [
  // Outer concourse ring
  { a: "copse", b: "maggotts", throughput: 900 },
  { a: "maggotts", b: "becketts", throughput: 850 },
  { a: "becketts", b: "brooklands", throughput: 700 },
  { a: "brooklands", b: "woodcote", throughput: 700 },
  { a: "woodcote", b: "luffield", throughput: 800 },
  { a: "luffield", b: "loop", throughput: 750 },
  { a: "loop", b: "village", throughput: 700 },
  { a: "village", b: "abbey", throughput: 800 },
  { a: "abbey", b: "club", throughput: 850 },
  { a: "club", b: "vale", throughput: 700 },
  { a: "vale", b: "stowe", throughput: 900 },
  { a: "stowe", b: "copse", throughput: 1000 },
  // Cross-links through the central complex
  { a: "paddock", b: "copse", throughput: 1100 },
  { a: "paddock", b: "stowe", throughput: 900 },
  { a: "paddock", b: "abbey", throughput: 800 },
  { a: "paddock", b: "luffield", throughput: 850 },
  { a: "paddock", b: "becketts", throughput: 600 },
  { a: "paddock", b: "village", throughput: 700 },
  // Gates
  { a: "g1", b: "loop", throughput: 1200 },
  { a: "g1", b: "village", throughput: 1000 },
  { a: "g2", b: "luffield", throughput: 900 },
  { a: "g3", b: "village", throughput: 950 },
  { a: "g4", b: "woodcote", throughput: 800 },
  { a: "g5", b: "becketts", throughput: 700 },
  { a: "g6", b: "copse", throughput: 1000 },
  { a: "g7", b: "stowe", throughput: 850 },
  { a: "g8", b: "club", throughput: 750 },
  // Facilities hang off nearby zones
  { a: "f-food-n", b: "copse", throughput: 500 },
  { a: "f-food-n", b: "stowe", throughput: 500 },
  { a: "f-food-s", b: "luffield", throughput: 550 },
  { a: "f-food-s", b: "loop", throughput: 450 },
  { a: "f-food-e", b: "club", throughput: 500 },
  { a: "f-wc-w", b: "becketts", throughput: 400 },
  { a: "f-wc-e", b: "club", throughput: 400 },
  { a: "f-med-1", b: "stowe", throughput: 300 },
  { a: "f-med-2", b: "brooklands", throughput: 300 },
  { a: "f-screen-1", b: "village", throughput: 600 },
  { a: "f-screen-2", b: "becketts", throughput: 600 },
  { a: "f-info", b: "g1", throughput: 400 },
];

export interface ScheduleItem {
  /** minutes from gates-open (t = 0 at 09:00) */
  t: number;
  label: string;
  /** relative pull of the crowd towards these zones */
  magnet: string[];
  /** arrival multiplier at the gates */
  arrival: number;
}

export const EVENT_SCHEDULE: ScheduleItem[] = [
  { t: 0, label: "Gates open", magnet: ["paddock", "f-food-s"], arrival: 1.2 },
  { t: 60, label: "Support race 1", magnet: ["copse", "stowe", "village"], arrival: 1.6 },
  { t: 150, label: "Pit lane walk", magnet: ["paddock"], arrival: 1.9 },
  { t: 220, label: "Driver parade", magnet: ["paddock", "luffield", "club"], arrival: 1.4 },
  { t: 280, label: "Main race start", magnet: ["copse", "stowe", "club", "village"], arrival: 0.7 },
  { t: 400, label: "Chequered flag", magnet: ["paddock", "abbey"], arrival: 0.2 },
  { t: 430, label: "Egress surge", magnet: ["g1", "g2", "g3", "g6"], arrival: 0.0 },
];

export function scheduleAt(t: number): ScheduleItem {
  let current: ScheduleItem = EVENT_SCHEDULE[0]!;

  for (const item of EVENT_SCHEDULE) if (t >= item.t) current = item;
  return current;
}

export function clockLabel(minutes: number): string {
  const total = 9 * 60 + Math.floor(minutes);
  const h = Math.floor(total / 60) % 24;
  const m = Math.floor(total % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
