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
import type { LiveSnapshot, PeopleQueryResult, Position, SessionInfo, SocketFrame, StandardsReport, TickEnvelope, VenueGeometry } from "@crowdflow/api/wire";
import { ConsoleLink, control, fetchGeometry, fetchPeopleGrid } from "./client";
import type { LinkState } from "./client";
import { must } from "./dom";
import { readMapQuery, writeMapQuery, type Basemap, type CrowdLayer } from "./mapState";
import { ZoneMemory, buildRows } from "./model";
import type { ZoneRow } from "./model";
import { FeedPanel } from "./panels/feed";
import { HeaderPanel } from "./panels/header";
import { InterventionPanel } from "./panels/intervention";
import { LivePanel } from "./panels/live";
import { MapPanel } from "./panels/map";
import { MetricsStrip } from "./panels/metrics";
import { PredictionPanel } from "./panels/prediction";
import { SectorTable } from "./panels/table";

const memory = new ZoneMemory();

let geometry: VenueGeometry | null = null;
let standards: StandardsReport | null = null;
let latest: TickEnvelope | null = null;
let latestLive: LiveSnapshot | null = null;
let latestSession: SessionInfo | null = null;
let selected: string | null = null;
let sessionId: string | null = null;
let gridRequest = 0;
let sectorGridRequest = 0;
let sectorGrid: PeopleQueryResult | null = null;
let cohortRefreshTimer: number | null = null;
let cohortViewport: { coordinates: Position[]; zoom: number } | null = null;
let mapState = readMapQuery(window.location.search);
document.documentElement.dataset.theme = mapState.theme;

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
  (coordinates, zoom) => persistMapViewport(coordinates, zoom),
);
map.setOrientation(mapState.rotation);
map.setKindView(mapState.layer === "kinds");
map.setGridVisible(mapState.grid);
map.setCrowdMode(mapState.crowd);
map.setSectorVisible(mapState.sectors);
map.setBasemap(mapState.basemap);
map.setTheme(mapState.theme);

const table = new SectorTable(must("zones-body"), must("zones-tools"), (zoneId) => focusSector(zoneId));
table.onResort(() => {
  if (latestLive && geometry) map.setSectors(table.update(latestLive, geometry, sectorGrid));
});

const prediction = new PredictionPanel(must("prediction-body"), must("prediction-model"));
const intervention = new InterventionPanel(must("intervention-body"), must("intervention-status"));
const feed = new FeedPanel(must("feed-body"), must("feed-count"));
const metrics = new MetricsStrip(must("metrics"));
const live = new LivePanel(must("live-body"), must("live-status"));

const mapControls = must("map-controls");
const consoleElement = must("console");
const attribution = must("map-attribution");
consoleElement.classList.toggle("console--map-focus", mapState.full);
attribution.classList.toggle("map__attribution--visible", mapState.basemap === "satellite");

const zoomControls = document.createElement("div");
zoomControls.className = "zoom-tools";
const zoomValue = document.createElement("output");
zoomValue.className = "zoom-tools__value";
zoomValue.setAttribute("aria-label", "Map zoom scale");
const updateZoomValue = () => { zoomValue.textContent = `${map.zoomRatio.toFixed(1)}×`; };
must("map-canvas").addEventListener("mapzoom", updateZoomValue);
const zoomOutButton = document.createElement("button");
zoomOutButton.type = "button";
zoomOutButton.className = "tool zoom-tools__button";
zoomOutButton.textContent = "−";
zoomOutButton.title = "Zoom out";
zoomOutButton.setAttribute("aria-label", "Zoom out");
zoomOutButton.addEventListener("click", () => { map.zoomBy(1 / 1.5); });
const zoomInButton = document.createElement("button");
zoomInButton.type = "button";
zoomInButton.className = "tool zoom-tools__button";
zoomInButton.textContent = "+";
zoomInButton.title = "Zoom in";
zoomInButton.setAttribute("aria-label", "Zoom in");
zoomInButton.addEventListener("click", () => { map.zoomBy(1.5); });
zoomControls.append(zoomValue, zoomOutButton, zoomInButton);
mapControls.append(zoomControls);

const portraitButton = document.createElement("button");
portraitButton.type = "button";
portraitButton.className = "tool";
portraitButton.title = "Toggle between landscape and portrait view";
portraitButton.addEventListener("click", () => {
  const isPortrait = map.togglePortrait();
  updateZoomValue();
  portraitButton.classList.toggle("tool--on", isPortrait);
  portraitButton.textContent = isPortrait ? "LANDSCAPE" : "PORTRAIT";
});
const initialPortrait = map.orientationDeg === 90 || map.orientationDeg === 270;
portraitButton.classList.toggle("tool--on", initialPortrait);
portraitButton.textContent = initialPortrait ? "LANDSCAPE" : "PORTRAIT";
mapControls.append(portraitButton);

const rotateButton = document.createElement("button");
rotateButton.type = "button";
rotateButton.className = "tool";
rotateButton.textContent = "ROTATE";
rotateButton.title = "Rotate circuit 90°";
rotateButton.addEventListener("click", () => {
  const deg = map.rotate90();
  updateZoomValue();
  portraitButton.classList.toggle("tool--on", deg === 90 || deg === 270);
  portraitButton.textContent = (deg === 90 || deg === 270) ? "LANDSCAPE" : "PORTRAIT";
});
mapControls.append(rotateButton);

const basemapView = document.createElement("label");
basemapView.className = "crowd-view";
basemapView.append("MAP");
const basemapSelect = document.createElement("select");
basemapSelect.className = "crowd-view__select crowd-view__select--map";
basemapSelect.setAttribute("aria-label", "Map background");
for (const [value, label] of [["schematic", "SCHEMATIC"], ["satellite", "SATELLITE"]] as const) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  basemapSelect.append(option);
}
basemapSelect.value = map.basemapMode;
basemapSelect.addEventListener("change", () => {
  const basemap = map.setBasemap(basemapSelect.value as Basemap);
  attribution.classList.toggle("map__attribution--visible", basemap === "satellite");
  persistMapControls();
});
basemapView.append(basemapSelect);
mapControls.append(basemapView);

const themeButton = document.createElement("button");
themeButton.type = "button";
themeButton.className = "tool";
themeButton.title = "Switch between dark and light mode";
const updateThemeButton = () => {
  const isLight = map.themeMode === "light";
  themeButton.classList.toggle("tool--on", isLight);
  themeButton.setAttribute("aria-pressed", String(isLight));
  themeButton.textContent = isLight ? "LIGHT" : "DARK";
};
themeButton.addEventListener("click", () => {
  const theme = map.setTheme(map.themeMode === "light" ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  updateThemeButton();
  persistMapControls();
});
updateThemeButton();
mapControls.append(themeButton);

const kindButton = document.createElement("button");
kindButton.type = "button";
kindButton.className = "tool";
kindButton.textContent = "ZONE KINDS";
kindButton.title = "Toggle between live state and how zones are categorised";
kindButton.addEventListener("click", () => {
  const showingKinds = map.toggleKindView();
  kindButton.classList.toggle("tool--on", showingKinds);
  kindButton.textContent = showingKinds ? "LIVE STATE" : "ZONE KINDS";
  persistMapControls();
});
kindButton.classList.toggle("tool--on", map.kindView);
kindButton.textContent = map.kindView ? "LIVE STATE" : "ZONE KINDS";
mapControls.append(kindButton);

const gridButton = document.createElement("button");
gridButton.type = "button";
gridButton.className = "tool";
gridButton.title = "Show or hide the adaptive people grid";
const updateGridButton = () => {
  gridButton.classList.toggle("tool--on", map.gridVisible);
  gridButton.textContent = map.gridVisible ? "GRID ON" : "GRID OFF";
};
gridButton.addEventListener("click", () => {
  map.setGridVisible(!map.gridVisible);
  updateGridButton();
  persistMapControls();
});
updateGridButton();
mapControls.append(gridButton);

const crowdView = document.createElement("label");
crowdView.className = "crowd-view";
crowdView.append("CROWD VIEW");
const crowdSelect = document.createElement("select");
crowdSelect.className = "crowd-view__select";
crowdSelect.setAttribute("aria-label", "Crowd view");
for (const [value, label] of [["none", "NO VIEW"], ["cohorts", "COHORT VIEW"], ["heatmap", "HEAT MAP VIEW"]] as const) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  crowdSelect.append(option);
}
crowdSelect.value = map.crowdMode;
crowdSelect.addEventListener("change", () => {
  map.setCrowdMode(crowdSelect.value as CrowdLayer);
  persistMapControls();
});
crowdView.append(crowdSelect);
mapControls.append(crowdView);

const sectorButton = document.createElement("button");
sectorButton.type = "button";
sectorButton.className = "tool";
sectorButton.title = "Show or hide named circuit sectors and their live crowd";
const updateSectorButton = () => {
  sectorButton.classList.toggle("tool--on", map.sectorsVisible);
  sectorButton.textContent = map.sectorsVisible ? "SECTORS ON" : "SECTORS OFF";
};
sectorButton.addEventListener("click", () => {
  map.setSectorVisible(!map.sectorsVisible);
  updateSectorButton();
  persistMapControls();
});
updateSectorButton();
mapControls.append(sectorButton);

const fitButton = document.createElement("button");
fitButton.type = "button";
fitButton.className = "tool";
fitButton.textContent = "FIT";
fitButton.addEventListener("click", () => { map.fit(); updateZoomValue(); });
mapControls.append(fitButton);

const focusButton = document.createElement("button");
focusButton.type = "button";
focusButton.className = "tool";
focusButton.title = "Toggle full map. Press Escape to exit.";
focusButton.setAttribute("aria-keyshortcuts", "Escape");
focusButton.classList.toggle("tool--on", mapState.full);
focusButton.textContent = mapState.full ? "EXIT FULL" : "FULL MAP";
focusButton.addEventListener("click", () => {
  setMapFocused(!consoleElement.classList.contains("console--map-focus"));
  persistMapControls();
});
mapControls.append(focusButton);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !consoleElement.classList.contains("console--map-focus")) return;
  event.preventDefault();
  setMapFocused(false);
  persistMapControls();
});
updateZoomValue();

function setMapFocused(focused: boolean): void {
  consoleElement.classList.toggle("console--map-focus", focused);
  focusButton.classList.toggle("tool--on", focused);
  focusButton.textContent = focused ? "EXIT FULL" : "FULL MAP";
}

function zoneName(id: string): string {
  return geometry?.pack.zones?.[id]?.name ?? id;
}

function select(zoneId: string | null): void {
  selected = zoneId;
  map.setSelected(zoneId);
  table.setSelected(zoneId);
}

function focusSector(sectorId: string): void {
  select(sectorId);
  setMapFocused(true);
  persistMapControls();
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => map.focusSector(sectorId));
  });
}

function persistMapViewport(coordinates: Position[], zoom: number): void {
  cohortViewport = { coordinates, zoom };
  const center = coordinates.reduce(
    (total, position) => ({ x: total.x + position.x / coordinates.length, y: total.y + position.y / coordinates.length }),
    { x: 0, y: 0 },
  );
  mapState = { ...mapState, zoom, center };
  updateZoomValue();
  persistMapControls();
  void loadGrid(coordinates, zoom);
}

function scheduleCohortRefresh(): void {
  if (cohortRefreshTimer != null) window.clearTimeout(cohortRefreshTimer);
  cohortRefreshTimer = window.setTimeout(() => {
    cohortRefreshTimer = null;
    const viewport = cohortViewport;
    if (viewport) void loadGrid(viewport.coordinates, viewport.zoom);
    void loadSectorGrid();
  }, 250);
}

function persistMapControls(): void {
  mapState = {
    ...mapState,
    full: consoleElement.classList.contains("console--map-focus"),
    rotation: map.orientationDeg,
    layer: map.kindView ? "kinds" : "live",
    grid: map.gridVisible,
    crowd: map.crowdMode,
    sectors: map.sectorsVisible,
    basemap: map.basemapMode,
    theme: map.themeMode,
  };
  const search = writeMapQuery(window.location.search, mapState);
  window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
}

function redraw(envelope: TickEnvelope): void {
  const rows: ZoneRow[] = buildRows(envelope, geometry, memory);
  const byId = new Map(rows.map((row) => [row.id, row]));
  map.update(envelope, rows);
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
    map.restoreView(mapState.zoom, mapState.center);
    if (latestLive) map.setSectors(table.update(latestLive, geometry, sectorGrid));
    void loadSectorGrid();
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

async function loadSectorGrid(): Promise<void> {
  const circuitId = latestSession?.circuit_id;
  const venue = geometry;
  if (!circuitId || !venue) return;
  const request = ++sectorGridRequest;
  const bounds = venue.pack.frame.venue_bounds_m;
  const minX = Number(bounds[0]);
  const minY = Number(bounds[1]);
  const maxX = Number(bounds[2]);
  const maxY = Number(bounds[3]);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;
  const coordinates = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  try {
    const result = await fetchPeopleGrid(circuitId, coordinates, 1);
    if (request !== sectorGridRequest) return;
    sectorGrid = result;
    if (latestLive) map.setSectors(table.update(latestLive, venue, result));
  } catch (error) {
    console.error("sector crowd unavailable", error);
  }
}

async function loadGrid(coordinates: Position[], zoom: number): Promise<void> {
  const circuitId = latestSession?.circuit_id;
  if (!circuitId) return;
  const request = ++gridRequest;
  try {
    const result = await fetchPeopleGrid(circuitId, coordinates, zoom);
    if (request === gridRequest) map.setGrid(result);
  } catch (error) {
    console.error("grid unavailable", error);
  }
}

function handleFrame(frame: SocketFrame): void {
  latestSession = frame.session;
  header.setSession(frame.session);
  if (frame.live) {
    latestLive = frame.live;
    live.update(frame.live);
    map.updateLive(frame.live);
    if (geometry) map.setSectors(table.update(frame.live, geometry, sectorGrid));
    scheduleCohortRefresh();
  }

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
live.setIdle();

link.connect();
