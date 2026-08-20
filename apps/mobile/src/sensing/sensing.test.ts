import { describe, expect, it, vi } from 'vitest';
import type { CrowdNode, IngestAck } from '@crowdflow/contracts';
import { LOCATION_DISCLOSURE_VERSION } from '@crowdflow/contracts';

import { iBeaconOf } from './ble';
import { Uplink } from './uplink';


const node = (timestamp: number): CrowdNode => ({
  node_id: 'nd-1', epoch: 7, timestamp, position: { x: 1, y: 2 },
  speed_ms: 1.2, heading_deg: 90, accuracy_m: 8,
});

function iBeaconPayload(uuidHex: string, major: number, minor: number): string {
  const bytes = [0x4c, 0x00, 0x02, 0x15];
  for (let index = 0; index < 32; index += 2) bytes.push(parseInt(uuidHex.slice(index, index + 2), 16));
  bytes.push((major >> 8) & 0xff, major & 0xff, (minor >> 8) & 0xff, minor & 0xff, 0xc5);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = [bytes[index]!, bytes[index + 1] ?? 0, bytes[index + 2] ?? 0];
    const word = (chunk[0]! << 16) | (chunk[1]! << 8) | chunk[2]!;
    out += alphabet[(word >> 18) & 63]! + alphabet[(word >> 12) & 63]!
      + (index + 1 < bytes.length ? alphabet[(word >> 6) & 63]! : '=')
      + (index + 2 < bytes.length ? alphabet[word & 63]! : '=');
  }
  return out;
}

describe('beacon identity', () => {
  const uuid = '0123456789abcdef0123456789abcdef';

  it('reads the iBeacon triple out of an advertisement', () => {
    expect(iBeaconOf(iBeaconPayload(uuid, 1, 42))).toBe(`${uuid}:1:42`);
  });

  it('separates two beacons that differ only in minor', () => {
    expect(iBeaconOf(iBeaconPayload(uuid, 1, 42))).not.toBe(iBeaconOf(iBeaconPayload(uuid, 1, 43)));
  });

  it('ignores anything that is not an iBeacon', () => {
    expect(iBeaconOf(null)).toBeNull();
    expect(iBeaconOf('AAAA')).toBeNull();
    expect(iBeaconOf(iBeaconPayload(uuid, 1, 1).slice(0, 8))).toBeNull();
  });
});

describe('uplink queue', () => {
  const ack = (over: Partial<IngestAck> = {}): IngestAck => ({
    accepted: 1, rejected: 0, problems: [], server_time: 1000, stop: false, ...over,
  });

  function uplink(fetchImpl: typeof fetch, onStop?: (reason: string) => void) {
    vi.stubGlobal('fetch', fetchImpl);
    return new Uplink({ baseUrl: 'http://venue', circuitId: 'silverstone', personId: 42, ...(onStop ? { onStop } : {}) });
  }

  it('sends a batch and reports what was accepted', async () => {
    const seen: unknown[] = [];
    const queue = uplink((async (_url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ack({ accepted: 2 }) } as unknown as Response;
    }) as unknown as typeof fetch);

    queue.enqueue(node(1000), 'wifi');
    queue.enqueue(node(1001), 'gnss');
    const result = await queue.flush(1002, 'nd-1', 7);

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(2);
    expect(queue.depth).toBe(0);
    expect(seen[0]).toMatchObject({ person_id: 42, consent_version: LOCATION_DISCLOSURE_VERSION, circuit_id: 'silverstone', sources: ['wifi', 'gnss'] });
  });

  it('keeps a batch, in order, when the venue is unreachable', async () => {
    const queue = uplink((async () => { throw new Error('network down'); }) as unknown as typeof fetch);
    queue.enqueue(node(1000), 'wifi');
    queue.enqueue(node(1001), 'wifi');
    const result = await queue.flush(1002, 'nd-1', 7);
    expect(result.ok).toBe(false);
    expect(queue.depth).toBe(2);

    let body: { nodes: CrowdNode[] } | null = null;
    vi.stubGlobal('fetch', (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ack({ accepted: 3 }) } as unknown as Response;
    }) as unknown as typeof fetch);
    queue.enqueue(node(1002), 'wifi');
    await queue.flush(1003, 'nd-1', 7);
    expect(body!.nodes.map((sample) => sample.timestamp)).toEqual([1000, 1001, 1002]);
  });

  it('drops a batch the venue rejected outright', async () => {
    const queue = uplink((async () => ({ ok: false, status: 422, json: async () => ack() } as unknown as Response)) as unknown as typeof fetch);
    queue.enqueue(node(1000), 'wifi');
    const result = await queue.flush(1001, 'nd-1', 7);
    expect(result.ok).toBe(false);
    expect(queue.depth).toBe(0);
  });

  it('keeps a batch the venue was not ready for', async () => {
    const queue = uplink((async () => ({ ok: false, status: 503, json: async () => ack() } as unknown as Response)) as unknown as typeof fetch);
    queue.enqueue(node(1000), 'wifi');
    await queue.flush(1001, 'nd-1', 7);
    expect(queue.depth).toBe(1);
  });

  it('acts on a stop, rather than logging it', async () => {
    const stops: string[] = [];
    const queue = uplink(
      (async () => ({ ok: true, status: 200, json: async () => ack({ stop: true, problems: ['disclosure withdrawn'] }) } as unknown as Response)) as unknown as typeof fetch,
      (reason) => stops.push(reason),
    );
    queue.enqueue(node(1000), 'wifi');
    await queue.flush(1001, 'nd-1', 7);
    expect(stops).toEqual(['disclosure withdrawn']);
  });

  it('drops samples too old for the reporting window before spending an upload on them', async () => {
    const queue = uplink((async () => ({ ok: true, status: 200, json: async () => ack({ accepted: 1 }) } as unknown as Response)) as unknown as typeof fetch);
    queue.enqueue(node(1000), 'wifi');
    queue.enqueue(node(1900), 'wifi');
    await queue.flush(1900, 'nd-1', 7);
    expect(queue.droppedCount).toBe(1);
  });

  it('forgets everything on an epoch rotation', async () => {
    const queue = uplink((async () => ({ ok: true, status: 200, json: async () => ack() } as unknown as Response)) as unknown as typeof fetch);
    queue.enqueue(node(1000), 'wifi');
    queue.clear();
    expect(queue.depth).toBe(0);
  });

  it('does not attempt an upload with no venue configured', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => ack() } as unknown as Response; }) as unknown as typeof fetch);
    const queue = new Uplink({ baseUrl: '', circuitId: 'silverstone', personId: 42 });
    queue.enqueue(node(1000), 'wifi');
    const result = await queue.flush(1001, 'nd-1', 7);
    expect(calls).toEqual([]);
    expect(result.problem).toContain('no venue is configured');
    expect(queue.depth).toBe(1);
  });
});
