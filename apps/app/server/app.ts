import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { CAPACITY_DENSITY, DENSITY_BUILDING_MAX, DENSITY_NOMINAL_MAX, FREE_FLOW_SPEED_MS, JAM_DENSITY_PERSONS_M2, LOS_A_MAX, LOS_B_MAX, LOS_C_MAX, LOS_D_MAX, LOS_E_MAX, MEASURED_NOT_ASSUMED } from '@crowdflow/contracts';
import { capacityFlow } from '@crowdflow/core';
import { AgentService } from './agent.js';
import { CrowdControl } from './control.js';
import { simulatedPeopleQuery } from './simcrowd.js';
import { AdvisoryDesk } from './advisory.js';
import { RaceDayRun } from './raceday.js';
import { anchorPack, availableCircuits, geometry, loadCircuit, summary, type LoadedCircuit } from './packs.js';
import { LiveIngest } from './live.js';
import { currentRace, race, races } from './events.js';
import { ScenarioSession } from './session.js';
import { ASSUMED_DEMO_POPULATION, buildScenario, scenarioOptions } from './scenarios.js';
import { SpectatorFeed } from './spectator.js';
import { PeopleStore, type PeopleQuery } from './people.js';
import { HazardController } from './hazards.js';
import { normalizeSessionRequest } from './simulation-control.js';
import type { AnomalyKind } from '@crowdflow/core';
import type { TickEnvelope, AgentAskRequest, ControlRequest, HazardRequest, LiveRequest, RaceDayRequest, PersonLoginRequest, ScenarioSnapshot, SessionRequest, SocketFrame, StandardsReport } from '@crowdflow/contracts/wire';
import type { NodeReport } from '@crowdflow/contracts';

export function dayClock(secondOfDay: number): string {
  const day = 24 * 60 * 60;
  const wrapped = ((Math.round(secondOfDay) % day) + day) % day;
  const pad = (value: number) => String(value).padStart(2, '0');
  return pad(Math.floor(wrapped / 3600)) + ':' + pad(Math.floor(wrapped / 60) % 60) + ':' + pad(wrapped % 60);
}

export function standardsReport(): StandardsReport {
  return { source: 'Fruin, "Pedestrian Planning and Design" (1971), walkway LOS', bands: [
    { band: 'nominal', label: 'NOMINAL', los_grades: 'A-C', density_min: 0, density_max: DENSITY_NOMINAL_MAX },
    { band: 'building', label: 'BUILDING', los_grades: 'D-E', density_min: DENSITY_NOMINAL_MAX, density_max: DENSITY_BUILDING_MAX },
    { band: 'critical', label: 'CRITICAL', los_grades: 'F', density_min: DENSITY_BUILDING_MAX, density_max: null },
  ], los: ([LOS_A_MAX, LOS_B_MAX, LOS_C_MAX, LOS_D_MAX, LOS_E_MAX].map((max, index, list) => ({ grade: 'ABCDE'[index]!, flow_min: index ? list[index - 1]! : 0, flow_max: max as number | null, note: 'Fruin walkway LOS' }))).concat([{ grade: 'F', flow_min: LOS_E_MAX, flow_max: null, note: 'flow breaks down' }]), capacity_density: CAPACITY_DENSITY, jam_density: JAM_DENSITY_PERSONS_M2, free_flow_speed_ms: FREE_FLOW_SPEED_MS, max_achievable_flow: Number(capacityFlow()[1].toFixed(2)), measured_not_assumed: [...MEASURED_NOT_ASSUMED] };
}

export class CrowdFlowServer {
  session: ScenarioSession | null = null;
  hazards: HazardController | null = null;
  spectator: SpectatorFeed | null = null;
  /**
   * Live phone ingest, independent of the scenario session.
   *
   * Separate on purpose: a demo runs a scenario, a walk test runs live phones,
   * and a real event would run both — a simulated egress beside the handsets
   * actually on site. Coupling them would mean a live venue could not be watched
   * without starting a simulation of it.
   */
  live: LiveIngest | null = null;
  private circuits = new Map<string, LoadedCircuit>();
  agent = new AgentService();
  readonly people: PeopleStore;
  readonly control: CrowdControl;
  raceday: RaceDayRun | null = null;
  readonly advisories = new AdvisoryDesk();
  readonly noticeTtlS = 900;
  private unsubscribeLive: (() => void) | null = null;
  private scenarioRevision = 0;
  private lifecycleOverride: ScenarioSnapshot['lifecycle'] | null = null;
  private pendingCircuitId: string | null = null;
  private fallback: ((request: IncomingMessage, response: ServerResponse) => void | Promise<void>) | null;
  readonly server = createServer((request, response) => void this.handle(request, response));
  readonly sockets = new WebSocketServer({ noServer: true });
  private upgrades = new Set<Duplex>();
  constructor(readonly root: string, options: { databasePath?: string; fallback?: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> } = {}) {
    this.fallback = options.fallback ?? null;
    this.people = new PeopleStore(options.databasePath ?? (process.env.NODE_ENV === 'test' ? ':memory:' : join(root, '.data', 'crowdflow.sqlite')));
    this.control = new CrowdControl(this.people);
    this.server.on('upgrade', (request, socket, head) => {
      if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/ws') return;
      this.upgrades.add(socket); socket.once('close', () => this.upgrades.delete(socket));
      this.sockets.handleUpgrade(request, socket, head, (client) => this.sockets.emit('connection', client, request));
    });
    this.sockets.on('connection', (socket) => {
      const session = this.session;
      const snapshot = this.scenarioSnapshot();
      const hello: SocketFrame = { type: 'hello', session: session?.info() ?? null, revision: snapshot.revision, scenario_snapshot: snapshot, standards: standardsReport(), geometry_url: snapshot.circuit_id ? `/api/circuits/${snapshot.circuit_id}/geometry` : null, backlog: session?.events ?? [], last_tick: session?.lastEnvelope ?? null, live: this.live?.snapshot(Date.now() / 1000, false) ?? null };
      socket.send(JSON.stringify(hello));
      const heartbeat = setInterval(() => {
        const current = this.scenarioSnapshot();
        socket.send(JSON.stringify({ type: 'status', session: current.session, revision: current.revision, scenario_snapshot: current } satisfies SocketFrame));
      }, 500);
      socket.on('close', () => clearInterval(heartbeat));
    });
  }
  setFallback(fallback: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): void { this.fallback = fallback; }
  listen(port = 8099, host = '127.0.0.1'): Promise<void> { return new Promise((resolve) => this.server.listen(port, host, resolve)); }
  close(): Promise<void> {
    this.session?.stop();
    this.unsubscribeLive?.();
    for (const socket of this.sockets.clients) socket.terminate();
    for (const socket of this.upgrades) socket.destroy();
    this.sockets.close();
    // Bun's Node-compatible HTTP server can leave its close callback pending
    // after an upgraded WebSocket closes; the destroyed sockets will still let
    // the server drain, so do not block shutdown on that callback.
    this.people.close();
    if ('Bun' in globalThis) { this.server.close(); return Promise.resolve(); }
    return new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }

  startSession(request: SessionRequest = {}): ScenarioSession {
    const circuit = this.load(request.circuit_id ?? 'silverstone');
    const normalized = normalizeSessionRequest(circuit, request, ASSUMED_DEMO_POPULATION);
    if (this.session && ['starting', 'running', 'stopping'].includes(this.session.status) && !normalized.resetBeforeStart) throw new Error('a simulation is already active; stop it or enable reset before starting');
    this.lifecycleOverride = 'starting'; this.pendingCircuitId = circuit.pack.id; this.advanceScenario();
    try {
      this.session?.stop();
      if (normalized.resetBeforeStart) this.people.reset(circuit.pack.id);
      const origins = normalized.scenario === 'arrival' && normalized.gates.length ? normalized.gates : normalized.origins;
      const { scenario, option } = buildScenario(circuit, normalized.scenario, normalized.modeledPopulation, normalized.seed, origins, normalized.destination, { joinRatePerS: normalized.modeledJoinRatePerS, durationS: normalized.durationS });
      const modeledCount = scenario.cohorts.reduce((sum, cohort) => sum + cohort.count, 0);
      const populationScale = normalized.population / modeledCount;
      this.session = new ScenarioSession(circuit, scenario, option, normalized.population, normalized.participation, normalized.intervene, normalized.speed, { tick_s: normalized.tickMs / 1000, compliance: normalized.compliance, movement_scale: normalized.movementScale, start_person_id: normalized.startingPersonId, population_scale: populationScale }, { joinRatePerS: normalized.joinRatePerS, movementScale: normalized.movementScale, startingPersonId: normalized.startingPersonId, gates: normalized.gates, durationS: normalized.durationS });
      this.raceday = null;
      this.hazards = new HazardController(this.session);
      this.bindSession(this.session, circuit);
      this.lifecycleOverride = null; this.pendingCircuitId = null;
      this.session.note('lifecycle', 'info', 'simulation ready');
      if (normalized.autostart) this.session.control('play');
      this.advanceScenario();
      return this.session;
    } catch (error) {
      this.lifecycleOverride = 'failed'; this.pendingCircuitId = circuit.pack.id; this.advanceScenario(); throw error;
    }
  }
  /**
   * Arm live ingest.
   *
   * `participation` is required by the contract and validated here rather than
   * defaulted, because `estimated_population` is observed devices divided by it
   * and that is the number an operator would act on. A default would put a
   * plausible figure on the wall that nobody chose.
   */
  startLive(request: LiveRequest): LiveIngest {
    const participation = request.participation;
    if (!(participation > 0 && participation <= 1)) throw new Error('participation must be a measured or stated estimate in (0, 1]');
    this.unsubscribeLive?.();
    this.live = new LiveIngest(this.load(request.circuit_id ?? 'silverstone'), request.window_s == null ? { participation } : { participation, window_s: request.window_s }, this.people);
    this.unsubscribeLive = this.live.subscribe((snapshot) => {
      this.agent.observe(this.live!.circuit.pack, snapshot.state);
      if (!this.session) return;
      this.broadcast({ type: 'live', session: this.session.info(), live: snapshot });
    });
    return this.live;
  }

  startRaceDay(request: RaceDayRequest = {}): RaceDayRun {
    const circuitId = request.circuit_id ?? 'silverstone';
    const circuit = this.load(circuitId);
    const entry = races(this.root).find((item) => item.circuit_id === circuitId);
    if (!entry) throw new Error(`no committed calendar entry for ${circuitId}`);
    const profile = { circuit_id: circuitId, name: entry.name, sessions: entry.sessions ?? [], date: entry.date, round: entry.round, season: entry.season, locality: entry.locality, country: entry.country };
    this.session?.stop();
    this.raceday = new RaceDayRun(circuit, profile, entry.utc_offset ?? null, request);
    this.session = this.raceday.session;
    this.hazards = new HazardController(this.session);
    this.bindSession(this.session, circuit);
    this.advanceScenario();
    return this.raceday;
  }
  simClock(): number {
    return this.raceday ? this.raceday.session.sim.timeS : (this.session?.sim.timeS ?? Date.now() / 1000);
  }

  scenarioSnapshot(): ScenarioSnapshot {
    const session = this.session;
    const hazards = this.hazards;
    const lifecycle = this.lifecycleOverride ?? session?.status ?? 'idle';
    const populationScale = session?.populationScale ?? 1;
    const total = session?.population ?? 0;
    const evacuated = session ? Math.round(session.sim.arrived * populationScale) : 0;
    const remaining = Math.max(0, total - evacuated);
    const elapsed = session?.sim.timeS ?? 0;
    const throughput = elapsed > 0 ? evacuated / elapsed * 60 : 0;
    const bands = Object.values(session?.lastEnvelope?.state.zones ?? {}).map((zone) => zone.band);
    const congestion = bands.includes('critical') ? 'critical' : bands.includes('building') ? 'building' : 'nominal';
    const awaiting = session ? Math.round(session.sim.awaitingRoute * populationScale) : 0;
    return {
      revision: this.scenarioRevision,
      lifecycle,
      circuit_id: session?.circuit.pack.id ?? this.pendingCircuitId,
      session: session?.info() ?? null,
      active_hazards: hazards?.active() ?? [],
      hazard_history: (hazards?.history() ?? []).slice(-200),
      gates: hazards?.gateAvailability() ?? [],
      evacuation: {
        enabled: hazards?.evacuationEnabled() ?? false,
        total_population: total,
        evacuated,
        remaining,
        awaiting_safe_route: awaiting,
        throughput_per_minute: Number(throughput.toFixed(1)),
        congestion,
        estimated_clearance_s: throughput > 0 ? Number((remaining / (throughput / 60)).toFixed(1)) : null,
      },
      event_history: (session?.events ?? []).slice(-200),
      operational_warning: hazards?.warning() ?? null,
    };
  }

  private bindSession(session: ScenarioSession, circuit: LoadedCircuit): void {
    this.spectator = new SpectatorFeed(session);
    session.subscribe((tick) => {
      if (this.session !== session) return;
      this.spectator?.observe(tick);
      this.agent.observe(circuit.pack, tick.state);
      this.sweepAdvisories(circuit, tick);
      const snapshot = this.scenarioSnapshot();
      this.broadcast({ type: 'tick', session: session.info(), revision: snapshot.revision, scenario_snapshot: snapshot, tick });
    });
    session.subscribeStatus(() => { if (this.session === session) this.advanceScenario(); });
  }

  private advanceScenario(): ScenarioSnapshot {
    this.scenarioRevision += 1;
    const snapshot = this.scenarioSnapshot();
    this.broadcast({ type: 'scenario', session: snapshot.session, revision: snapshot.revision, scenario_snapshot: snapshot });
    return snapshot;
  }

  private resetScenario(): ScenarioSnapshot {
    this.hazards?.clearAll();
    this.session?.stop();
    this.session = null;
    this.hazards = null;
    this.spectator = null;
    this.raceday = null;
    this.lifecycleOverride = null;
    this.pendingCircuitId = null;
    return this.advanceScenario();
  }

  private sweepAdvisories(circuit: LoadedCircuit, tick: TickEnvelope): void {
    this.advisories.sweep(
      tick.time_s,
      tick.state,
      tick.forecasts ?? [],
      this.agent.insightsFor(circuit.pack),
      (id) => circuit.pack.zones?.[id]?.name ?? id,
    );
  }

  private broadcast(frame: SocketFrame): void {
    const payload = JSON.stringify(frame);
    for (const socket of this.sockets.clients) if (socket.readyState === 1) socket.send(payload);
  }
  private load(id: string): LoadedCircuit { const cached = this.circuits.get(id); if (cached) return cached; const circuit = loadCircuit(this.root, id); this.circuits.set(id, circuit); return circuit; }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost'); const path = url.pathname;
      if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type' }); response.end(); return; }
      if (request.method === 'GET' && path === '/api/health') return json(response, 200, { ok: true, circuits: availableCircuits(this.root), session: this.session?.sessionId ?? null, status: this.lifecycleOverride ?? this.session?.status ?? 'idle' });
      if (request.method === 'GET' && path === '/api/standards') return json(response, 200, standardsReport());
      if (request.method === 'GET' && path === '/api/circuits') return json(response, 200, availableCircuits(this.root).map((id) => summary(this.load(id))));
      const geometryMatch = path.match(/^\/api\/circuits\/([^/]+)\/geometry$/); if (request.method === 'GET' && geometryMatch) return json(response, 200, geometry(this.load(geometryMatch[1]!)));
      const scenarioMatch = path.match(/^\/api\/circuits\/([^/]+)\/scenarios$/); if (request.method === 'GET' && scenarioMatch) return json(response, 200, scenarioOptions(this.load(scenarioMatch[1]!)));
      if (request.method === 'GET' && path === '/api/session') return this.session ? json(response, 200, this.session.info()) : json(response, 404, { detail: 'no session started' });
      if (request.method === 'GET' && path === '/api/session/state') return json(response, 200, this.scenarioSnapshot());
      if (request.method === 'GET' && path === '/api/spectator/view') { if (!this.spectator) return json(response, 404, { detail: 'no session started' }); const origin = url.searchParams.get('origin') ?? ''; const destination = url.searchParams.get('destination') ?? ''; if (!origin || !destination) return json(response, 422, { detail: 'origin and destination are required' }); const view = this.spectator.view({ origin, destination, online: url.searchParams.get('online') !== 'false', mesh_peers: Number(url.searchParams.get('mesh_peers') ?? 0), now_unix_s: Number(url.searchParams.get('now') ?? Date.now() / 1000) }); return json(response, 200, { ...view, simulated_clock_s: this.simClock(), simulated_clock_local: dayClock(this.simClock()), notices: this.advisories.notices(this.simClock()) }); }
      if (request.method === 'GET' && path === '/api/events') return json(response, 200, races(this.root));
      if (request.method === 'GET' && path === '/api/events/current') { const next = currentRace(this.root, new Date()); return next ? json(response, 200, next) : json(response, 404, { detail: 'no calendar is committed' }); }
      const raceMatch = path.match(/^\/api\/events\/([^/]+)$/); if (request.method === 'GET' && raceMatch) { const found = race(this.root, raceMatch[1]!); return found ? json(response, 200, found) : json(response, 404, { detail: `no race ${raceMatch[1]}` }); }
      const anchorMatch = path.match(/^\/api\/circuits\/([^/]+)\/anchors$/); if (request.method === 'GET' && anchorMatch) return json(response, 200, anchorPack(this.root, anchorMatch[1]!));
      if (request.method === 'POST' && path === '/api/people/login') {
        const command = await body(request) as PersonLoginRequest;
        this.load(command.circuit_id);
        const person = this.people.login(command.person_id, command.circuit_id, Date.now() / 1000);
        if (this.session) this.broadcast({ type: 'person_joined', session: this.session.info(), person, live: this.live?.snapshot(Date.now() / 1000, false) ?? null });
        return json(response, 200, person);
      }
      if (request.method === 'POST' && path === '/api/people/login/batch') {
        const command = await body(request) as { people?: PersonLoginRequest[] };
        if (!command.people?.length || command.people.length > 1000) throw new Error('people must contain from 1 to 1000 items');
        for (const item of command.people) this.load(item.circuit_id);
        const joined = this.people.transaction(() =>
          command.people!.map((item) => this.people.login(item.person_id, item.circuit_id, Date.now() / 1000)),
        );
        if (this.session) this.broadcast({ type: 'people_joined', session: this.session.info(), people: joined, live: this.live?.snapshot(Date.now() / 1000, false) ?? null });
        return json(response, 200, { count: joined.length, people: joined });
      }
      const queryMatch = path.match(/^\/api\/circuits\/([^/]+)\/people\/query$/);
      if (request.method === 'POST' && queryMatch) {
        this.load(queryMatch[1]!);
        const query = await body(request) as PeopleQuery;
        const stored = this.people.query(queryMatch[1]!, query);
        if (stored.matched_count > 0 || !this.session) return json(response, 200, stored);
        return json(response, 200, simulatedPeopleQuery(this.session.sim, queryMatch[1]!, query));
      }
      const peopleMatch = path.match(/^\/api\/circuits\/([^/]+)\/people$/);
      if (request.method === 'DELETE' && peopleMatch) {
        const circuitId = peopleMatch[1]!;
        this.load(circuitId);
        const removed = this.people.reset(circuitId);
        if (this.live?.circuit.pack.id === circuitId) this.live.clear();
        const live = this.live?.snapshot(Date.now() / 1000, false) ?? null;
        if (this.session) this.broadcast({ type: 'live', session: this.session.info(), live });
        return json(response, 200, { circuit_id: circuitId, removed, count: 0, live });
      }
      if (request.method === 'GET' && peopleMatch) {
        this.load(peopleMatch[1]!);
        const count = Number(url.searchParams.get('count') ?? 1000);
        const people = this.people.list(peopleMatch[1]!, count);
        return json(response, 200, { circuit_id: peopleMatch[1]!, count: people.length, people });
      }
      if (request.method === 'POST' && path === '/api/live') { const command = await body(request) as LiveRequest; return json(response, 200, this.startLive(command).snapshot(Date.now() / 1000)); }
      if (request.method === 'GET' && path === '/api/live') return this.live ? json(response, 200, this.live.snapshot(Date.now() / 1000)) : json(response, 404, { detail: 'live ingest is not running' });
      if (request.method === 'DELETE' && path === '/api/live') { if (!this.live) return json(response, 404, { detail: 'live ingest is not running' }); this.live.clear(); return json(response, 200, this.live.snapshot(Date.now() / 1000)); }
      if (request.method === 'POST' && path === '/api/nodes') {
        // A handset must be able to tell "the venue is not listening" from "the
        // venue rejected my batch": the first is a 503 it should retry, the
        // second is an ack with a reason it must act on.
        if (!this.live) return json(response, 503, { detail: 'live ingest is not running' });
        return json(response, 200, this.live.report(await body(request) as NodeReport, Date.now() / 1000));
      }
      if (request.method === 'POST' && path === '/api/nodes/batch') {
        if (!this.live) return json(response, 503, { detail: 'live ingest is not running' });
        const command = await body(request) as { reports?: NodeReport[]; emit?: boolean };
        return json(response, 200, this.live.reportMany(command.reports ?? [], Date.now() / 1000, command.emit !== false));
      }
      if (request.method === 'POST' && path === '/api/raceday') {
        const command = await body(request) as RaceDayRequest;
        return json(response, 200, this.startRaceDay(command).status());
      }
      if (request.method === 'GET' && path === '/api/raceday') {
        return this.raceday ? json(response, 200, this.raceday.status()) : json(response, 404, { detail: 'no race day is running — start one with POST /api/raceday' });
      }
      if (request.method === 'POST' && path === '/api/raceday/anomaly') {
        if (!this.raceday) return json(response, 404, { detail: 'no race day is running' });
        const command = await body(request) as { kind?: AnomalyKind; duration_s?: number };
        if (!command.kind) throw new Error('kind is required');
        const anomaly = this.raceday.inject(command.kind, command.duration_s);
        return json(response, 200, { anomaly, status: this.raceday.status() });
      }
      if (request.method === 'GET' && path === '/api/agent') return json(response, 200, this.agent.status(this.session, this.live));
      if (request.method === 'POST' && path === '/api/agent/ask') return json(response, 200, await this.agent.ask(await body(request) as AgentAskRequest, this.session, this.live, Date.now() / 1000));
      if (request.method === 'GET' && path === '/api/agent/advisories') {
        return json(response, 200, { advisories: this.advisories.advisories(), notices: this.advisories.notices(this.simClock()) });
      }
      const advisoryMatch = path.match(/^\/api\/agent\/advisories\/([^/]+)\/approve$/);
      if (request.method === 'POST' && advisoryMatch) {
        const notice = this.advisories.approve(advisoryMatch[1]!, this.simClock(), this.noticeTtlS);
        if (this.session) {
          const event = this.session.note('command', 'info', `operator published a crowd notice: ${notice.message}`, notice.zone_id);
          this.broadcast({ type: 'command', session: this.session.info(), event });
        }
        return json(response, 200, { notice, advisories: this.advisories.advisories() });
      }
      if (request.method === 'GET' && path === '/api/agent/commands') return json(response, 200, { commands: this.control.status(Date.now() / 1000) });
      const approveMatch = path.match(/^\/api\/agent\/proposals\/([^/]+)\/approve$/);
      if (request.method === 'POST' && approveMatch) {
        const pending = this.agent.proposal(approveMatch[1]!);
        if (!pending) return json(response, 404, { detail: `no proposal ${approveMatch[1]} — ask the agent first; proposals do not survive a restart` });
        const status = this.control.dispatch(pending.proposal, this.load(pending.circuit_id), this.session, Date.now() / 1000);
        if (this.session) {
          const event = this.session.note('command', 'warning', `operator approved ${status.command_id}: divert ${Math.round(status.target_fraction * 100)}% of ${status.source_zone} to ${status.destination_zone}${status.applied_to_simulation ? '' : ' (guidance only; no simulation running here)'}`, status.source_zone);
          this.broadcast({ type: 'command', session: this.session.info(), event, command: status });
        }
        return json(response, 200, status);
      }
      const guidanceMatch = path.match(/^\/api\/circuits\/([^/]+)\/guidance$/);
      if (request.method === 'GET' && guidanceMatch) {
        this.load(guidanceMatch[1]!);
        const person = url.searchParams.get('person_id');
        return json(response, 200, { circuit_id: guidanceMatch[1]!, guidance: this.control.guidance(guidanceMatch[1]!, Date.now() / 1000, person == null ? undefined : Number(person)) });
      }
      if (request.method === 'POST' && path === '/api/session') return json(response, 200, this.startSession(await body(request)).info());
      if (request.method === 'POST' && path === '/api/session/control') {
        const command = await body(request) as ControlRequest & { confirm?: string };
        if (command.action === 'reset') {
          if (command.confirm !== 'RESET') throw new Error('reset requires confirm=RESET');
          return json(response, 200, this.resetScenario());
        }
        if (!this.session) return json(response, 404, { detail: 'no session started' });
        if (command.action === 'speed' && (!(command.speed! > 0) || command.speed! > 10000)) throw new Error('speed must be between 0 and 10000');
        return json(response, 200, this.session.control(command.action, command.speed ?? undefined));
      }
      if (request.method === 'POST' && path === '/api/session/hazards') {
        if (!this.session || !this.hazards) return json(response, 404, { detail: 'no session started' });
        const hazard = this.hazards.apply(await body(request) as HazardRequest);
        this.session.note('hazard', hazard.severity === 'critical' ? 'critical' : 'warning', `${hazard.type} ${hazard.id} applied`, hazard.location.zone_id ?? hazard.location.gate_id ?? undefined);
        const snapshot = this.advanceScenario();
        return json(response, 200, { hazard, snapshot });
      }
      const hazardMatch = path.match(/^\/api\/session\/hazards\/([^/]+)$/);
      if (request.method === 'DELETE' && hazardMatch) {
        if (!this.session || !this.hazards) return json(response, 404, { detail: 'no session started' });
        const hazard = this.hazards.clear(decodeURIComponent(hazardMatch[1]!));
        this.session.note('hazard', 'info', `${hazard.type} ${hazard.id} cleared`, hazard.location.zone_id ?? hazard.location.gate_id ?? undefined);
        const snapshot = this.advanceScenario();
        return json(response, 200, { hazard, snapshot });
      }
      if (request.method === 'DELETE' && path === '/api/session/hazards') {
        if (!this.session || !this.hazards) return json(response, 404, { detail: 'no session started' });
        const command = await body(request) as { confirm?: string };
        if (command.confirm !== 'CLEAR ALL') throw new Error('clear all requires confirm=CLEAR ALL');
        const hazards = this.hazards.clearAll();
        this.session.note('hazard', 'info', `${hazards.length} active hazards cleared`);
        const snapshot = this.advanceScenario();
        return json(response, 200, { hazards, snapshot });
      }
      if (request.method === 'POST' && path === '/api/session/evacuation') {
        if (!this.session || !this.hazards) return json(response, 404, { detail: 'no session started' });
        const command = await body(request) as { enabled?: boolean };
        if (typeof command.enabled !== 'boolean') throw new Error('enabled must be boolean');
        this.hazards.setEvacuation(command.enabled);
        this.session.note('evacuation', command.enabled ? 'critical' : 'info', command.enabled ? 'emergency evacuation activated' : 'emergency evacuation cleared');
        return json(response, 200, this.advanceScenario());
      }
      if (this.fallback) return await this.fallback(request, response);
      return json(response, 404, { detail: 'not found' });
    } catch (error) { return json(response, 400, { detail: error instanceof Error ? error.message : String(error) }); }
  }
}

function json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage): Promise<any> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; }
