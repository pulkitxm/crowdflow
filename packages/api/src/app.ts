import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { CAPACITY_DENSITY, DENSITY_BUILDING_MAX, DENSITY_NOMINAL_MAX, FREE_FLOW_SPEED_MS, JAM_DENSITY_PERSONS_M2, LOS_A_MAX, LOS_B_MAX, LOS_C_MAX, LOS_D_MAX, LOS_E_MAX, MEASURED_NOT_ASSUMED } from '@crowdflow/contracts';
import { capacityFlow } from '@crowdflow/core';
import { anchorPack, availableCircuits, geometry, loadCircuit, summary, type LoadedCircuit } from './packs.js';
import { LiveIngest } from './live.js';
import { currentRace, race, races } from './events.js';
import { ScenarioSession } from './session.js';
import { ASSUMED_DEMO_POPULATION, buildScenario, scenarioOptions } from './scenarios.js';
import { SpectatorFeed } from './spectator.js';
import { PeopleStore, type PeopleQuery } from './people.js';
import type { LiveRequest, PersonLoginRequest, SessionRequest, SocketFrame, StandardsReport } from './wire.js';
import type { NodeReport } from '@crowdflow/contracts';

export function standardsReport(): StandardsReport {
  return { source: 'Fruin, "Pedestrian Planning and Design" (1971), walkway LOS', bands: [
    { band: 'nominal', label: 'NOMINAL', los_grades: 'A-C', density_min: 0, density_max: DENSITY_NOMINAL_MAX },
    { band: 'building', label: 'BUILDING', los_grades: 'D-E', density_min: DENSITY_NOMINAL_MAX, density_max: DENSITY_BUILDING_MAX },
    { band: 'critical', label: 'CRITICAL', los_grades: 'F', density_min: DENSITY_BUILDING_MAX, density_max: null },
  ], los: ([LOS_A_MAX, LOS_B_MAX, LOS_C_MAX, LOS_D_MAX, LOS_E_MAX].map((max, index, list) => ({ grade: 'ABCDE'[index]!, flow_min: index ? list[index - 1]! : 0, flow_max: max as number | null, note: 'Fruin walkway LOS' }))).concat([{ grade: 'F', flow_min: LOS_E_MAX, flow_max: null, note: 'flow breaks down' }]), capacity_density: CAPACITY_DENSITY, jam_density: JAM_DENSITY_PERSONS_M2, free_flow_speed_ms: FREE_FLOW_SPEED_MS, max_achievable_flow: Number(capacityFlow()[1].toFixed(2)), measured_not_assumed: [...MEASURED_NOT_ASSUMED] };
}

export class CrowdFlowServer {
  session: ScenarioSession | null = null;
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
  readonly people: PeopleStore;
  private unsubscribeLive: (() => void) | null = null;
  readonly server = createServer((request, response) => void this.handle(request, response));
  readonly sockets = new WebSocketServer({ noServer: true });
  private upgrades = new Set<Duplex>();
  constructor(readonly root: string, options: { databasePath?: string } = {}) {
    this.people = new PeopleStore(options.databasePath ?? (process.env.NODE_ENV === 'test' ? ':memory:' : join(root, '.data', 'crowdflow.sqlite')));
    this.server.on('upgrade', (request, socket, head) => {
      if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/ws') { socket.destroy(); return; }
      this.upgrades.add(socket); socket.once('close', () => this.upgrades.delete(socket));
      this.sockets.handleUpgrade(request, socket, head, (client) => this.sockets.emit('connection', client, request));
    });
    this.sockets.on('connection', (socket) => {
      if (!this.session) { socket.close(1013, 'no session started'); return; }
      const session = this.session;
      const hello: SocketFrame = { type: 'hello', session: session.info(), standards: standardsReport(), geometry_url: `/api/circuits/${session.circuit.pack.id}/geometry`, backlog: session.events, last_tick: session.lastEnvelope, live: this.live?.snapshot(Date.now() / 1000) ?? null };
      socket.send(JSON.stringify(hello));
      const unsubscribe = session.subscribe((tick) => socket.send(JSON.stringify({ type: 'tick', session: session.info(), tick } satisfies SocketFrame)));
      const heartbeat = setInterval(() => socket.send(JSON.stringify({ type: 'status', session: session.info() } satisfies SocketFrame)), 500);
      socket.on('close', () => { unsubscribe(); clearInterval(heartbeat); });
    });
  }
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
    const count = request.population ?? ASSUMED_DEMO_POPULATION; const seed = request.seed ?? 42;
    const { scenario, option } = buildScenario(circuit, request.scenario ?? 'egress', count, seed, request.origins, request.destination);
    this.session?.stop(); this.session = new ScenarioSession(circuit, scenario, option, count, request.participation ?? 0.18, request.intervene ?? true, request.speed ?? 1); this.spectator = new SpectatorFeed(this.session); this.session.subscribe((tick) => this.spectator?.observe(tick)); return this.session;
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
      if (!this.session) return;
      this.broadcast({ type: 'live', session: this.session.info(), live: snapshot });
    });
    return this.live;
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
      if (request.method === 'GET' && path === '/api/health') return json(response, 200, { ok: true, circuits: availableCircuits(this.root), session: this.session?.sessionId ?? null, status: this.session?.status ?? 'idle' });
      if (request.method === 'GET' && path === '/api/standards') return json(response, 200, standardsReport());
      if (request.method === 'GET' && path === '/api/circuits') return json(response, 200, availableCircuits(this.root).map((id) => summary(this.load(id))));
      const geometryMatch = path.match(/^\/api\/circuits\/([^/]+)\/geometry$/); if (request.method === 'GET' && geometryMatch) return json(response, 200, geometry(this.load(geometryMatch[1]!)));
      const scenarioMatch = path.match(/^\/api\/circuits\/([^/]+)\/scenarios$/); if (request.method === 'GET' && scenarioMatch) return json(response, 200, scenarioOptions(this.load(scenarioMatch[1]!)));
      if (request.method === 'GET' && path === '/api/session') return this.session ? json(response, 200, this.session.info()) : json(response, 404, { detail: 'no session started' });
      if (request.method === 'GET' && path === '/api/spectator/view') { if (!this.spectator) return json(response, 404, { detail: 'no session started' }); const origin = url.searchParams.get('origin') ?? ''; const destination = url.searchParams.get('destination') ?? ''; if (!origin || !destination) return json(response, 422, { detail: 'origin and destination are required' }); return json(response, 200, this.spectator.view({ origin, destination, online: url.searchParams.get('online') !== 'false', mesh_peers: Number(url.searchParams.get('mesh_peers') ?? 0), now_unix_s: Number(url.searchParams.get('now') ?? Date.now() / 1000) })); }
      if (request.method === 'GET' && path === '/api/events') return json(response, 200, races(this.root));
      if (request.method === 'GET' && path === '/api/events/current') { const next = currentRace(this.root, new Date()); return next ? json(response, 200, next) : json(response, 404, { detail: 'no calendar is committed' }); }
      const raceMatch = path.match(/^\/api\/events\/([^/]+)$/); if (request.method === 'GET' && raceMatch) { const found = race(this.root, raceMatch[1]!); return found ? json(response, 200, found) : json(response, 404, { detail: `no race ${raceMatch[1]}` }); }
      const anchorMatch = path.match(/^\/api\/circuits\/([^/]+)\/anchors$/); if (request.method === 'GET' && anchorMatch) return json(response, 200, anchorPack(this.root, anchorMatch[1]!));
      if (request.method === 'POST' && path === '/api/people/login') {
        const command = await body(request) as PersonLoginRequest;
        this.load(command.circuit_id);
        const person = this.people.login(command.person_id, command.circuit_id, Date.now() / 1000);
        if (this.session) this.broadcast({ type: 'person_joined', session: this.session.info(), person, live: this.live?.snapshot(Date.now() / 1000) ?? null });
        return json(response, 200, person);
      }
      const queryMatch = path.match(/^\/api\/circuits\/([^/]+)\/people\/query$/);
      if (request.method === 'POST' && queryMatch) {
        this.load(queryMatch[1]!);
        return json(response, 200, this.people.query(queryMatch[1]!, await body(request) as PeopleQuery));
      }
      const peopleMatch = path.match(/^\/api\/circuits\/([^/]+)\/people$/);
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
      if (request.method === 'POST' && path === '/api/session') return json(response, 200, this.startSession(await body(request)).info());
      if (request.method === 'POST' && path === '/api/session/control') { if (!this.session) return json(response, 404, { detail: 'no session started' }); const command = await body(request) as { action: 'play' | 'pause' | 'step' | 'speed'; speed?: number }; return json(response, 200, this.session.control(command.action, command.speed)); }
      return json(response, 404, { detail: 'not found' });
    } catch (error) { return json(response, 400, { detail: error instanceof Error ? error.message : String(error) }); }
  }
}

function json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage): Promise<any> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; }
