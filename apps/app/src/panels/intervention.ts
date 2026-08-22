/**
 * The intervention panel — the argument, not the answer.
 *
 * Every option the engine simulated is listed, rejected ones included, with what
 * each would have cost. A recommendation shown alone is an assertion the
 * operator can only accept or ignore; shown beside the four alternatives it beat
 * and the do-nothing baseline it was scored against, it becomes something that
 * can be disagreed with — which is the only useful thing to hand someone who is
 * accountable for the decision.
 *
 * The do-nothing baseline is never hidden or styled as a non-option. It is the
 * candidate the others have to beat, and sometimes it wins; when it does, the
 * panel says so in words.
 *
 * Below the options: the command that was actually written and the safety
 * verdict on it. The agent recommends, the safety engine decides, and nothing
 * reaches the mesh without a verdict — so a command with no verdict beside it
 * is drawn as pending, never as sent.
 */
import type { InterventionCandidate } from "@crowdflow/contracts";
import type { TickEnvelope } from "@crowdflow/contracts/wire";
import { clear, el } from "../dom";
import { fixed, integer, percent, signed } from "../format";

export class InterventionPanel {
  private lastWithCandidates: TickEnvelope | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly status: HTMLElement,
  ) {}

  update(envelope: TickEnvelope, name: (id: string) => string): void {
    // An intervention sweep runs occasionally, not every tick. Holding the last
    // one on screen — with its age — beats blanking the panel between sweeps,
    // which would read as "no options considered".
    if (envelope.candidates && envelope.candidates.length > 0) {
      this.lastWithCandidates = envelope;
    }
    const source = this.lastWithCandidates;

    clear(this.status);
    if (!source) {
      // Careful with this wording. Sweeps that happened before this console
      // connected are not replayed, and claiming "nothing has been evaluated"
      // while the metrics strip shows two dispatched commands would make the
      // screen contradict itself. Say what is actually known.
      const dispatched = envelope.metrics.interventions;
      const rejected = envelope.metrics.rejected_by_safety;
      this.status.append(el("span", { class: "tool tool--static", text: "NO SWEEP YET" }));
      const host = clear(this.host);
      host.append(
        el("div", {
          class: "empty",
          text:
            "No options have been evaluated since this console connected. The loop " +
            "sweeps only when a forecast clears the actionable bar.",
        }),
      );
      if (dispatched > 0 || rejected > 0) {
        host.append(
          el("div", {
            class: "note",
            text:
              `Earlier in this run: ${dispatched} command(s) dispatched, ` +
              `${rejected} rejected by safety. Option tables from those sweeps ` +
              `were not replayed to this console.`,
          }),
        );
      }
      return;
    }

    const ageTicks = envelope.tick - source.tick;
    this.status.append(
      el("span", {
        class: "tool tool--static",
        text: ageTicks === 0 ? "THIS TICK" : `SWEEP t=${Math.round(source.time_s)}s`,
      }),
      el("span", {
        class: "tool tool--static",
        text: `${(source.candidates ?? []).length} OPTIONS`,
      }),
    );

    clear(this.host);
    const candidates = [...(source.candidates ?? [])].sort(
      (a, b) => a.divert_fraction - b.divert_fraction,
    );
    const selected = candidates.find((c) => c.selected) ?? null;
    const baseline = candidates.find((c) => c.divert_fraction === 0) ?? null;

    this.host.append(
      el(
        "div",
        { class: `verdictline ${selected ? "verdictline--act" : "verdictline--hold"}` },
        el("span", {
          class: "verdictline__word",
          text: selected ? "RECOMMENDED" : "DO NOTHING",
        }),
        el("span", {
          class: "verdictline__text",
          text: selected
            ? selected.description
            : "no option beat the do-nothing baseline; the engine declined to intervene",
        }),
      ),
    );

    const table = el("table", { class: "mini mini--wide" });
    table.append(
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { text: "" }),
          el("th", { text: "OPTION" }),
          el("th", { class: "num", title: "share of walkers diverted", text: "DIVERT" }),
          el("th", { class: "num", title: "projected peak density, ped/m²", text: "PEAK" }),
          el("th", { class: "num", title: "added mean walking time", text: "Δ WALK" }),
          el("th", { class: "num", title: "seconds spent beyond capacity", text: "OVER CAP" }),
          el("th", { class: "num", title: "peak reduction vs baseline, %", text: "RELIEF" }),
          el("th", { class: "num", title: "walk-time penalty in score points", text: "COST" }),
          el("th", { class: "num", title: "headroom + safety + fairness", text: "MARGIN" }),
          el("th", { class: "num", text: "SCORE" }),
        ),
      ),
    );
    const body = el("tbody");
    for (const candidate of candidates) {
      body.append(this.renderCandidate(candidate, baseline));
    }
    table.append(body);
    this.host.append(table);

    const command = source.command;
    const verdict = source.verdict;
    if (!command) {
      this.host.append(
        el("div", {
          class: "note",
          text: "No command was written — nothing reached the safety engine, and nothing reached the mesh.",
        }),
      );
      return;
    }

    this.host.append(
      el(
        "div",
        { class: "command" },
        el(
          "div",
          { class: "command__head" },
          el("span", { class: "command__word", text: "COMMAND" }),
          el("span", { class: "command__id", text: command.command_id }),
          el("span", {
            class: `command__state command__state--${
              !verdict ? "pending" : verdict.outcome === "rejected" ? "rejected" : "approved"
            }`,
            text: !verdict
              ? "AWAITING SAFETY"
              : `SAFETY ${verdict.outcome.toUpperCase()}${source.dispatched ? " · DISPATCHED" : " · HELD"}`,
          }),
        ),
        el(
          "div",
          { class: "command__grid" },
          this.fact("FROM", name(command.source_zone)),
          this.fact("TO", name(command.destination_zone)),
          this.fact("TARGET SHARE", percent(command.target_fraction)),
          this.fact("HONEST COST", `${signed(command.expected_cost_s, 0)}s walk`),
          this.fact("AVOID", (command.avoid ?? []).map(name).join(", ") || "—"),
          this.fact("PREFER", (command.prefer ?? []).map(name).join(", ") || "—"),
          this.fact("EXPIRES", `t+${Math.round(command.expires_at - source.time_s)}s`),
          this.fact("REASON", command.reason),
        ),
        verdict &&
          el(
            "div",
            {
              class: `verdict verdict--${verdict.outcome}`,
            },
            el("span", { class: "verdict__word", text: verdict.outcome.toUpperCase() }),
            el("span", { class: "verdict__reason", text: verdict.reason }),
            (verdict.violated_constraints ?? []).length > 0 &&
              el("span", {
                class: "verdict__violations",
                text: `constraints: ${(verdict.violated_constraints ?? []).join(", ")}`,
              }),
            (verdict.unchecked_constraints ?? []).length > 0 &&
              el("span", {
                class: "verdict__unchecked",
                text: `NOT TESTED ${(verdict.unchecked_constraints ?? []).length}: ${(verdict.unchecked_constraints ?? []).join(", ")}`,
                title: "the pack does not declare the data these constraints need, so this approval did not clear them",
              }),
          ),
      ),
    );
  }

  private fact(label: string, value: string): HTMLElement {
    return el(
      "div",
      { class: "fact" },
      el("span", { class: "fact__label", text: label }),
      el("span", { class: "fact__value", text: value }),
    );
  }

  private renderCandidate(
    candidate: InterventionCandidate,
    baseline: InterventionCandidate | null,
  ): HTMLElement {
    const isBaseline = candidate.divert_fraction === 0;
    const isSelected = candidate.selected === true;
    const relief =
      baseline && baseline.projected_peak_density_persons_m2 > 0
        ? ((baseline.projected_peak_density_persons_m2 - candidate.projected_peak_density_persons_m2) /
            baseline.projected_peak_density_persons_m2) *
          100
        : null;
    const margin =
      candidate.score.capacity_headroom + candidate.score.safety_margin + candidate.score.fairness;

    return el(
      "tr",
      {
        class: `row ${isSelected ? "row--selected" : isBaseline ? "row--baseline" : "row--rejected"}`,
      },
      el(
        "td",
        {},
        el("span", {
          class: `pill pill--${isSelected ? "sel" : isBaseline ? "base" : "rej"}`,
          text: isSelected ? "SELECTED" : isBaseline ? "BASELINE" : "REJECTED",
        }),
      ),
      el("td", { text: candidate.description }),
      el("td", { class: "num", text: percent(candidate.divert_fraction) }),
      el("td", { class: "num", text: fixed(candidate.projected_peak_density_persons_m2, 2) }),
      el("td", { class: "num", text: `${signed(candidate.projected_walk_time_delta_s, 0)}s` }),
      el("td", { class: "num", text: `${integer(candidate.projected_bottleneck_duration_s)}s` }),
      el("td", { class: "num", text: relief === null ? "—" : `${signed(relief, 1)}%` }),
      el("td", { class: "num", text: fixed(candidate.score.walk_time_cost, 1) }),
      el("td", { class: "num", text: fixed(margin, 1) }),
      el("td", { class: "num num--score", text: signed(candidate.score.total, 1) }),
    );
  }
}
