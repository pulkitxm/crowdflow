import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { ASSUMED_ID_ROTATION_S, LOCATION_DISCLOSURE_VERSION } from '@crowdflow/contracts';
import { simulateLiveCrowd } from '@crowdflow/cli/simulator';
import { CrowdFlowServer, PeopleStore, gridSizeForZoom } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
let server: CrowdFlowServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

describe('people locations', () => {
  it('stores sequential people and returns an exact requested count inside four coordinates', () => {
    const store = new PeopleStore(':memory:');
    for (let personId = 1; personId <= 5; personId++) {
      store.login(personId, 'silverstone', 1000 + personId);
      store.updateLocation(personId, 'silverstone', { x: personId * 10, y: personId * 10 }, 1.2, 5, 'gnss', 1100 + personId, 'gate-a');
    }
    const result = store.query('silverstone', {
      coordinates: [{ x: 0, y: 0 }, { x: 35, y: 0 }, { x: 35, y: 35 }, { x: 0, y: 35 }],
      zoom: 1,
      count: 2,
    });
    expect(result.matched_count).toBe(3);
    expect(result.returned_count).toBe(2);
    expect(result.people.map((person) => person.person_id)).toEqual([1, 2]);
    expect(result.people[0]?.gate_id).toBe('gate-a');
    expect(result.grid_size_m).toBe(100);
    store.close();
  });

  it('adjusts the grid down to ten metres', () => {
    expect([gridSizeForZoom(1), gridSizeForZoom(2), gridSizeForZoom(4), gridSizeForZoom(8)]).toEqual([100, 50, 25, 10]);
  });

  it('rejects malformed coordinate queries', () => {
    const store = new PeopleStore(':memory:');
    expect(() => store.query('silverstone', { coordinates: [{ x: 0, y: 0 }], zoom: 1 })).toThrow('four points');
    expect(() => store.login(0, 'silverstone', 1000)).toThrow('positive integer');
    store.close();
  });

  it('logs in, updates, queries, and broadcasts a person over the API', async () => {
    server = new CrowdFlowServer(root, { databasePath: ':memory:' });
    server.startSession({ population: 20, intervene: false });
    server.startLive({ circuit_id: 'silverstone', participation: 1 });
    await server.listen(0);
    const address = server.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const frames: any[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        frames.push(frame);
        if (frame.type === 'hello') void send(port, '/api/people/login', { person_id: 7, circuit_id: 'silverstone' });
        if (frame.type === 'person_joined') resolve();
      });
      socket.on('error', reject);
    });
    const now = Date.now() / 1000;
    const epoch = Math.floor(now / ASSUMED_ID_ROTATION_S);
    const report = {
      person_id: 7,
      gate_id: 'gate-7',
      node_id: 'node-7',
      epoch,
      circuit_id: 'silverstone',
      consent_version: LOCATION_DISCLOSURE_VERSION,
      sources: ['gnss'],
      nodes: [{ node_id: 'node-7', epoch, timestamp: now, position: { x: 120, y: 240 }, speed_ms: 1.1, heading_deg: 20, accuracy_m: 4 }],
    };
    await send(port, '/api/nodes', report);
    const query = await send(port, '/api/circuits/silverstone/people/query', {
      coordinates: [{ x: 100, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 300 }, { x: 100, y: 300 }],
      zoom: 9,
      count: 1,
    });
    socket.close();
    expect(frames.some((frame) => frame.type === 'person_joined' && frame.person.person_id === 7)).toBe(true);
    expect((query.body as any).people[0]).toMatchObject({ person_id: 7, gate_id: 'gate-7', source: 'gnss' });
    expect((query.body as any).grid_size_m).toBe(10);
  });

  it('populates sequential people from circuit gates with the script simulator', async () => {
    server = new CrowdFlowServer(root, { databasePath: ':memory:' });
    server.startSession({ population: 20, intervene: false });
    server.startLive({ circuit_id: 'silverstone', participation: 1 });
    await server.listen(0);
    const address = server.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await simulateLiveCrowd({
      api: `http://127.0.0.1:${port}`,
      circuitId: 'silverstone',
      people: 3,
      ratePerSecond: 100,
      tickMs: 20,
      durationS: 0.03,
      seed: 8,
      startPersonId: 900,
    });
    const result = await simulateLiveCrowd({
      api: `http://127.0.0.1:${port}`,
      circuitId: 'silverstone',
      people: 12,
      ratePerSecond: 100,
      tickMs: 20,
      durationS: 0.12,
      seed: 9,
      startPersonId: 1,
      reset: true,
    });
    expect(result.joined).toBe(12);
    expect(result.reset).toBe(true);
    expect(result.removed).toBe(3);
    expect(result.gates.length).toBeGreaterThan(1);
    expect(server.people.list('silverstone', 20).map((person) => person.person_id)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(server.live?.snapshot(Date.now() / 1000).reporting_devices).toBe(12);
  });

  it('distributes a completed race arrival wave across circuit viewing areas', async () => {
    server = new CrowdFlowServer(root, { databasePath: ':memory:' });
    server.startSession({ population: 20, intervene: false });
    server.startLive({ circuit_id: 'silverstone', participation: 1 });
    await server.listen(0);
    const address = server.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await simulateLiveCrowd({
      api: `http://127.0.0.1:${port}`,
      circuitId: 'silverstone',
      people: 102,
      ratePerSecond: 1000,
      tickMs: 20,
      durationS: 0.12,
      seed: 19,
      startPersonId: 1,
      movementScale: 100_000,
    });
    const people = server.people.list('silverstone', 200);
    const occupied = new Set(people.map((person) => `${Math.floor(person.position.x / 100)}:${Math.floor(person.position.y / 100)}`));
    const xs = people.map((person) => person.position.x);
    const ys = people.map((person) => person.position.y);
    expect(occupied.size).toBeGreaterThanOrEqual(12);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(900);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1000);
  });
});

function send(port: number, path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
