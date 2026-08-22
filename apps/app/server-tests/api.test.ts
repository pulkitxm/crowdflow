import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { CrowdFlowServer } from '../server/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
let server: CrowdFlowServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

describe('TypeScript API adapter', () => {
  it('serves the real Silverstone graph and constants', async () => {
    server = new CrowdFlowServer(root); await server.listen(0);
    const address = server.server.address(); const port = typeof address === 'object' && address ? address.port : 0;
    const geometry = await get(port, '/api/circuits/silverstone/geometry') as any;
    expect(Object.keys(geometry.pack.zones)).toHaveLength(1875);
    expect(Object.keys(geometry.pack.edges)).toHaveLength(2404);
    expect(geometry.integrity_problems).toEqual([]);
    const standards = await get(port, '/api/standards') as any;
    expect(standards.bands.map((band: any) => band.label)).toEqual(['NOMINAL', 'BUILDING', 'CRITICAL']);
  });

  it('serves a wall-clock spectator conclusion without exposing the envelope', async () => {
    server = new CrowdFlowServer(root); const session = server.startSession({ population: 100, intervene: false }); session.control('step'); await server.listen(0);
    const address = server.server.address(); const port = typeof address === 'object' && address ? address.port : 0;
    const origin = session.option.origins![0]!; const view = await get(port, `/api/spectator/view?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(session.option.destination!)}&now=1700000000`) as any;
    expect(['walk', 'ahead']).toContain(view.kind); expect(view.now).toBe(1700000000); expect(view.link.updated_at).toBeGreaterThan(1600000000); expect(view.state).toBeUndefined(); expect(view.metrics).toBeUndefined();
    expect(view.route.steps.some((step: any) => step.way_ahead === 'unknown')).toBe(true);
  });

  it('offers and runs the arrival control scenario without code changes', async () => {
    server = new CrowdFlowServer(root); await server.listen(0); const address = server.server.address(); const port = typeof address === 'object' && address ? address.port : 0;
    const options = await get(port, '/api/circuits/silverstone/scenarios') as any[]; expect(options.map((option) => option.id)).toEqual(['egress', 'arrival']); const session = server.startSession({ scenario: 'arrival', population: 20, intervene: false }); expect(session.option.id).toBe('arrival'); expect(session.tickOnce().population.total).toBe(20);
  });

  it('streams a hello and a real tick over WebSocket', async () => {
    server = new CrowdFlowServer(root); const session = server.startSession({ population: 100, intervene: false }); await server.listen(0);
    const address = server.server.address(); const port = typeof address === 'object' && address ? address.port : 0;
    const frames: any[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString()); frames.push(frame);
        if (frame.type === 'hello') session.control('step');
        if (frame.type === 'tick') resolve();
      });
      socket.on('error', reject);
    });
    socket.close();
    expect(frames[0].type).toBe('hello');
    expect(frames.at(-1).tick.coverage.zones_total).toBe(1875);
    expect(frames.at(-1).tick.coverage.unknown).toBeGreaterThan(frames.at(-1).tick.coverage.observed);
  });
});

function get(port: number, path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path }, (response) => {
      const chunks: Buffer[] = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
    req.on('error', reject); req.end();
  });
}
