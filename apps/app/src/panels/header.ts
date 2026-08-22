/**
 * The header strip: what is running, and whether what you are looking at is true.
 *
 * Two things live here that a screen like this usually leaves out.
 *
 * **The age of the picture.** A counter, driven by the console's own clock,
 * showing how long since the last frame arrived. It keeps counting when the
 * server stops, which is the point — a control-room screen showing a
 * four-minute-old venue with no indication of it is worse than one showing
 * nothing at all.
 *
 * **The run's parameters.** Seed, population, participation, compliance, tick
 * length, and whether intervention is enabled. All of it, always, because a
 * photograph of this strip has to be enough to reproduce the run, and because a
 * number derived from an 18% participation rate means something different from
 * the same number at 60%.
 */
import type { SessionInfo } from "@crowdflow/contracts/wire";
import type { LinkState } from "../client";
import { clear, el } from "../dom";
import { age, clock, integer, percent } from "../format";

const STATUS_WORD: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  paused: "Paused",
  finished: "Finished",
  starting: "Starting",
  stopping: "Stopping",
  completed: "Completed",
  failed: "Failed",
};

const LINK_WORD: Record<LinkState, string> = {
  connecting: "Connecting",
  live: "Live",
  waiting: "Waiting",
  down: "No link",
};

/** Wall-clock multipliers offered. 1x is real time; the rest exist because a
 *  1,800-second scenario is not a demo length. Not thresholds. */
const SPEEDS = [1, 2, 4, 8, 16];

export class HeaderPanel {
  private session: SessionInfo | null = null;
  private link: LinkState = "connecting";
  private linkDetail = "";

  constructor(
    private readonly host: HTMLElement,
    private readonly onControl: (action: string, speed?: number) => void,
    private readonly frameAge: () => number | null,
  ) {
    // The age counter must move even when nothing is arriving, so it is driven
    // by the console's clock rather than by the feed.
    setInterval(() => this.render(), 200);
  }

  setSession(session: SessionInfo | null): void {
    this.session = session;
    this.render();
  }

  setLink(state: LinkState, detail: string): void {
    this.link = state;
    this.linkDetail = detail;
    this.render();
  }

  private render(): void {
    const s = this.session;
    const since = this.frameAge();
    clear(this.host);

    const primary = el("div", { class: "cmd__primary" });
    const params = el("div", { class: "cmd__params" });

    primary.append(
      el(
        "div",
        { class: "brand" },
        el("span", { class: "brand__mark", text: "Crowdflow" }),
        el("span", { class: "brand__sub", text: "Operations" }),
      ),
    );

    const stat = (label: string, value: string, title: string, tone = "") =>
      el(
        "div",
        { class: `hstat ${tone}`, title },
        el("span", { class: "hstat__label", text: label }),
        el("span", { class: "hstat__value", text: value }),
      );

    const param = (label: string, value: string, title: string, tone = "") =>
      el(
        "div",
        { class: `param ${tone}`, title },
        el("span", { class: "param__label", text: label }),
        el("span", { class: "param__value", text: value }),
      );

    if (!s) {
      primary.append(stat("Session", "None", "no session started", "hstat--down"), this.linkNode(since));
      this.host.append(primary);
      return;
    }

    primary.append(
      stat(
        "Status",
        STATUS_WORD[s.status] ?? s.status,
        "run state",
        `hstat--${s.status}`,
      ),
      stat(
        "Clock",
        `${clock(s.time_s)} / ${clock(s.duration_s)}`,
        "simulation clock and scenario duration",
      ),
      this.linkNode(since),
    );

    params.append(
      param("Circuit", s.circuit_id, "circuit pack loaded"),
      param("Scenario", s.scenario, s.description),
      param("Tick", `#${integer(s.tick)}`, "ticks completed"),
      param("Seed", String(s.seed), "same seed, same run — every time"),
      param("Spectators", integer(s.population), "simulated population"),
      param(
        "Participation",
        percent(s.participation),
        "simulation input, not measured attendance; every population estimate is scaled by it",
        "param--assumed",
      ),
      param(
        "Compliance",
        percent(s.compliance),
        "share who act on a reroute — ASSUMED in core, not measured",
        "param--assumed",
      ),
      param(
        "Intervention",
        s.intervene ? "On" : "Off",
        "whether the loop is allowed to propose reroutes",
        s.intervene ? "" : "param--off",
      ),
    );

    const controls = el("div", { class: "controls" });
    const button = (label: string, action: string, active = false) => {
      const b = el("button", {
        class: `tool ${active ? "tool--on" : ""}`,
        type: "button",
        text: label,
      });
      b.addEventListener("click", () => this.onControl(action));
      return b;
    };
    controls.append(
      button("Play", "play", s.status === "running"),
      button("Pause", "pause", s.status === "paused"),
      button("Step", "step"),
    );
    for (const speed of SPEEDS) {
      const b = el("button", {
        class: `tool ${s.speed === speed ? "tool--on" : ""}`,
        type: "button",
        text: `${speed}x`,
        title: speed === 1 ? "real time" : `${speed} times real time`,
      });
      b.addEventListener("click", () => this.onControl("speed", speed));
      controls.append(b);
    }
    primary.append(controls);
    this.host.append(primary, params);
  }

  private linkNode(since: number | null): HTMLElement {
    const stale = since !== null && this.session !== null && since > this.staleAfter();
    const tone = this.link === "live" && !stale ? "ok" : this.link === "down" ? "down" : "warn";
    return el(
      "div",
      {
        class: `hstat hstat--link hstat--${tone}`,
        title: `${this.linkDetail} · counted by this console's own clock, so it keeps moving if the server stops`,
      },
      el("span", { class: "hstat__label", text: "Feed" }),
      el("span", {
        class: "hstat__value",
        text: `${LINK_WORD[this.link]} · ${age(since)}`,
      }),
    );
  }

  /** A picture is stale once it is older than two of the intervals it should be
   *  arriving on — derived from the session, never a typed number of seconds. */
  private staleAfter(): number {
    const s = this.session;
    if (!s) return Infinity;
    return (2 * s.tick_s) / Math.max(s.speed, 1e-6);
  }
}
