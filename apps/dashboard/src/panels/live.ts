/**
 * What real handsets are reporting.
 *
 * Everything else on this console is driven by a scenario session, where the
 * simulation knows the answer and the panels can compare an estimate against
 * ground truth. There is no ground truth here. So this panel is built around the
 * three questions an operator can actually act on when the data is coming from
 * phones:
 *
 *   HOW MANY, and how fresh. A count of dots with no age beside it is a
 *   photograph presented as a window. The age of the last accepted batch counts
 *   up in front of the operator whether or not anything is arriving, for the same
 *   reason the header's link age does.
 *
 *   OVER WHICH RADIO. A zone going quiet because everybody left and a zone going
 *   quiet because every phone in it dropped off Wi-Fi look identical without
 *   this. It is the difference between "the concourse cleared" and "we have
 *   stopped being able to see the concourse".
 *
 *   WHAT WAS REJECTED, and why. A silent drop is indistinguishable from a quiet
 *   venue, and the two call for opposite responses. "3,400 rejected" is not
 *   actionable; "3,400 rejected: position outside venue bounds" is a wrong
 *   circuit id in somebody's build.
 *
 * And one label that is not a metric: where the participation rate came from.
 * `estimated_population` is reporting devices divided by that rate, so it is the
 * most load-bearing number on the screen — and while it remains ASSUMED, the
 * panel says so next to the figure rather than in a footnote.
 */
import type { LiveSnapshot, PositionSource } from "@crowdflow/api/wire";
import { clear, el } from "../dom";
import { fixed, integer, percent } from "../format";

const RADIO_WORD: Record<PositionSource, string> = {
  wifi: "WI-FI",
  ble: "BLUETOOTH",
  gnss: "GPS",
  fused: "FUSED",
  dead_reckoning: "CARRIED",
};

export class LivePanel {
  constructor(
    private readonly body: HTMLElement,
    private readonly status: HTMLElement,
  ) {}

  /** Live ingest is not armed. Different from armed-and-empty, and drawn
   *  differently: one is a console watching a simulation, the other is a venue
   *  where nobody's phone is talking to us. */
  setIdle(): void {
    clear(this.status);
    this.status.append(el("span", { class: "tool tool--static", text: "NOT ARMED" }));
    clear(this.body);
    this.body.append(
      el("div", { class: "empty", text: "Live ingest is not running. Arm it with POST /api/live to accept handset reports." }),
    );
  }

  setProblem(detail: string): void {
    clear(this.status);
    this.status.append(el("span", { class: "tool tool--static", text: "LINK DOWN" }));
    clear(this.body);
    this.body.append(el("div", { class: "empty", text: detail }));
  }

  update(live: LiveSnapshot): void {
    clear(this.status);
    const age = live.last_report_age_s;
    // Stale is not a number typed here: a report older than the state engine's
    // window is a report that no longer contributes to any density on screen.
    const stale = age == null || age > live.window_s;
    this.status.append(
      el("span", {
        class: `tool tool--static ${stale ? "tool--stale" : ""}`,
        title: `a report older than the ${live.window_s}s counting window no longer contributes to any density on screen`,
        text: age == null
          ? "NO REPORTS YET"
          : `${stale ? "STALE" : "FRESH"} · LAST REPORT ${fixed(age, 1)}s AGO of ${live.window_s}s`,
      }),
    );

    clear(this.body);

    const zones = live.state.zones ?? {};
    const estimated = Object.values(zones).reduce((sum, zone) => sum + zone.estimated_population, 0);

    this.body.append(
      row("DEVICES REPORTING", integer(live.reporting_devices), "handsets in the reporting window — NOT people"),
      row(
        "ESTIMATED PRESENT",
        `${integer(estimated)}`,
        "reporting devices divided by the participation rate",
        `PARTICIPATION ${percent(live.participation, 0)} — ${live.participation_provenance.toUpperCase()}`,
        live.participation_provenance !== "measured",
      ),
      row(
        "ZONES OBSERVED",
        `${integer(live.coverage.observed)} / ${integer(live.coverage.zones_total)}`,
        "share of the whole venue seen by a handset — not of the part that answered",
        `${integer(live.coverage.unknown)} unknown, ${integer(live.coverage.silent)} silent`,
      ),
      row(
        "ACCEPTED",
        integer(live.accepted_total),
        "samples the venue took",
        live.rejected_total ? `${integer(live.rejected_total)} rejected` : undefined,
        live.rejected_total > 0,
      ),
    );

    const sources = Object.entries(live.by_source ?? {}).filter(([, count]) => (count ?? 0) > 0);
    this.body.append(
      el(
        "div",
        { class: "live__radios" },
        el("span", { class: "live__label", text: "BATCHES BY RADIO" }),
        ...(sources.length
          ? sources.map(([source, count]) =>
              el(
                "span",
                { class: "state state--info", title: `${count} batches placed by ${source}` },
                el("span", { class: "state__word", text: RADIO_WORD[source as PositionSource] ?? source.toUpperCase() }),
                el("span", { class: "state__value", text: integer(count ?? 0) }),
              ),
            )
          : [el("span", { class: "live__none", text: "none yet" })]),
      ),
    );

    const problems = Object.entries(live.problems ?? {});
    if (problems.length) {
      this.body.append(
        el(
          "div",
          { class: "live__problems" },
          el("span", { class: "live__label", text: "REJECTED, BY REASON" }),
          ...problems.map(([reason, count]) =>
            el("div", { class: "live__problem" }, el("span", { class: "live__count", text: integer(count) }), el("span", { text: reason })),
          ),
        ),
      );
    }
  }
}

function row(label: string, value: string, title: string, note?: string, warn = false): HTMLElement {
  return el(
    "div",
    { class: "live__row", title },
    el("span", { class: "live__label", text: label }),
    el("span", { class: "live__value", text: value }),
    note ? el("span", { class: `live__note ${warn ? "live__note--warn" : ""}`, text: note }) : null,
  );
}
