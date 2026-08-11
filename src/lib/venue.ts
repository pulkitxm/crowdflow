// Active-venue facade. The app renders one circuit at a time; switching
// circuits swaps these live bindings and notifies subscribers so derived
// structures (e.g. the walkway adjacency index) can rebuild.

import { DEFAULT_CIRCUIT_ID, getCircuit, CIRCUIT_SPECS, type Circuit } from "./circuits";

export type { NodeKind, VenueNode, VenueEdge, ScheduleItem } from "./venue-types";
import type { ScheduleItem, VenueEdge, VenueNode } from "./venue-types";

export { CIRCUIT_SPECS, DEFAULT_CIRCUIT_ID, getCircuit };
export type { Circuit };

export let CIRCUIT: Circuit = getCircuit(DEFAULT_CIRCUIT_ID);
export let TRACK_PATH: string = CIRCUIT.trackPath;
export let PIT_LANE_PATH: string = CIRCUIT.pitLanePath;
export let ZONES: VenueNode[] = CIRCUIT.zones;
export let GATES: VenueNode[] = CIRCUIT.gates;
export let FACILITIES: VenueNode[] = CIRCUIT.facilities;
export let NODES: VenueNode[] = CIRCUIT.nodes;
export let NODE_MAP: Record<string, VenueNode> = CIRCUIT.nodeMap;
export let EDGES: VenueEdge[] = CIRCUIT.edges;
export let EVENT_SCHEDULE: ScheduleItem[] = CIRCUIT.schedule;

const listeners = new Set<(c: Circuit) => void>();

/** Subscribe to circuit changes (used to rebuild derived indexes). */
export function onVenueChange(fn: (c: Circuit) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setCircuit(id: string) {
  const next = getCircuit(id);
  if (next.id === CIRCUIT.id) return next;
  CIRCUIT = next;
  TRACK_PATH = next.trackPath;
  PIT_LANE_PATH = next.pitLanePath;
  ZONES = next.zones;
  GATES = next.gates;
  FACILITIES = next.facilities;
  NODES = next.nodes;
  NODE_MAP = next.nodeMap;
  EDGES = next.edges;
  EVENT_SCHEDULE = next.schedule;
  listeners.forEach((l) => l(next));
  return next;
}

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
