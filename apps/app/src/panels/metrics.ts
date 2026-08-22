/**
 * The metrics strip.
 *
 * These are the A/B harness's definitions, unaltered — the same numbers the
 * Phase 3 gate is judged on. That matters more than it looks: a console with its
 * own softer definition of "time beyond capacity" would let a run look good on
 * the wall and fail the harness, and the wall is what people remember.
 *
 * Peak density and critical zone-seconds sit first because they are the pair the
 * gate requires to move together. Shaving the peak while extending the jam is
 * not an improvement, and the strip is arranged so that trade is visible.
 */
import type { SessionInfo, TickEnvelope } from "@crowdflow/contracts/wire";
import { clear, el } from "../dom";
import { fixed, integer, milliseconds, percent } from "../format";

interface Metric {
  label: string;
  value: string;
  unit?: string;
  title: string;
  tone?: string;
}

const GROUPS: Array<{ label: string; members: string[] }> = [
  { label: "Crowd", members: ["Peak density", "Critical", "Building", "Peak crit zones", "Peak queued"] },
  { label: "Journey", members: ["Arrived", "Active", "Mean walk", "P95 walk"] },
  { label: "System", members: ["Dispatched", "Safety rejected", "Nodes", "Est. present", "Coverage", "Tick cost"] },
];

export class MetricsStrip {
  constructor(private readonly host: HTMLElement) {}

  update(envelope: TickEnvelope, session: SessionInfo): void {
    const m = envelope.metrics;
    const p = envelope.population;
    const c = envelope.coverage;
    // "Slow" is not a number typed here: a tick is slow when it took longer than
    // the wall-clock interval it was supposed to fit into, which is exactly when
    // the console starts falling behind the venue.
    const intervalMs = (session.tick_s * 1000) / Math.max(session.speed, 1e-6);

    const metrics: Metric[] = [
      {
        label: "Peak density",
        value: fixed(m.peak_density, 2),
        unit: "ped/m²",
        title: "highest density seen in any zone this run",
      },
      {
        label: "Critical",
        value: integer(m.critical_zone_seconds),
        unit: "zone·s",
        title: "total zone-seconds at or beyond capacity — the area under the problem",
        tone: m.critical_zone_seconds > 0 ? "crit" : undefined,
      },
      {
        label: "Building",
        value: integer(m.building_zone_seconds),
        unit: "zone·s",
        title: "zone-seconds in the intervention window",
      },
      {
        label: "Peak crit zones",
        value: integer(m.peak_critical_zones),
        unit: "zones",
        title: "most zones critical simultaneously",
      },
      {
        label: "Peak queued",
        value: integer(m.total_queue_peak),
        unit: "people",
        title: "people who did not fit at jam density — backed up behind",
      },
      {
        label: "Arrived",
        value: integer(p.arrived),
        unit: `of ${integer(p.total)}`,
        title: "simulation ground truth",
      },
      {
        label: "Active",
        value: integer(p.active),
        unit: "walking",
        title: "departed and not yet arrived",
      },
      {
        label: "Mean walk",
        value: integer(m.mean_walk_s),
        unit: "s",
        title: "mean journey time of everyone who has arrived",
      },
      {
        label: "P95 walk",
        value: integer(m.p95_walk_s),
        unit: "s",
        title: "the tail — the experience an intervention is most likely to worsen",
      },
      {
        label: "Dispatched",
        value: integer(m.interventions),
        unit: "cmds",
        title: "commands that passed safety and reached the mesh",
      },
      {
        label: "Safety rejected",
        value: integer(m.rejected_by_safety),
        unit: "cmds",
        title: "commands the safety engine refused — the agent recommends, it never acts",
        tone: m.rejected_by_safety > 0 ? "warn" : undefined,
      },
      {
        label: "Nodes",
        value: integer(p.observed_nodes),
        unit: "devices",
        title: "reporting devices — NOT people",
      },
      {
        label: "Est. present",
        value: integer(p.estimated_present),
        unit: "people",
        title: "devices scaled by the measured participation rate",
      },
      {
        label: "Coverage",
        value: percent(c.fraction_observed, 1),
        unit: `${integer(c.observed)}/${integer(c.zones_total)}`,
        title: "share of the whole venue observed this tick — not of the part that answered",
        tone: "info",
      },
      {
        label: "Tick cost",
        value: milliseconds(envelope.compute_ms),
        unit: `#${integer(envelope.tick)}`,
        title:
          "wall time this tick took to compute; highlighted once it exceeds the " +
          "tick interval, because from then on the screen is behind the venue",
        tone: envelope.compute_ms > intervalMs ? "warn" : undefined,
      },
    ];

    clear(this.host);
    const placed = new Set<string>();
    for (const group of GROUPS) {
      const members = metrics.filter((metric) => group.members.includes(metric.label));
      if (!members.length) continue;
      for (const metric of members) placed.add(metric.label);
      this.host.append(this.groupNode(group.label, members));
    }
    const rest = metrics.filter((metric) => !placed.has(metric.label));
    if (rest.length) this.host.append(this.groupNode("Other", rest));
  }

  private groupNode(label: string, members: Metric[]): HTMLElement {
    const group = el("div", { class: "metricgroup" }, el("span", { class: "metricgroup__label", text: label }));
    for (const metric of members) {
      group.append(
        el(
          "div",
          { class: `metric ${metric.tone ? `metric--${metric.tone}` : ""}`, title: metric.title },
          el("span", { class: "metric__label", text: metric.label }),
          el(
            "span",
            { class: "metric__value" },
            metric.value,
            metric.unit ? el("span", { class: "metric__unit", text: ` ${metric.unit}` }) : null,
          ),
        ),
      );
    }
    return group;
  }
}
