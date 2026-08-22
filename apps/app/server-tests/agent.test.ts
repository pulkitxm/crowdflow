import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModelClient, type ModelResponse } from '@crowdflow/agent';
import { AgentService, CrowdFlowServer } from '../server/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
let server: CrowdFlowServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

async function started(script: ModelResponse[]): Promise<{ port: number; fake: FakeModelClient }> {
  server = new CrowdFlowServer(root);
  const fake = new FakeModelClient(script);
  server.agent = new AgentService(() => fake);
  server.startSession({ circuit_id: 'silverstone', scenario: 'egress', population: 400, seed: 42 });
  server.session!.tickOnce();
  await server.listen(0);
  const address = server.server.address();
  return { port: typeof address === 'object' && address ? address.port : 0, fake };
}

describe('agent endpoint', () => {
  it('refuses to answer before any state exists', async () => {
    server = new CrowdFlowServer(root);
    server.agent = new AgentService(() => new FakeModelClient([]));
    await server.listen(0);
    const address = server.server.address(); const port = typeof address === 'object' && address ? address.port : 0;
    const { status, body } = await send(port, '/api/agent/ask', { question: 'how is the venue?' });
    expect(status).toBe(400);
    expect((body as any).detail).toContain('no crowd state');
  });

  it('answers from the scenario session and names the source', async () => {
    const { port, fake } = await started([
      { tool_calls: [{ id: '1', name: 'get_venue_state', arguments: {} }], thinking_blocks: [] },
      { text: 'Venue is nominal.', tool_calls: [], thinking_blocks: [] },
    ]);
    const { status, body } = await send(port, '/api/agent/ask', { question: 'how is the venue?' });
    expect(status).toBe(200);
    const answer = body as any;
    expect(answer.answer).toBe('Venue is nominal.');
    expect(answer.state_source).toBe('scenario');
    expect(answer.truncated).toBe(false);
    expect(answer.turns).toHaveLength(2);
    expect(answer.turns[0].calls[0].name).toBe('get_venue_state');
    expect(answer.turns[0].calls[0].result.circuit_id).toBe('silverstone');
    expect(fake.requests[0]!.tools.map((tool) => tool.name)).toContain('create_reroute');
  });

  it('rejects an unknown provider and a missing question by name', async () => {
    const { port } = await started([]);
    expect(((await send(port, '/api/agent/ask', { question: 'x', provider: 'openai' })).body as any).detail).toContain('unknown provider');
    expect(((await send(port, '/api/agent/ask', {})).body as any).detail).toContain('question is required');
  });

  it('reports status with the state source', async () => {
    const { port } = await started([]);
    const status = await get(port, '/api/agent') as any;
    expect(status.state_source).toBe('scenario');
    expect(typeof status.configured).toBe('boolean');
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
