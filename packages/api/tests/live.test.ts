import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CrowdNode, NodeReport } from '@crowdflow/contracts';
import { ASSUMED_ID_ROTATION_S, LOCATION_DISCLOSURE_VERSION } from '@crowdflow/contracts';
import { CrowdFlowServer } from '../src/index.js';

/**
 * Live ingest, end to end over HTTP.
 *
 * Every assertion here is about a REJECTION being visible. The accept path is
 * one line and hard to get wrong; the failure modes that matter are the silent
 * ones — a batch dropped for a reason nobody reports, which on the console is
 * indistinguishable from a quiet venue and calls for the opposite response.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
let server: CrowdFlowServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

/** Somewhere inside Silverstone's venue bounds. */
const INSIDE = { x: 120, y: 240 };

function node(now: number, over: Partial<CrowdNode> = {}): CrowdNode {
  return {
    node_id: 'nd-abcdef', epoch: Math.floor(now / ASSUMED_ID_ROTATION_S), timestamp: Math.round(now),
    position: INSIDE, speed_ms: 1.3, heading_deg: 45, accuracy_m: 9, ...over,
  };
}

function report(now: number, nodes: CrowdNode[], over: Partial<NodeReport> = {}): NodeReport {
  return {
    node_id: 'nd-abcdef', epoch: Math.floor(now / ASSUMED_ID_ROTATION_S), circuit_id: 'silverstone',
    consent_version: LOCATION_DISCLOSURE_VERSION, nodes, sources: ['wifi'], ...over,
  };
}

async function armed(): Promise<{ port: number }> {
  server = new CrowdFlowServer(root);
  server.startLive({ circuit_id: 'silverstone', participation: 0.18 });
  await server.listen(0);
  const address = server.server.address();
  return { port: typeof address === 'object' && address ? address.port : 0 };
}

describe('live handset ingest', () => {
  it('refuses reports until an operator arms it', async () => {
    server = new CrowdFlowServer(root); await server.listen(0);
    const address = server.server.address(); const port = typeof address === 'object' && address ? address.port : 0;
    const now = Date.now() / 1000;
    // 503, not 4xx: the venue is not listening yet, which is a state a handset
    // should keep its samples for rather than discard them over.
    const { status } = await send(port, '/api/nodes', report(now, [node(now)]));
    expect(status).toBe(503);
    expect((await get(port, '/api/live') as any).detail).toContain('not running');
  });

  it('accepts a batch and places it in a zone', async () => {
    const { port } = await armed();
    const now = Date.now() / 1000;
    const ack = (await send(port, '/api/nodes', report(now, [node(now)]))).body as any;
    expect(ack.accepted).toBe(1);
    expect(ack.stop).toBe(false);
    // The server clock comes back on every ack so a handset can correct its own
    // drift without a time API — the staleness window is decided on timestamps.
    expect(Math.abs(ack.server_time - now)).toBeLessThan(5);

    const live = await get(port, '/api/live') as any;
    expect(live.reporting_devices).toBe(1);
    expect(live.coverage.observed).toBeGreaterThan(0);
    expect(live.by_source.wifi).toBe(1);
    // Assumed until a capture-recapture measurement exists, and labelled so the
    // console never renders the population figure as though it were measured.
    expect(live.participation_provenance).toBe('assumed');
  });

  it('names the reason a sample was dropped', async () => {
    const { port } = await armed();
    const now = Date.now() / 1000;
    const outside = (await send(port, '/api/nodes', report(now, [node(now, { position: { x: 900_000, y: 900_000 } })]))).body as any;
    expect(outside.accepted).toBe(0);
    expect(outside.problems.join(' ')).toContain('outside venue bounds');

    const skewed = (await send(port, '/api/nodes', report(now, [node(now, { timestamp: Math.round(now) - 600 })]))).body as any;
    expect(skewed.accepted).toBe(0);
    expect(skewed.problems.join(' ')).toContain('clock skew');

    const live = await get(port, '/api/live') as any;
    // Counted by reason, worst first. '3,400 rejected' is not actionable; the
    // reason turns it into a wrong circuit id in somebody's build.
    expect(Object.keys(live.problems).length).toBeGreaterThanOrEqual(2);
    expect(live.rejected_total).toBeGreaterThanOrEqual(2);
  });

  it('tells a handset to stop when it cites a disclosure that is not served', async () => {
    const { port } = await armed();
    const now = Date.now() / 1000;
    const ack = (await send(port, '/api/nodes', report(now, [node(now)], { consent_version: 'location-disclosure.v0' }))).body as any;
    expect(ack.accepted).toBe(0);
    // Stop, not merely reject: a phone sensing under a withdrawn disclosure must
    // stop sensing, not keep sensing and stop uploading.
    expect(ack.stop).toBe(true);
  });

  it('refuses a sample that does not belong to the reporting node', async () => {
    const { port } = await armed();
    const now = Date.now() / 1000;
    const ack = (await send(port, '/api/nodes', report(now, [node(now, { node_id: 'nd-someone-else' })]))).body as any;
    expect(ack.accepted).toBe(0);
    expect(ack.problems.join(' ')).toContain('does not belong');
  });

  it('keeps two epochs of one handset apart', async () => {
    const { port } = await armed();
    const now = Date.now() / 1000;
    const epoch = Math.floor(now / ASSUMED_ID_ROTATION_S);
    await send(port, '/api/nodes', report(now, [node(now)]));
    // Same pseudonym, previous epoch — which a real rotation makes vanishingly
    // unlikely, and which must not be joined to the current one even so.
    await send(port, '/api/nodes', report(now, [node(now, { epoch: epoch - 1 })], { epoch: epoch - 1 }));
    const live = await get(port, '/api/live') as any;
    expect(live.reporting_devices).toBe(2);
  });

  it('rejects an enormous batch rather than ingesting it', async () => {
    const { port } = await armed();
    const now = Date.now() / 1000;
    const huge = Array.from({ length: 500 }, (_, index) => node(now - index % 20));
    const ack = (await send(port, '/api/nodes', report(now, huge))).body as any;
    expect(ack.accepted).toBe(0);
    expect(ack.problems.join(' ')).toContain('exceeds');
  });

  it('forgets everything when an operator clears it', async () => {
    const { port } = await armed();
    const now = Date.now() / 1000;
    await send(port, '/api/nodes', report(now, [node(now)]));
    const cleared = (await send(port, '/api/live', {}, 'DELETE')).body as any;
    expect(cleared.reporting_devices).toBe(0);
    expect(cleared.accepted_total).toBe(0);
  });

  it('serves an empty anchor pack for a venue with no survey', async () => {
    server = new CrowdFlowServer(root); await server.listen(0);
    const address = server.server.address(); const port = typeof address === 'object' && address ? address.port : 0;
    const pack = await get(port, '/api/circuits/silverstone/anchors') as any;
    expect(pack.circuit_id).toBe('silverstone');
    // Present-and-empty, never a 404: 'no anchors here' is a fact a handset must
    // act on — it means fall through to GNSS — not an error to interpret.
    expect(typeof pack.anchors).toBe('object');
  });

  it('will not arm live ingest without a participation estimate', async () => {
    server = new CrowdFlowServer(root); await server.listen(0);
    const address = server.server.address(); const port = typeof address === 'object' && address ? address.port : 0;
    const { status, body } = await send(port, '/api/live', { circuit_id: 'silverstone' });
    expect(status).toBe(400);
    // estimated_population is devices divided by this rate, so a default here
    // would put a plausible number on an operator's wall that nobody chose.
    expect((body as any).detail).toContain('participation');
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

function send(port: number, path: string, payload: unknown, method = 'POST'): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = request(
      { host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
      },
    );
    req.on('error', reject); req.write(data); req.end();
  });
}
