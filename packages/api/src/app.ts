import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse } from 'node:url';
import { WebSocketServer } from 'ws';
import { CAPACITY_DENSITY, DENSITY_BUILDING_MAX, DENSITY_NOMINAL_MAX, FREE_FLOW_SPEED_MS, JAM_DENSITY_PERSONS_M2, LOS_A_MAX, LOS_B_MAX, LOS_C_MAX, LOS_D_MAX, LOS_E_MAX, MEASURED_NOT_ASSUMED } from '@crowdflow/contracts';
import { capacityFlow, egress } from '@crowdflow/core';
import { availableCircuits, geometry, loadCircuit, summary, type LoadedCircuit } from './packs.js';
import { ScenarioSession } from './session.js';
import type { ScenarioOption, SessionRequest, SocketFrame, StandardsReport } from './wire.js';

export function standardsReport(): StandardsReport {
  return { source: 'Fruin, "Pedestrian Planning and Design" (1971), walkway LOS', bands: [
    { band: 'nominal', label: 'NOMINAL', los_grades: 'A-C', density_min: 0, density_max: DENSITY_NOMINAL_MAX },
    { band: 'building', label: 'BUILDING', los_grades: 'D-E', density_min: DENSITY_NOMINAL_MAX, density_max: DENSITY_BUILDING_MAX },
    { band: 'critical', label: 'CRITICAL', los_grades: 'F', density_min: DENSITY_BUILDING_MAX, density_max: null },
  ], los: ([LOS_A_MAX, LOS_B_MAX, LOS_C_MAX, LOS_D_MAX, LOS_E_MAX].map((max, index, list) => ({ grade: 'ABCDE'[index]!, flow_min: index ? list[index - 1]! : 0, flow_max: max as number | null, note: 'Fruin walkway LOS' }))).concat([{ grade: 'F', flow_min: LOS_E_MAX, flow_max: null, note: 'flow breaks down' }]), capacity_density: CAPACITY_DENSITY, jam_density: JAM_DENSITY_PERSONS_M2, free_flow_speed_ms: FREE_FLOW_SPEED_MS, max_achievable_flow: Number(capacityFlow()[1].toFixed(2)), measured_not_assumed: [...MEASURED_NOT_ASSUMED] };
}

export class CrowdFlowServer {
  session: ScenarioSession | null = null;
  private circuits = new Map<string, LoadedCircuit>();
  readonly server = createServer((request, response) => void this.handle(request, response));
  readonly sockets = new WebSocketServer({ noServer: true });
  constructor(readonly root: string) {
    this.server.on('upgrade', (request, socket, head) => {
      if (parse(request.url ?? '').pathname !== '/ws') { socket.destroy(); return; }
      this.sockets.handleUpgrade(request, socket, head, (client) => this.sockets.emit('connection', client, request));
    });
    this.sockets.on('connection', (socket) => {
      if (!this.session) { socket.close(1013, 'no session started'); return; }
      const session = this.session;
      const hello: SocketFrame = { type: 'hello', session: session.info(), standards: standardsReport(), geometry_url: `/api/circuits/${session.circuit.pack.id}/geometry`, backlog: session.events, last_tick: session.lastEnvelope };
      socket.send(JSON.stringify(hello));
      const unsubscribe = session.subscribe((tick) => socket.send(JSON.stringify({ type: 'tick', session: session.info(), tick } satisfies SocketFrame)));
      const heartbeat = setInterval(() => socket.send(JSON.stringify({ type: 'status', session: session.info() } satisfies SocketFrame)), 500);
      socket.on('close', () => { unsubscribe(); clearInterval(heartbeat); });
    });
  }
  listen(port = 8099, host = '127.0.0.1'): Promise<void> { return new Promise((resolve) => this.server.listen(port, host, resolve)); }
  close(): Promise<void> { this.session?.stop(); for (const socket of this.sockets.clients) socket.close(); return new Promise((resolve) => this.server.close(() => resolve())); }

  startSession(request: SessionRequest = {}): ScenarioSession {
    const circuit = this.load(request.circuit_id ?? 'silverstone');
    const exit = request.destination ?? defaultExit(circuit);
    const origins = request.origins ?? standsReaching(circuit, exit);
    const count = request.population ?? 2500; const seed = request.seed ?? 42;
    const scenario = egress(circuit.graph, origins, exit, count, seed);
    const option: ScenarioOption = { id: 'egress', name: 'Post-race egress', description: scenario.description, origins, destination: exit, origin_names: origins.map((id) => circuit.pack.zones?.[id]?.name ?? id), destination_name: circuit.pack.zones?.[exit]?.name ?? exit };
    this.session?.stop(); this.session = new ScenarioSession(circuit, scenario, option, count, request.participation ?? 0.18, request.intervene ?? true, request.speed ?? 1); return this.session;
  }
  private load(id: string): LoadedCircuit { const cached = this.circuits.get(id); if (cached) return cached; const circuit = loadCircuit(this.root, id); this.circuits.set(id, circuit); return circuit; }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = parse(request.url ?? '/', true); const path = url.pathname ?? '/';
      if (request.method === 'GET' && path === '/api/health') return json(response, 200, { ok: true, circuits: availableCircuits(this.root), session: this.session?.sessionId ?? null, status: this.session?.status ?? 'idle' });
      if (request.method === 'GET' && path === '/api/standards') return json(response, 200, standardsReport());
      if (request.method === 'GET' && path === '/api/circuits') return json(response, 200, availableCircuits(this.root).map((id) => summary(this.load(id))));
      const geometryMatch = path.match(/^\/api\/circuits\/([^/]+)\/geometry$/); if (request.method === 'GET' && geometryMatch) return json(response, 200, geometry(this.load(geometryMatch[1]!)));
      const scenarioMatch = path.match(/^\/api\/circuits\/([^/]+)\/scenarios$/); if (request.method === 'GET' && scenarioMatch) { const circuit = this.load(scenarioMatch[1]!); const exit = defaultExit(circuit); const origins = standsReaching(circuit, exit); return json(response, 200, [{ id: 'egress', name: 'Post-race egress', description: 'Everyone leaves at the flag', origins, destination: exit, origin_names: origins.map((id) => circuit.pack.zones?.[id]?.name ?? id), destination_name: circuit.pack.zones?.[exit]?.name ?? exit }]); }
      if (request.method === 'GET' && path === '/api/session') return this.session ? json(response, 200, this.session.info()) : json(response, 404, { detail: 'no session started' });
      if (request.method === 'POST' && path === '/api/session') return json(response, 200, this.startSession(await body(request)).info());
      if (request.method === 'POST' && path === '/api/session/control') { if (!this.session) return json(response, 404, { detail: 'no session started' }); const command = await body(request) as { action: 'play' | 'pause' | 'step' | 'speed'; speed?: number }; return json(response, 200, this.session.control(command.action, command.speed)); }
      return json(response, 404, { detail: 'not found' });
    } catch (error) { return json(response, 400, { detail: error instanceof Error ? error.message : String(error) }); }
  }
}

function defaultExit(circuit: LoadedCircuit): string { const parks = Object.values(circuit.pack.zones ?? {}).filter((zone) => zone.kind === 'parking'); if (!parks.length) throw new Error('no parking zone'); return parks.sort((a, b) => circuit.graph.reachable(b.id).size - circuit.graph.reachable(a.id).size)[0]!.id; }
function standsReaching(circuit: LoadedCircuit, exit: string): string[] { const component = circuit.graph.reachable(exit); return Object.values(circuit.pack.zones ?? {}).filter((zone) => zone.kind === 'viewing' && component.has(zone.id)).map((zone) => zone.id).sort(); }
function json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage): Promise<any> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; }
