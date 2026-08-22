import "./style.css";
import type { RaceDayStatus } from "@crowdflow/api/wire";
import { clear, el, must } from "./dom";
import { integer } from "./format";

const POLL_MS = 1000;
const SPEEDS = [1, 30, 60, 120, 300, 600];

const FIELDS: Array<{ key: "population" | "speed" | "seed" | "participation" | "tick_s" | "intervene"; label: string; value: string; hint: string }> = [
  { key: "population", label: "SPECTATORS", value: "20000", hint: "how many people live the whole day" },
  { key: "speed", label: "SPEED", value: "120", hint: "simulated seconds per real second" },
  { key: "tick_s", label: "TICK", value: "10", hint: "simulated seconds per step — larger is faster and coarser" },
  { key: "participation", label: "PARTICIPATION", value: "1", hint: "share of spectators whose phone reports (0–1)" },
  { key: "seed", label: "SEED", value: "42", hint: "same seed, same day, every time" },
  { key: "intervene", label: "INTERVENE", value: "1", hint: "1 lets the control loop evaluate reroutes and fill the intervention panel; 0 disables it" },
];

let status: RaceDayStatus | null = null;
let busy = false;
let socketClock: number | null = null;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined
    ? {}
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

function hhmmss(secondOfDay: number): string {
  const day = 24 * 3600;
  const w = ((Math.round(secondOfDay) % day) + day) % day;
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(Math.floor(w / 3600))}:${pad(Math.floor(w / 60) % 60)}:${pad(w % 60)}`;
}

function hhmm(secondOfDay: number): string {
  const day = 24 * 3600;
  const wrapped = ((Math.round(secondOfDay) % day) + day) % day;
  return `${String(Math.floor(wrapped / 3600)).padStart(2, "0")}:${String(Math.floor(wrapped / 60) % 60).padStart(2, "0")}`;
}

function paintCommand(): void {
  const controls = clear(must("sim-controls"));
  const button = (label: string, title: string, onClick: () => void, on = false) => {
    const node = el("button", { class: `tool ${on ? "tool--on" : ""}`, type: "button", text: label, title });
    node.addEventListener("click", onClick);
    return node;
  };

  for (const field of FIELDS) {
    const input = el("input", {
      class: "sim__field", type: "number", value: field.value, title: field.hint,
      "aria-label": field.label, "data-key": field.key,
    });
    input.addEventListener("change", () => { field.value = input.value; });
    controls.append(el("label", { class: "crowd-view", title: field.hint }, el("span", { text: field.label }), input));
  }
  controls.append(
    button("START DAY", "build a fresh 24-hour race day from these settings", () => {
      const body: Record<string, number> = {};
      const flags: { intervene?: boolean } = {};
      for (const field of FIELDS) {
        const parsed = Number(field.value);
        if (!Number.isFinite(parsed)) continue;
        if (field.key === "intervene") flags.intervene = parsed !== 0;
        else body[field.key] = parsed;
      }
      void run(() => call<RaceDayStatus>("/api/raceday", { ...body, ...flags }));
    }),
  );
  if (!status) return;
  controls.append(
    button("PLAY", "advance the simulated day", () => { void run(() => call("/api/session/control", { action: "play" })); }),
    button("PAUSE", "hold the simulated clock", () => { void run(() => call("/api/session/control", { action: "pause" })); }),
    button("STEP", "advance a single tick", () => { void run(() => call("/api/session/control", { action: "step" })); }),
  );
  for (const speed of SPEEDS) {
    controls.append(button(`${speed}x`, `${speed} simulated seconds per real second`, () => {
      void run(() => call("/api/session/control", { action: "speed", speed }));
    }));
  }

  const params = clear(must("sim-params"));
  const param = (label: string, value: string, title: string, tone = "") =>
    el("div", { class: `param ${tone}`, title },
      el("span", { class: "param__label", text: label }),
      el("span", { class: "param__value", text: value }));
  params.append(
    param("EVENT", status.event_name.toUpperCase(), "from the committed season calendar"),
    param("DATE", status.date ?? "—", "race day"),
    param("VENUE OFFSET", status.utc_offset ?? "—", "the clock above is venue local time"),
    param("SPECTATORS", integer(status.population), "simulated population for the whole day"),
    param("RACE", `${hhmm(status.race_start_s)}–${hhmm(status.race_end_s)}`, "session times as committed", status.race_provenance === "measured" ? "" : "param--assumed"),
    param("SOURCE", status.race_provenance.toUpperCase(), "provenance of the race window", status.race_provenance === "measured" ? "" : "param--assumed"),
  );

  must("sim-clock").textContent = hhmmss(socketClock ?? status.clock_s);
  const current = status;
  const phase = current.phases.find((item) => item.id === current.current_phase_id);
  must("sim-phase").textContent = phase ? phase.name.toUpperCase() : "OFF PEAK";
}

function paintTimeline(): void {
  const host = clear(must("sim-timeline"));
  if (!status) {
    host.append(el("div", { class: "empty", text: "No race day is running. Start one to populate the checklist." }));
    return;
  }
  const done = status.phases.filter((phase) => phase.state === "done").length;
  clear(must("sim-timeline-tools")).append(
    el("span", { class: "tool tool--static", text: `${done}/${status.phases.length} COMPLETE` }),
  );
  for (const phase of status.phases) {
    host.append(
      el("div", { class: `phase phase--${phase.state}`, title: phase.source },
        el("span", { class: "phase__mark", text: phase.state === "done" ? "✓" : phase.state === "active" ? "▶" : "·" }),
        el("span", { class: "phase__time", text: `${hhmm(phase.start_s)}–${hhmm(phase.end_s)}` }),
        el("span", { class: "phase__name", text: phase.name }),
        el("span", { class: `phase__prov phase__prov--${phase.provenance}`, text: phase.provenance.toUpperCase() }),
        el("span", { class: "phase__effect", text: phase.crowd_effect }),
        phase.state === "active"
          ? el("span", { class: "phase__bar" }, el("span", { class: "phase__fill", style: `width: ${Math.max(0, Math.min(100, ((socketClock ?? status.clock_s) - phase.start_s) / Math.max(1, phase.end_s - phase.start_s) * 100)).toFixed(1)}%` }))
          : el("span", { text: "" }),
      ),
    );
  }
}

function paintCrowd(): void {
  const host = clear(must("sim-crowd"));
  if (!status) {
    host.append(el("div", { class: "empty", text: "Waiting for the first simulated tick…" }));
    return;
  }
  const crowd = status.crowd;
  const rows: Array<[string, number, string]> = [
    ["NOT YET ARRIVED", crowd.offsite, "still outside the venue, or in a car park queue"],
    ["WALKING", crowd.walking, "moving between zones right now"],
    ["SEATED OR HELD", crowd.dwelling, "in a grandstand, concourse or on the track walk"],
    ["DEPARTED", crowd.departed, "finished the whole day and left through a gate"],
  ];
  if (crowd.stranded > 0) rows.push(["STRANDED", crowd.stranded, "the router could not reach the next place on their plan, so the model stopped moving them; they are not departures"]);
  for (const [label, value, note] of rows) {
    const share = crowd.total ? (value / crowd.total) * 100 : 0;
    host.append(
      el("div", { class: "live__row", title: note },
        el("span", { class: "live__label", text: label }),
        el("span", { class: "live__value", text: integer(value) }),
        el("span", { class: "live__note", text: `${share.toFixed(1)}% of ${integer(crowd.total)}` }),
      ),
    );
  }
  for (const area of status.by_area) {
    const share = crowd.total ? (area.count / crowd.total) * 100 : 0;
    host.append(
      el("div", { class: "live__row", title: `people currently in zones of kind ${area.kind}` },
        el("span", { class: "live__label", text: `IN ${area.label}` }),
        el("span", { class: "live__value", text: integer(area.count) }),
        el("span", { class: "live__note", text: `${share.toFixed(1)}% of the day's ${integer(crowd.total)}` }),
      ),
    );
  }
  const dayWord = status.day_state === "complete" ? "DAY COMPLETE" : status.day_state === "pre_event" ? "BEFORE GATES" : "DAY RUNNING";
  clear(must("sim-crowd-tools")).append(
    el("span", { class: "tool tool--static", text: `ON SITE ${integer(crowd.walking + crowd.dwelling)}` }),
    el("span", { class: "tool tool--static", text: `CROWD ${status.crowd_source.toUpperCase()}` }),
    el("span", { class: `tool tool--static day--${status.day_state}`, text: dayWord, title: status.day_state === "complete" ? "the 24 hour day reached its end; every spectator has left, so all on-site counts are legitimately zero" : status.day_state === "pre_event" ? "the clock is before the first scheduled phase, so the venue is legitimately empty" : "phases are running" }),
  );
}

function paintAnomalies(): void {
  const host = clear(must("sim-anomalies"));
  if (!status) {
    host.append(el("div", { class: "empty", text: "Start a race day to arm anomaly injection." }));
    return;
  }
  const bar = el("div", { class: "anomaly__bar" });
  for (const entry of status.catalogue) {
    const node = el("button", { class: "tool anomaly__inject", type: "button", text: entry.label.toUpperCase(), title: entry.effect });
    node.addEventListener("click", () => { void run(() => call("/api/raceday/anomaly", { kind: entry.kind })); });
    bar.append(node);
  }
  host.append(bar);
  host.append(el("div", { class: "note", text: "Injected anomalies are invisible to the operator console: it sees the crowd behaviour they cause, never a label saying one was staged." }));

  if (!status.anomalies.length) {
    host.append(el("div", { class: "empty", text: "Nothing injected yet." }));
  }
  for (const anomaly of status.anomalies) {
    host.append(
      el("div", { class: "anomaly" },
        el("span", { class: "anomaly__word", text: anomaly.label.toUpperCase() }),
        el("span", { class: "anomaly__meta", text: ` at ${hhmm(anomaly.injected_at_s)} · ${integer(anomaly.affected_agents)} spectators affected${anomaly.duration_s ? ` · ${Math.round(anomaly.duration_s / 60)} min` : ""}` }),
        el("div", { class: "anomaly__effect", text: anomaly.effect }),
      ),
    );
  }
  clear(must("sim-anomaly-tools")).append(
    el("span", { class: "tool tool--static", text: `${status.anomalies.length} INJECTED` }),
  );
}

function paintRace(): void {
  const current = status;
  const host = clear(must("sim-race"));
  if (!current) return;
  const race = current.race;
  if (!race.running && !race.finished) {
    host.append(el("span", {
      class: "sim__lapnote",
      text: `Grand Prix starts at ${hhmm(current.race_start_s)} — ${race.total_laps} laps, ${race.lap_s}s reference lap`,
    }));
    return;
  }
  host.append(
    el("span", { class: "sim__lap", text: race.finished ? "RACE FINISHED" : `LAP ${race.lap} / ${race.total_laps}` }),
    el("span", {
      class: "sim__lapnote",
      text: `${race.cars.length} cars · leader ${(race.leader_lap_progress * 100).toFixed(0)}% through the lap · ${race.grid_note}`,
    }),
  );
  for (const car of race.cars.slice(0, 5)) {
    host.append(el("span", { class: "sim__lapnote", text: `P${car.position} ${car.label} +${car.gap_to_leader_s.toFixed(1)}s` }));
  }
}

function paint(): void {
  paintCommand();
  paintRace();
  paintTimeline();
  paintCrowd();
  paintAnomalies();
}

async function run(action: () => Promise<unknown>): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await action();
    await refresh();
  } catch (error) {
    console.error("simulator action failed", error);
  } finally {
    busy = false;
  }
}

async function refresh(): Promise<void> {
  try {
    status = await call<RaceDayStatus>("/api/raceday");
  } catch {
    status = null;
  }
  paint();
}

const themeButton = el("button", { class: "tool", type: "button", text: "DARK", title: "switch between dark and light" });
themeButton.addEventListener("click", () => {
  const light = document.documentElement.dataset.theme === "light";
  document.documentElement.dataset.theme = light ? "dark" : "light";
  themeButton.textContent = light ? "DARK" : "LIGHT";
  themeButton.classList.toggle("tool--on", !light);
});
const consoleLink = el("a", { class: "tool", href: "/", title: "open the operator console — it does not show anomaly controls", text: "OPERATOR CONSOLE" });
must("sim-actions").append(consoleLink, themeButton);

function openClockSocket(): void {
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket.onmessage = (event) => {
    const frame = JSON.parse(event.data as string) as { session?: { time_s?: number } };
    if (typeof frame.session?.time_s === "number") {
      socketClock = frame.session.time_s;
      if (status) must("sim-clock").textContent = hhmmss(socketClock);
    }
  };
  socket.onclose = () => { socketClock = null; window.setTimeout(openClockSocket, 1000); };
}
openClockSocket();

void refresh();
window.setInterval(() => { if (!busy) void refresh(); }, POLL_MS);
