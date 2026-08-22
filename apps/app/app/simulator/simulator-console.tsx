"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { CircuitSummary, HazardMode, HazardSeverity, HazardType, ScenarioOption, ScenarioSnapshot, SocketFrame, VenueGeometry } from "@crowdflow/contracts/wire";
import { acceptScenarioSnapshot } from "../../src/scenarioState";
import { DEFAULT_SIMULATOR_CONFIG, controlAvailability, hazardRequest, sessionRequest, type HazardDraft, type SimulatorConfigDraft } from "../../src/simulatorControl";
import { SimulatorHazardMap } from "./simulator-hazard-map";

type ActionState = { kind: "idle" | "pending" | "success" | "error"; message: string };

const LIFECYCLE_LABEL: Record<string, string> = { idle: "Idle", starting: "Starting", running: "Running", paused: "Paused", stopping: "Stopping", completed: "Completed", failed: "Failed" };

export function SimulatorConsole() {
  const [config, setConfig] = useState<SimulatorConfigDraft>(DEFAULT_SIMULATOR_CONFIG);
  const [resetBeforeStart, setResetBeforeStart] = useState(true);
  const [intervene, setIntervene] = useState(true);
  const [circuits, setCircuits] = useState<CircuitSummary[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([]);
  const [geometry, setGeometry] = useState<VenueGeometry | null>(null);
  const [selectedGates, setSelectedGates] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<ScenarioSnapshot | null>(null);
  const [connection, setConnection] = useState<"connecting" | "live" | "down">("connecting");
  const [action, setAction] = useState<ActionState>({ kind: "idle", message: "Ready for operator input" });
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [draft, setDraft] = useState<HazardDraft>({ hazardType: "fire", severity: "high", mode: "closed", capacity: "50", radius: "75", targetKind: "zone", zoneId: "", gateId: "", edgeId: "", locationX: "0", locationY: "0" });

  const applySnapshot = useCallback((incoming: ScenarioSnapshot) => setSnapshot((current) => acceptScenarioSnapshot(current, incoming)), []);
  const updateDraft = <K extends keyof HazardDraft>(key: K, value: HazardDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    void api<CircuitSummary[]>("/api/circuits").then(setCircuits).catch((error) => setAction({ kind: "error", message: errorMessage(error) }));
    void api<ScenarioSnapshot>("/api/session/state").then(applySnapshot).catch(() => {});
  }, [applySnapshot]);

  useEffect(() => {
    void Promise.all([api<ScenarioOption[]>(`/api/circuits/${encodeURIComponent(config.circuit_id)}/scenarios`), api<VenueGeometry>(`/api/circuits/${encodeURIComponent(config.circuit_id)}/geometry`)]).then(([nextScenarios, nextGeometry]) => {
      setScenarios(nextScenarios);
      setGeometry(nextGeometry);
      setConfig((current) => nextScenarios.some((entry) => entry.id === current.scenario) ? current : { ...current, scenario: nextScenarios[0]?.id ?? "egress" });
      const allZones = Object.values(nextGeometry.pack.zones ?? {});
      const firstZone = allZones.find((zone) => zone.kind === "viewing") ?? allZones[0];
      const firstGate = allZones.find((zone) => zone.kind === "gate");
      setDraft((current) => ({ ...current, zoneId: firstZone?.id ?? "", gateId: firstGate?.id ?? "", edgeId: Object.keys(nextGeometry.pack.edges ?? {})[0] ?? "" }));
      setSelectedGates(firstGate ? [firstGate.id] : []);
    }).catch((error) => setAction({ kind: "error", message: errorMessage(error) }));
  }, [config.circuit_id]);

  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 500;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (!active) return;
      setConnection("connecting");
      socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      socket.onopen = () => { backoff = 500; setConnection("live"); };
      socket.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as SocketFrame;
        if (frame.scenario_snapshot) applySnapshot(frame.scenario_snapshot);
        setConnection("live");
      };
      socket.onerror = () => setConnection("down");
      socket.onclose = () => {
        if (!active) return;
        setConnection("down");
        retry = setTimeout(connect, backoff);
        backoff = Math.min(5000, backoff * 2);
      };
    };
    connect();
    return () => { active = false; if (retry) clearTimeout(retry); socket?.close(); };
  }, [applySnapshot]);

  const zones = useMemo(() => Object.values(geometry?.pack.zones ?? {}).sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)), [geometry]);
  const gates = useMemo(() => zones.filter((zone) => zone.kind === "gate"), [zones]);
  const exits = useMemo(() => zones.filter((zone) => zone.kind === "exit" || zone.kind === "parking" || zone.kind === "gate"), [zones]);
  const edges = useMemo(() => Object.values(geometry?.pack.edges ?? {}).sort((a, b) => a.id.localeCompare(b.id)), [geometry]);
  const lifecycle = snapshot?.lifecycle ?? "idle";
  const busy = action.kind === "pending";
  const controls = controlAvailability(lifecycle, snapshot?.session != null, busy);

  const updateConfig = (key: keyof SimulatorConfigDraft, value: string) => setConfig((current) => ({ ...current, [key]: value }));
  const refresh = async () => applySnapshot(await api<ScenarioSnapshot>("/api/session/state"));
  const runAction = async (label: string, operation: () => Promise<unknown>) => {
    if (busy) return;
    setAction({ kind: "pending", message: `${label} in progress` });
    try {
      await operation();
      await refresh();
      setAction({ kind: "success", message: `${label} completed` });
    } catch (error) {
      setAction({ kind: "error", message: errorMessage(error) });
    }
  };

  const start = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    try {
      const request = sessionRequest(config, { gates: selectedGates, resetBeforeStart, intervene });
      void runAction("Start", () => api("/api/session", { method: "POST", body: request }));
    } catch (error) {
      setAction({ kind: "error", message: errorMessage(error) });
    }
  };
  const control = (label: string, body: Record<string, unknown>) => void runAction(label, () => api("/api/session/control", { method: "POST", body }));
  const reset = () => { if (window.confirm("Reset the simulation and clear every active hazard?")) control("Reset", { action: "reset", confirm: "RESET" }); };
  const applyHazard = () => {
    try { const request = hazardRequest(draft); void runAction("Apply hazard", () => api("/api/session/hazards", { method: "POST", body: request })); }
    catch (error) { setAction({ kind: "error", message: errorMessage(error) }); }
  };
  const clearHazard = (id: string) => void runAction(`Clear ${id}`, () => api(`/api/session/hazards/${encodeURIComponent(id)}`, { method: "DELETE", body: {} }));
  const clearAll = () => { if (window.confirm("Clear all active hazards and restore available capacity?")) void runAction("Clear all hazards", () => api("/api/session/hazards", { method: "DELETE", body: { confirm: "CLEAR ALL" } })); };
  const preset = (hazardType: HazardType) => setDraft((current) => ({ ...current, hazardType, severity: hazardType === "exit_unavailable" ? "critical" : "high", mode: "closed", targetKind: hazardType === "gate_blockage" ? "gate" : "zone" }));
  const toggleTheme = () => { const next = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; setTheme(next); };

  return <main className="simulator-center">
    <header className="simulator-hero">
      <div><span className="brand__mark">VMAX LIVE LAB</span><h1>Scenario control center</h1><p>Configure, run, and modify the authoritative venue simulation from one browser.</p></div>
      <div className="simulator-hero__status"><StatusChip label="Connection" value={connection} tone={connection === "live" ? "nominal" : connection === "down" ? "critical" : "building"} /><StatusChip label="Lifecycle" value={LIFECYCLE_LABEL[lifecycle] ?? lifecycle} tone={lifecycle === "running" ? "nominal" : lifecycle === "failed" ? "critical" : "building"} /><StatusChip label="Revision" value={String(snapshot?.revision ?? 0)} /><a className="tool" href="/">Dashboard</a><button className="tool" type="button" onClick={toggleTheme}>{theme === "dark" ? "Light" : "Dark"} mode</button></div>
    </header>
    <div className={`action-banner action-banner--${action.kind}`} role={action.kind === "error" ? "alert" : "status"} aria-live="polite"><strong>{action.kind}</strong>{action.message}</div>
    {snapshot?.operational_warning && <div className="operational-warning" role="alert">{snapshot.operational_warning}</div>}

    <Surface area="config" title="Run configuration" detail="Browser and server validated">
      <form className="simulator-form" onSubmit={start}>
        <Field label="Circuit"><select aria-label="Circuit" value={config.circuit_id} onChange={(event) => updateConfig("circuit_id", event.target.value)}>{circuits.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field>
        <Field label="Scenario"><select aria-label="Scenario" value={config.scenario} onChange={(event) => updateConfig("scenario", event.target.value)}>{scenarios.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field>
        <NumberField label="Population" value={config.population} min="1" max="500000" step="1" onChange={(value) => updateConfig("population", value)} />
        <NumberField label="Join rate per second" value={config.join_rate_per_s} min="0.01" max="100000" step="0.01" onChange={(value) => updateConfig("join_rate_per_s", value)} />
        <NumberField label="Tick interval, ms" value={config.tick_ms} min="20" max="60000" step="1" onChange={(value) => updateConfig("tick_ms", value)} />
        <NumberField label="Duration, seconds" value={config.duration_s} min="1" max="86400" step="1" onChange={(value) => updateConfig("duration_s", value)} />
        <NumberField label="Movement scale" value={config.movement_scale} min="0.01" max="1000" step="0.01" onChange={(value) => updateConfig("movement_scale", value)} />
        <NumberField label="Seed" value={config.seed} min="0" max="4294967295" step="1" onChange={(value) => updateConfig("seed", value)} />
        <NumberField label="Starting person ID" value={config.starting_person_id} min="1" max="9007199254740991" step="1" onChange={(value) => updateConfig("starting_person_id", value)} />
        <NumberField label="Participation" value={config.participation} min="0.000001" max="1" step="any" onChange={(value) => updateConfig("participation", value)} />
        <NumberField label="Compliance" value={config.compliance} min="0" max="1" step="0.01" onChange={(value) => updateConfig("compliance", value)} />
        <NumberField label="Simulation speed" value={config.speed} min="0.01" max="10000" step="0.01" onChange={(value) => updateConfig("speed", value)} />
        <fieldset className="gate-selector"><legend>Gate selection</legend><div>{gates.map((gate) => <label key={gate.id}><input type="checkbox" checked={selectedGates.includes(gate.id)} onChange={(event) => setSelectedGates((current) => event.target.checked ? [...current, gate.id] : current.filter((id) => id !== gate.id))} />{gate.name ?? gate.id}</label>)}</div></fieldset>
        <label className="switch-field"><input type="checkbox" checked={resetBeforeStart} onChange={(event) => setResetBeforeStart(event.target.checked)} /><span>Reset before starting</span></label>
        <label className="switch-field"><input type="checkbox" checked={intervene} onChange={(event) => setIntervene(event.target.checked)} /><span>Intervention enabled</span></label>
        <div className="simulator-actions"><button className="tool tool--primary" type="submit" disabled={!controls.start}>Start</button><button className="tool" type="button" disabled={!controls.pause} onClick={() => control("Pause", { action: "pause" })}>Pause</button><button className="tool" type="button" disabled={!controls.resume} onClick={() => control("Resume", { action: "resume" })}>Resume</button><button className="tool" type="button" disabled={!controls.stop} onClick={() => control("Stop", { action: "stop" })}>Stop</button><button className="tool tool--danger" type="button" disabled={!controls.reset} onClick={reset}>Reset</button></div>
      </form>
    </Surface>

    <Surface area="hazards" title="Emergency scenarios" detail="Routing and capacity inputs">
      <div className="preset-row">{(["fire", "gate_blockage", "walkway_blockage", "exit_unavailable"] as HazardType[]).map((type) => <button type="button" className={`preset ${draft.hazardType === type ? "preset--active" : ""}`} key={type} onClick={() => preset(type)}>{type.replaceAll("_", " ")}</button>)}</div>
      <div className="hazard-editor">
        <Field label="Type"><select aria-label="Hazard type" value={draft.hazardType} onChange={(event) => updateDraft("hazardType", event.target.value as HazardType)}><option value="fire">Fire</option><option value="gate_blockage">Gate blockage</option><option value="walkway_blockage">Walkway blockage</option><option value="exit_unavailable">Unavailable exit</option></select></Field>
        <Field label="Severity"><select aria-label="Hazard severity" value={draft.severity} onChange={(event) => updateDraft("severity", event.target.value as HazardSeverity)}>{["low", "medium", "high", "critical"].map((value) => <option key={value}>{value}</option>)}</select></Field>
        {draft.hazardType !== "exit_unavailable" && <Field label="Closure"><select aria-label="Hazard closure" value={draft.mode} onChange={(event) => updateDraft("mode", event.target.value as HazardMode)}><option value="closed">Fully closed</option><option value="restricted">Capacity restricted</option></select></Field>}
        {draft.mode === "restricted" && draft.hazardType !== "exit_unavailable" && <NumberField label="Remaining capacity, %" value={draft.capacity} min="1" max="99" step="1" onChange={(value) => updateDraft("capacity", value)} />}
        {draft.hazardType === "fire" && <><NumberField label="Affected radius, m" value={draft.radius} min="1" max="5000" step="1" onChange={(value) => updateDraft("radius", value)} /><Field label="Target kind"><select aria-label="Fire target kind" value={draft.targetKind} onChange={(event) => updateDraft("targetKind", event.target.value as HazardDraft["targetKind"])}><option value="zone">Zone</option><option value="gate">Gate</option><option value="location">Map location</option></select></Field></>}
        {draft.hazardType === "fire" && draft.targetKind === "zone" && <ZoneSelect label="Zone" value={draft.zoneId} zones={zones} onChange={(value) => updateDraft("zoneId", value)} />}
        {(draft.hazardType === "gate_blockage" || (draft.hazardType === "fire" && draft.targetKind === "gate")) && <ZoneSelect label="Gate" value={draft.gateId} zones={gates} onChange={(value) => updateDraft("gateId", value)} />}
        {draft.hazardType === "walkway_blockage" && <Field label="Graph edge"><select aria-label="Graph edge" value={draft.edgeId} onChange={(event) => updateDraft("edgeId", event.target.value)}>{edges.map((edge) => <option key={edge.id} value={edge.id}>{edge.id}: {zoneName(geometry, edge.source)} to {zoneName(geometry, edge.destination)}</option>)}</select></Field>}
        {draft.hazardType === "exit_unavailable" && <ZoneSelect label="Exit" value={draft.zoneId} zones={exits} onChange={(value) => updateDraft("zoneId", value)} />}
        {draft.hazardType === "fire" && draft.targetKind === "location" && <><NumberField label="Map X" value={draft.locationX} step="0.1" onChange={(value) => updateDraft("locationX", value)} /><NumberField label="Map Y" value={draft.locationY} step="0.1" onChange={(value) => updateDraft("locationY", value)} /></>}
      </div>
      <div className="simulator-actions"><button className="tool tool--critical" type="button" disabled={busy || !snapshot?.session} onClick={applyHazard}>Apply hazard</button><button className="tool" type="button" disabled={busy || !snapshot?.session} onClick={() => void runAction(snapshot?.evacuation.enabled ? "Clear evacuation" : "Activate evacuation", () => api("/api/session/evacuation", { method: "POST", body: { enabled: !snapshot?.evacuation.enabled } }))}>{snapshot?.evacuation.enabled ? "Clear evacuation" : "Emergency evacuation"}</button><button className="tool tool--danger" type="button" disabled={busy || !snapshot?.active_hazards.length} onClick={clearAll}>Clear all hazards</button></div>
    </Surface>

    <Surface area="map" title="Live venue impact" detail={`${snapshot?.active_hazards.length ?? 0} active hazards`}><SimulatorHazardMap geometry={geometry} snapshot={snapshot} /></Surface>
    <Surface area="metrics" title="Live run metrics" detail={snapshot?.session ? `tick ${snapshot.session.tick ?? 0}` : "No active session"}><Metrics snapshot={snapshot} /></Surface>
    <Surface area="active" title="Active hazards" detail="Independent clear controls"><div className="hazard-list">{!snapshot?.active_hazards.length && <Empty text="No active hazards" />}{snapshot?.active_hazards.map((hazard) => <article className="hazard-card" key={hazard.id}><div className="hazard-card__head"><strong>{hazard.type.replaceAll("_", " ")}</strong><span>{hazard.id}</span><button className="tool" type="button" disabled={busy} onClick={() => clearHazard(hazard.id)}>Clear</button></div><p>{hazard.severity} severity, {hazard.mode === "closed" ? "fully closed" : `${hazard.capacity_percent}% capacity remaining`}</p><dl><Metric label="Affected" value={format(hazard.affected_people)} /><Metric label="Rerouted" value={format(hazard.rerouted_people)} /><Metric label="Awaiting" value={format(hazard.awaiting_safe_route)} /><Metric label="Replacement exits" value={hazard.replacement_exits.map((id) => zoneName(geometry, id)).join(", ") || "None"} /></dl></article>)}</div></Surface>
    <Surface area="gates" title="Gate and exit status" detail="Combined hazard impact"><div className="status-table">{snapshot?.gates.length ? <table aria-label="Gate and exit status"><tbody>{snapshot.gates.map((gate) => <tr className="status-table__row" key={gate.id}><td>{gate.name}</td><td>{gate.kind}</td><td className={gate.available ? "tone-nominal" : "tone-critical"}>{gate.available ? "Available" : "Unavailable"}</td><td>{gate.capacity_percent}% capacity</td><td>{gate.replacement_exit_ids.length ? `Using ${gate.replacement_exit_ids.map((id) => zoneName(geometry, id)).join(", ")}` : "No replacement active"}</td></tr>)}</tbody></table> : <Empty text="Start a simulation to load gate status" />}</div></Surface>
    <Surface area="timeline" title="Scenario event timeline" detail={`${snapshot?.event_history.length ?? 0} retained events`}><div className="event-timeline">{!snapshot?.event_history.length && <Empty text="No scenario events yet" />}{[...(snapshot?.event_history ?? [])].reverse().map((event) => <div className={`event event--${event.severity}`} key={event.seq}><time>{clock(event.time_s)}</time><strong>{event.kind}</strong><span>{event.message}</span>{event.zone_id && <small>{zoneName(geometry, event.zone_id)}</small>}</div>)}</div></Surface>
  </main>;
}

function Surface({ area, title, detail, children }: { area: string; title: string; detail: string; children: ReactNode }) { return <section className={`control-surface control-surface--${area}`}><div className="control-surface__head"><h2>{title}</h2><span>{detail}</span></div>{children}</section>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="form-field"><span>{label}</span>{children}</div>; }
function NumberField({ label, value, onChange, min, max, step = "any" }: { label: string; value: string; onChange: (value: string) => void; min?: string; max?: string; step?: string }) { return <Field label={label}><input aria-label={label} type="number" inputMode="decimal" required value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} /></Field>; }
function ZoneSelect({ label, value, zones, onChange }: { label: string; value: string; zones: Array<{ id: string; name?: string | null }>; onChange: (value: string) => void }) { return <Field label={label}><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name ?? zone.id} ({zone.id})</option>)}</select></Field>; }
function StatusChip({ label, value, tone = "info" }: { label: string; value: string; tone?: string }) { return <div className={`status-chip status-chip--${tone}`}><span>{label}</span><strong>{value}</strong></div>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function Metrics({ snapshot }: { snapshot: ScenarioSnapshot | null }) {
  const current = snapshot?.evacuation;
  const session = snapshot?.session;
  const cards = [["Population", format(current?.total_population ?? 0), `${format(current?.remaining ?? 0)} remaining`], ["Evacuated", format(current?.evacuated ?? 0), current?.enabled ? "evacuation active" : "normal operation"], ["Throughput", `${format(current?.throughput_per_minute ?? 0)}/min`, "completed routes"], ["Congestion", current?.congestion ?? "nominal", "highest current band"], ["Clearance estimate", current?.estimated_clearance_s == null ? "Awaiting flow" : clock(current.estimated_clearance_s), "at current throughput"], ["Awaiting safe route", format(current?.awaiting_safe_route ?? 0), snapshot?.operational_warning ?? "all routed"], ["Simulation clock", clock(session?.time_s ?? 0), `${clock(session?.duration_s ?? 0)} duration`], ["Model cadence", `${format((session?.tick_s ?? 0) * 1000)} ms`, `${session?.speed ?? 0}x wall speed`]];
  return <div className="metric-grid">{cards.map(([label, value, detail]) => <div className="metric-card" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>)}</div>;
}

async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> { const response = await fetch(path, { method: options.method, headers: options.body === undefined ? undefined : { "content-type": "application/json" }, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); const text = await response.text(); const value = text ? JSON.parse(text) : {}; if (!response.ok) throw new Error(value.detail ?? `${options.method ?? "GET"} ${path} failed with ${response.status}`); return value as T; }
function zoneName(geometry: VenueGeometry | null, id: string): string { return geometry?.pack.zones?.[id]?.name ?? id; }
function format(value: number): string { return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value); }
function clock(seconds: number): string { const value = Math.max(0, Math.round(seconds)); return `${String(Math.floor(value / 3600)).padStart(2, "0")}:${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
