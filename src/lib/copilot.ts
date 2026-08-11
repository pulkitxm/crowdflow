// Mock "AI" control-room copilot. Answers are generated from the live
// simulation with deterministic rules, then written up in natural language.

import { clockLabel, GATES, NODE_MAP, ZONES } from "./venue";
import {
  density,
  detectBottlenecks,
  inside,
  predictRisks,
  queued,
  recommendations,
  routeBetween,
  type SimParams,
  type SimState,
} from "./sim";

export interface CopilotAnswer {
  text: string;
  facts: { label: string; value: string }[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const num = (n: number) => Math.round(n).toLocaleString();

export const SUGGESTED_QUESTIONS = [
  "Where is it worst right now?",
  "Which gate has the longest wait?",
  "What will go wrong in the next 30 minutes?",
  "How long to clear the venue?",
  "What should I do first?",
  "Which zones are still quiet?",
];

export function askCopilot(
  question: string,
  state: SimState,
  params: SimParams,
): CopilotAnswer {
  const q = question.toLowerCase();
  const bns = detectBottlenecks(state, params);
  const zonesByDensity = ZONES.map((z) => ({ z, d: density(state, z.id) })).sort(
    (a, b) => b.d - a.d,
  );

  if (/quiet|empty|space|spare|capacity/.test(q)) {
    const quiet = zonesByDensity.slice(-3).reverse();
    return {
      text: `There is still headroom in ${quiet
        .map((x) => `${x.z.name} (${pct(x.d)})`)
        .join(", ")}. Signage and app nudges should point spectators there — together they can absorb roughly ${num(
        quiet.reduce((s, x) => s + x.z.capacity * (1 - x.d), 0),
      )} more people comfortably.`,
      facts: quiet.map((x) => ({ label: x.z.name, value: pct(x.d) })),
    };
  }

  if (/gate|queue|wait|entry|entrance/.test(q)) {
    const worst = GATES.map((g) => ({
      g,
      q: state.queues[g.id] ?? 0,
      wait: (state.queues[g.id] ?? 0) / ((g.capacity / 35) * params.staffing * params.flowRate),
    })).sort((a, b) => b.wait - a.wait);
    const top = worst[0]!;
    const best = worst[worst.length - 1]!;
    return {
      text: `${top.g.name} has the longest wait at about ${Math.round(top.wait)} minutes with ${num(
        top.q,
      )} people queueing. ${best.g.name} is the quietest at ~${Math.round(
        best.wait,
      )} min. Divert arrivals from ${top.g.name} to ${best.g.name} and open two extra scanning lanes.`,
      facts: worst
        .slice(0, 4)
        .map((w) => ({ label: w.g.name, value: `${Math.round(w.wait)} min · ${num(w.q)} waiting` })),
    };
  }

  if (/next|predict|forecast|about to|going to|30|risk/.test(q)) {
    const risks = predictRisks(state, params, 40);
    if (!risks.length)
      return {
        text: "No zone is forecast to pass 70% density in the next 40 minutes. Current mitigations are holding.",
        facts: [{ label: "Horizon", value: "40 min" }],
      };
    return {
      text: `Expect pressure at ${risks
        .slice(0, 3)
        .map((r) => `${r.name} (peaks ${pct(r.peak)} around ${clockLabel(state.t + r.atMinute)})`)
        .join(", ")}. Start diverting now — acting 10 minutes early roughly halves the peak.`,
      facts: risks.slice(0, 4).map((r) => ({
        label: r.name,
        value: `${pct(r.peak)} @ ${clockLabel(state.t + r.atMinute)}`,
      })),
    };
  }

  if (/evac|clear|exit|emergency|leave/.test(q)) {
    const people = inside(state);
    const rate = GATES.reduce((s, g) => s + (g.capacity / 12) * params.staffing, 0);
    return {
      text: `There are ${num(people)} people inside. With every gate in free-flow egress mode the venue clears at about ${num(
        rate,
      )} people per minute, so a full evacuation takes roughly ${Math.round(
        people / rate + 6,
      )} minutes including walking time. Check the Evacuation page for the per-exit plan.`,
      facts: [
        { label: "Inside", value: num(people) },
        { label: "Egress rate", value: `${num(rate)}/min` },
      ],
    };
  }

  if (/do|action|recommend|fix|first|advice/.test(q)) {
    const recs = recommendations(state, params).slice(0, 3);
    if (!recs.length)
      return { text: "Nothing needs action — every zone, walkway and gate is inside its safe band.", facts: [] };
    return {
      text: `Priority order: ${recs
        .map((r, i) => `${i + 1}. ${r.title} (${r.impact})`)
        .join("; ")}. Apply them from the Alerts page and the rerouting engine will update guidance immediately.`,
      facts: recs.map((r) => ({ label: r.title, value: r.impact })),
    };
  }

  if (/route|path|way|walk|from|to/.test(q)) {
    const hot = zonesByDensity[0]!;
    const cool = zonesByDensity[zonesByDensity.length - 1]!;
    const r = routeBetween(state, params, hot.z.id, cool.z.id);
    return {
      text: `To relieve ${hot.z.name}, the optimiser routes people to ${cool.z.name} via ${r.optimised.path
        .map((p) => NODE_MAP[p]?.name ?? p)
        .join(" → ")} — ${r.optimised.minutes.toFixed(
        1,
      )} min versus ${r.direct.minutes.toFixed(1)} min on the shortest but busier line.`,
      facts: [
        { label: "Optimised", value: `${r.optimised.minutes.toFixed(1)} min` },
        { label: "Shortest", value: `${r.direct.minutes.toFixed(1)} min` },
      ],
    };
  }

  const worst = bns[0];
  return {
    text: worst
      ? `The hottest point right now is ${worst.name} — ${worst.detail}. Overall ${num(
          inside(state),
        )} people are inside and ${num(queued(state))} are still queueing at the gates. ${
          bns.filter((b) => b.severity === "critical").length
        } critical and ${bns.filter((b) => b.severity === "warning").length} warning conditions are open.`
      : `Everything is inside safe limits. ${num(inside(state))} people inside, ${num(
          queued(state),
        )} queueing at gates.`,
    facts: zonesByDensity.slice(0, 4).map((x) => ({ label: x.z.name, value: pct(x.d) })),
  };
}

/** Shift-briefing paragraph the control room can read aloud. */
export function briefing(state: SimState, params: SimParams) {
  const bns = detectBottlenecks(state, params);
  const risks = predictRisks(state, params, 45);
  const crit = bns.filter((b) => b.severity === "critical");
  return [
    `${clockLabel(state.t)} — ${num(inside(state))} spectators inside, ${num(queued(state))} at the gates.`,
    crit.length
      ? `${crit.length} critical hotspot${crit.length > 1 ? "s" : ""}: ${crit.map((c) => c.name).join(", ")}.`
      : `No critical hotspots; ${bns.length} areas being watched.`,
    risks.length
      ? `Forecast: ${risks[0]!.name} peaks at ${pct(risks[0]!.peak)} around ${clockLabel(
          state.t + risks[0]!.atMinute,
        )}.`
      : `Forecast is clear for the next 45 minutes.`,
    params.reroutingEnabled
      ? `Adaptive rerouting is ON — guidance is already steering arrivals away from the hot side.`
      : `Adaptive rerouting is OFF — turn it on to spread the load.`,
  ].join(" ");
}
