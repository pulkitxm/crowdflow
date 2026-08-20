/**
 * Console bootstrap.
 *
 * Order matters here. The socket's hello frame names the circuit and carries the
 * standards registry, so geometry is fetched *after* connecting rather than
 * guessed at load: the console never assumes which venue it is looking at.
 *
 * Until the geometry arrives the panels render with zone ids instead of names —
 * degraded, honest, and still usable — rather than waiting on a blank screen.
 */
import "./style.css";
import type { SessionInfo, SocketFrame, StandardsReport, TickEnvelope, VenueGeometry } from "@crowdflow/api/wire";
import { ConsoleLink, control, fetchGeometry, fetchLive } from "./client";
import type { LinkState } from "./client";
import { must } from "./dom";
import { ZoneMemory, buildRows } from "./model";
import type { ZoneRow } from "./model";
import { FeedPanel } from "./panels/feed";
import { HeaderPanel } from "./panels/header";
import { InterventionPanel } from "./panels/intervention";
import { LivePanel } from "./panels/live";
import { MapPanel } from "./panels/map";
import { MetricsStrip } from "./panels/metrics";
import { PredictionPanel } from "./panels/prediction";
import { ZoneTable } from "./panels/table";

const memory = new ZoneMemory();

let geometry: VenueGeometry | null = null;
let standards: StandardsReport | null = null;
let latest: TickEnvelope | null = null;
let latestSession: SessionInfo | null = null;
let selected: string | null = null;
let sessionId: string | null = null;

const link = new ConsoleLink({
  onFrame: (frame) => handleFrame(frame),
  onLink: (state, detail) => header.setLink(state as LinkState, detail),
});

const header = new HeaderPanel(
  must("header"),
  (action, speed) => {
    control(action, speed).then(
      (info) => header.setSession(info),
      (error) => console.error("control failed", error),
    );
  },
  () => link.secondsSinceFrame(),
);

const map = new MapPanel(
  must<HTMLCanvasElement>("map-canvas"),
  must("map-readout"),
  must("map-legend"),
  (zoneId) => select(zoneId),
);

const table = new ZoneTable(must("zones-body"), must("zones-tools"), (zoneId) => select(zoneId));
table.onResort(() => {
  if (latest) redraw(latest);
});

const prediction = new PredictionPanel(must("prediction-body"), must("prediction-model"));
const intervention = new InterventionPanel(must("intervention-body"), must("intervention-status"));
const feed = new FeedPanel(must("feed-body"), must("feed-count"));
const metrics = new MetricsStrip(must("metrics"));
const live = new LivePanel(must("live-body"), must("live-status"));

const fitButton = document.createElement("button");
fitButton.type = "button";
fitButton.className = "tool";
fitButton.textContent = "FIT";
fitButton.addEventListener("click", () => map.fit());
must("map-controls").append(fitButton);

function zoneName(id: string): string {
  return geometry?.pack.zones?.[id]?.name ?? id;
}

function select(zoneId: string | null): void {
  selected = zoneId;
  map.setSelected(zoneId);
  table.setSelected(zoneId);
}

function redraw(envelope: TickEnvelope): void {
  const rows: ZoneRow[] = buildRows(envelope, geometry, memory);
  const byId = new Map(rows.map((row) => [row.id, row]));
  map.update(envelope, rows);
  table.update(envelope, rows);
  table.setSelected(selected);
  prediction.update(envelope, byId, zoneName);
  intervention.update(envelope, zoneName);
  if (latestSession) metrics.update(envelope, latestSession);
}

async function loadGeometry(circuitId: string): Promise<void> {
  try {
    geometry = await fetchGeometry(circuitId);
    must("map-circuit").textContent =
      `${geometry.pack.name.toUpperCase()} · ${Object.keys(geometry.pack.zones ?? {}).length} ZONES · ` +
      `${Object.keys(geometry.pack.edges ?? {}).length} EDGES`;
    map.setGeometry(geometry, standards);
    if ((geometry.integrity_problems ?? []).length > 0) {
      // Shown, never swallowed: a console rendering a broken pack while looking
      // healthy is the failure this whole screen is built against.
      console.warn("pack integrity problems", geometry.integrity_problems ?? []);
    }
    if (latest) redraw(latest);
  } catch (error) {
    console.error("geometry unavailable", error);
    must("map-circuit").textContent = "GEOMETRY UNAVAILABLE";
  }
}

function handleFrame(frame: SocketFrame): void {
  latestSession = frame.session;
  header.setSession(frame.session);

  if (frame.type === "hello") {
    if (frame.standards) standards = frame.standards;
    // A new session id means a different run: history from the old one would be
    // a lie about this one.
    if (sessionId !== frame.session.session_id) {
      sessionId = frame.session.session_id;
      feed.reset();
    }
    feed.append(frame.backlog ?? []);
    void loadGeometry(frame.session.circuit_id);
    if (frame.last_tick) {
      memory.observe(frame.last_tick);
      latest = frame.last_tick;
      redraw(frame.last_tick);
    }
    return;
  }

  if (frame.type === "tick" && frame.tick) {
    memory.observe(frame.tick);
    latest = frame.tick;
    feed.append(frame.tick.events ?? []);
    redraw(frame.tick);
  }
}

/**
 * The live phone feed, polled.
 *
 * Deliberately not on the WebSocket. That socket belongs to a scenario session,
 * and live ingest exists independently of one — a venue with handsets reporting
 * must be watchable without somebody starting a simulation of it. Once a second
 * is well inside the cadence a crowd changes at, and the polling loop keeps
 * running while the socket is down, which is exactly when an operator most needs
 * to know whether the phones are still talking.
 */
const LIVE_POLL_MS = 1000;

async function pollLive(): Promise<void> {
  try {
    const snapshot = await fetchLive();
    if (snapshot) live.update(snapshot);
    else live.setIdle();
  } catch (error) {
    live.setProblem(error instanceof Error ? error.message : "the live feed could not be read");
  }
}

live.setIdle();
void pollLive();
setInterval(() => void pollLive(), LIVE_POLL_MS);

link.connect();
