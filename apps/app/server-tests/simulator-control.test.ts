import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { CrowdFlowServer } from '../server/app.js';
import { MAX_MODELED_POPULATION } from '../server/simulation-control.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
let server: CrowdFlowServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

async function running() {
  server = new CrowdFlowServer(root, { databasePath: ':memory:' });
  await server.listen(0);
  const address = server.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const started = await send(port, 'POST', '/api/session', { population: 120, tick_ms: 1000, duration_s: 120, join_rate_per_s: 10, movement_scale: 2, starting_person_id: 1000, participation: 1, compliance: 0.8, autostart: true });
  expect(started.status).toBe(200);
  return { port, session: server.session! };
}

describe('simulator lifecycle and validation', () => {
  it('rejects invalid configuration without clamping values', async () => {
    server = new CrowdFlowServer(root, { databasePath: ':memory:' });
    await server.listen(0);
    const address = server.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    expect((await send(port, 'POST', '/api/session', { population: 500001 })).body).toMatchObject({ detail: expect.stringContaining('population') });
    expect((await send(port, 'POST', '/api/session', { population: 1000, join_rate_per_s: 1, duration_s: 10 })).body).toMatchObject({ detail: expect.stringContaining('duration_s') });
    expect((await send(port, 'POST', '/api/session', { tick_ms: 19 })).body).toMatchObject({ detail: expect.stringContaining('tick_ms') });
  });

  it('prevents invalid transitions and overlapping starts', async () => {
    const { port } = await running();
    expect((await send(port, 'POST', '/api/session/control', { action: 'resume' })).status).toBe(400);
    expect((await send(port, 'POST', '/api/session', { population: 20 })).status).toBe(400);
    expect((await send(port, 'POST', '/api/session/control', { action: 'pause' })).status).toBe(200);
    expect((await send(port, 'POST', '/api/session/control', { action: 'resume' })).status).toBe(200);
    expect((await send(port, 'POST', '/api/session/control', { action: 'stop' })).body).toMatchObject({ status: 'completed' });
  });

  it('requires deliberate reset confirmation', async () => {
    const { port } = await running();
    expect((await send(port, 'POST', '/api/session/control', { action: 'reset' })).status).toBe(400);
    const reset = await send(port, 'POST', '/api/session/control', { action: 'reset', confirm: 'RESET' });
    expect(reset.body).toMatchObject({ lifecycle: 'idle', session: null });
  });

  it('models a 500000-person run with bounded agents and reporting nodes', () => {
    server = new CrowdFlowServer(root, { databasePath: ':memory:' });
    const session = server.startSession({ population: 500000, join_rate_per_s: 1000, tick_ms: 1000, duration_s: 86400, movement_scale: 90, participation: 1, starting_person_id: 1 });
    expect(session.population).toBe(500000);
    expect(session.sim.agents.length).toBeLessThanOrEqual(MAX_MODELED_POPULATION);
    expect(session.tickOnce().nodes!.length).toBeLessThanOrEqual(5000);
  });
});

describe('hazard control protocol', () => {
  it('applies, broadcasts, clears, and restores simultaneous hazards', async () => {
    const { port, session } = await running();
    const origin = session.option.origins![0]!;
    const gate = Object.values(session.circuit.pack.zones ?? {}).find((zone) => zone.kind === 'gate' && session.circuit.graph.neighbours(zone.id).length)?.id;
    const edge = Object.keys(session.circuit.pack.edges ?? {})[0]!;
    if (!gate) throw new Error('no connected gate');
    const fire = await send(port, 'POST', '/api/session/hazards', { type: 'fire', severity: 'high', mode: 'closed', radius_m: 10, location: { zone_id: origin } });
    const blockage = await send(port, 'POST', '/api/session/hazards', { type: 'gate_blockage', severity: 'medium', mode: 'restricted', capacity_percent: 40, location: { gate_id: gate } });
    const walkway = await send(port, 'POST', '/api/session/hazards', { type: 'walkway_blockage', severity: 'critical', mode: 'closed', location: { edge_id: edge } });
    expect((await get(port, '/api/session/state') as any).active_hazards).toHaveLength(3);
    expect(session.circuit.graph.isEdgeAvailable(edge)).toBe(false);
    const fireId = (fire.body as any).hazard.id;
    await send(port, 'DELETE', `/api/session/hazards/${fireId}`, {});
    expect((await get(port, '/api/session/state') as any).active_hazards).toHaveLength(2);
    expect((blockage.body as any).hazard.capacity_percent).toBe(40);
    expect((walkway.body as any).hazard.affected_edge_ids).toContain(edge);
    expect((await send(port, 'DELETE', '/api/session/hazards', {})).status).toBe(400);
    await send(port, 'DELETE', '/api/session/hazards', { confirm: 'CLEAR ALL' });
    expect((await get(port, '/api/session/state') as any).active_hazards).toHaveLength(0);
    expect(session.circuit.graph.isEdgeAvailable(edge)).toBe(true);
  });

  it('sends idle reconnect snapshots and monotonic scenario revisions', async () => {
    server = new CrowdFlowServer(root, { databasePath: ':memory:' });
    await server.listen(0);
    const address = server.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const frames: any[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await frameOf(socket, (frame) => frame.type === 'hello', frames);
    expect(frames[0].scenario_snapshot).toMatchObject({ lifecycle: 'idle', revision: 0 });
    await send(port, 'POST', '/api/session', { population: 20, autostart: false });
    const scenario = await frameOf(socket, (frame) => frame.type === 'scenario' && frame.scenario_snapshot?.session, frames);
    expect(scenario.revision).toBeGreaterThan(0);
    socket.close();
    const reconnectFrames: any[] = [];
    const reconnect = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const hello = await frameOf(reconnect, (frame) => frame.type === 'hello', reconnectFrames);
    expect(hello.scenario_snapshot.revision).toBeGreaterThanOrEqual(scenario.revision);
    expect(hello.scenario_snapshot.session.population).toBe(20);
    reconnect.close();
  });
});

function get(port: number, path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')));
    });
    req.on('error', reject); req.end();
  });
}

function send(port: number, method: string, path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

function frameOf(socket: WebSocket, predicate: (frame: any) => boolean, frames: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for WebSocket frame')), 5000);
    const onMessage = (data: Buffer) => {
      const frame = JSON.parse(data.toString());
      frames.push(frame);
      if (!predicate(frame)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(frame);
    };
    socket.on('message', onMessage);
    socket.on('error', reject);
  });
}
