import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModelClient } from '@crowdflow/agent';
import { AgentService, CrowdFlowServer, loadCircuit } from '../server/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SOURCE = 'view_n';
const DESTINATION = 'view_e';
let server: CrowdFlowServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

async function askedForReroute(): Promise<{ port: number; commandId: string }> {
  server = new CrowdFlowServer(root);
  server.agent = new AgentService(() => new FakeModelClient([
    { tool_calls: [{ id: '1', name: 'create_reroute', arguments: { source_zone: SOURCE, destination_zone: DESTINATION, avoid: [SOURCE], prefer: [DESTINATION], target_fraction: 0.4, reason: 'test dispatch' } }], thinking_blocks: [] },
    { text: 'Proposed.', tool_calls: [], thinking_blocks: [] },
  ]));
  server.startSession({ circuit_id: 'silverstone', scenario: 'egress', population: 300, seed: 42 });
  server.session!.circuit.pack.capability = 'venue_reviewed';
  server.session!.circuit.operational = true;
  server.session!.tickOnce();
  const origin = loadCircuit(root, 'silverstone').pack.zones?.[SOURCE]?.position;
  if (!origin) throw new Error(`${SOURCE} has no position in the pack`);
  const now = Date.now() / 1000;
  for (const personId of [5, 7, 99]) {
    server.people.login(personId, 'silverstone', now);
    server.people.updateLocation(personId, 'silverstone', origin, 1.2, 4, 'gnss', now, null);
  }
  await server.listen(0);
  const address = server.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const asked = (await send(port, '/api/agent/ask', { question: 'reroute please' })).body as any;
  return { port, commandId: asked.proposals[0].command_id as string };
}

describe('crowd control dispatch', () => {
  it('approving a proposal steers the simulation and targets the cohort by fraction', async () => {
    const { port, commandId } = await askedForReroute();
    const { status, body } = await send(port, `/api/agent/proposals/${commandId}/approve`, {});
    expect(status).toBe(200);
    const dispatched = body as any;
    expect(dispatched.applied_to_simulation).toBe(true);
    expect(dispatched.source_zone).toBe(SOURCE);
    expect(dispatched.expires_in_s).toBeGreaterThan(0);
    expect(dispatched.via[0]).toBe(SOURCE);
    expect(dispatched.via.at(-1)).toBe(DESTINATION);
    expect(dispatched.cohort.targeted).toBe(2);
    expect(dispatched.cohort.pinged).toBe(0);
    expect(server!.session!.loop.activeCommand?.command_id).toBe(commandId);
    expect([...server!.session!.sim.avoid]).toContain(SOURCE);
  });

  it('serves per-person guidance, counts pings, and refuses double dispatch', async () => {
    const { port, commandId } = await askedForReroute();
    await send(port, `/api/agent/proposals/${commandId}/approve`, {});
    const forPerson = await get(port, '/api/circuits/silverstone/guidance?person_id=5') as any;
    expect(forPerson.guidance).toHaveLength(1);
    expect(forPerson.guidance[0]).toMatchObject({ person_id: 5, command_id: commandId, from_zone: SOURCE, to_zone: DESTINATION });
    const everyone = await get(port, '/api/circuits/silverstone/guidance') as any;
    expect(everyone.guidance.map((record: any) => record.person_id).sort()).toEqual([5, 7]);
    const commands = await get(port, '/api/agent/commands') as any;
    expect(commands.commands[0].cohort.pinged).toBe(2);
    expect((await send(port, `/api/agent/proposals/${commandId}/approve`, {})).status).toBe(400);
  });

  it('targets every nearby person, not the lowest thousand ids', async () => {
    const { port, commandId } = await askedForReroute();
    const origin = loadCircuit(root, 'silverstone').pack.zones?.[SOURCE]?.position;
    if (!origin) throw new Error(`${SOURCE} has no position`);
    const now = Date.now() / 1000;
    server!.people.transaction(() => {
      for (let personId = 1000; personId < 4000; personId++) {
        server!.people.login(personId, 'silverstone', now);
        server!.people.updateLocation(personId, 'silverstone', origin, 1.1, 4, 'gnss', now, null);
      }
    });
    const dispatched = (await send(port, `/api/agent/proposals/${commandId}/approve`, {})).body as any;
    expect(dispatched.cohort.targeted).toBeGreaterThan(1000);
    const commands = await get(port, '/api/agent/commands') as any;
    expect(commands.commands[0].cohort.targeted).toBe(dispatched.cohort.targeted);
  });

  it('404s an unknown proposal and refuses a rejected one', async () => {
    const { port } = await askedForReroute();
    expect((await send(port, '/api/agent/proposals/agent-nope/approve', {})).status).toBe(404);
  });
});

function get(port: number, path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
    req.on('error', reject); req.end();
  });
}

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
    req.on('error', reject); req.write(data); req.end();
  });
}
