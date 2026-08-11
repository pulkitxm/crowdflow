// Emergency egress planning: assign every occupied zone to an exit gate,
// balancing walking time against how much load each exit is already carrying.

import { GATES, NODE_MAP, ZONES } from "./venue";
import { routeBetween, type SimParams, type SimState } from "./sim";

export type EvacScenario = "none" | "fire" | "weather" | "security" | "medical";

export const SCENARIOS: { id: EvacScenario; label: string; blurb: string }[] = [
  { id: "none", label: "Full venue evacuation", blurb: "Everyone leaves through the nearest safe exit." },
  { id: "fire", label: "Fire in a grandstand", blurb: "The affected zone and its walkways are unusable." },
  { id: "weather", label: "Severe weather hold", blurb: "Crowd moves to covered zones and parking, exits throttled." },
  { id: "security", label: "Security incident", blurb: "One exit is locked down; flow pushes to the far side." },
  { id: "medical", label: "Mass casualty support", blurb: "Keep a clear corridor to the medical centre." },
];

export interface ExitAssignment {
  zoneId: string;
  zoneName: string;
  people: number;
  gateId: string;
  gateName: string;
  walkMinutes: number;
  path: string[];
  blocked: boolean;
}

export interface EvacPlan {
  assignments: ExitAssignment[];
  gateLoads: {
    gateId: string;
    name: string;
    people: number;
    ratePerMin: number;
    clearMinutes: number;
    utilisation: number;
  }[];
  totalPeople: number;
  clearanceMinutes: number;
  blockedZone?: string | undefined;
  blockedGate?: string | undefined;
}

/** Egress throughput of a gate — turnstiles run free-flow outbound. */
const egressRate = (capacity: number, params: SimParams) =>
  (capacity / 12) * params.staffing * params.flowRate;

export function buildEvacPlan(
  state: SimState,
  params: SimParams,
  scenario: EvacScenario,
  incidentZone?: string,
): EvacPlan {
  const blockedZone = scenario === "fire" || scenario === "medical" ? incidentZone : undefined;
  const blockedGate = scenario === "security" ? GATES[0]?.id : undefined;
  const usableGates = GATES.filter((g) => g.id !== blockedGate);

  const zones = ZONES.map((z) => ({ z, people: state.occupancy[z.id] ?? 0 }))
    .filter((x) => x.people > 1)
    .sort((a, b) => b.people - a.people);

  const load: Record<string, number> = {};
  for (const g of usableGates) load[g.id] = state.queues[g.id] ?? 0;

  const assignments: ExitAssignment[] = [];
  for (const { z, people } of zones) {
    let best: { g: (typeof usableGates)[number]; minutes: number; path: string[]; score: number } | null = null;
    for (const g of usableGates) {
      const r = routeBetween(state, params, z.id, g.id).optimised;
      if (!r.path.length) continue;
      if (blockedZone && r.path.includes(blockedZone) && z.id !== blockedZone) continue;
      const queueDelay = (load[g.id] ?? 0) / egressRate(g.capacity, params);
      const score = r.minutes + queueDelay * 0.8;
      if (!best || score < best.score) best = { g, minutes: r.minutes, path: r.path, score };
    }
    if (!best) continue;
    load[best.g.id] = (load[best.g.id] ?? 0) + people;
    assignments.push({
      zoneId: z.id,
      zoneName: z.name,
      people,
      gateId: best.g.id,
      gateName: best.g.name,
      walkMinutes: best.minutes,
      path: best.path,
      blocked: z.id === blockedZone,
    });
  }

  const throttle = scenario === "weather" ? 0.6 : 1;
  const gateLoads = usableGates.map((g) => {
    const people = load[g.id] ?? 0;
    const rate = egressRate(g.capacity, params) * throttle;
    return {
      gateId: g.id,
      name: g.name,
      people,
      ratePerMin: rate,
      clearMinutes: people / Math.max(1, rate),
      utilisation: Math.min(1.6, people / Math.max(1, rate * 20)),
    };
  });

  const clearanceMinutes = assignments.reduce((max, a) => {
    const gate = gateLoads.find((g) => g.gateId === a.gateId);
    return Math.max(max, a.walkMinutes + (gate?.clearMinutes ?? 0));
  }, 0);

  return {
    assignments,
    gateLoads: gateLoads.sort((a, b) => b.clearMinutes - a.clearMinutes),
    totalPeople: assignments.reduce((s, a) => s + a.people, 0),
    clearanceMinutes,
    blockedZone,
    blockedGate,
  };
}

export const nodeName = (id: string) => NODE_MAP[id]?.name ?? id;
