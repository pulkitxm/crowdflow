import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectivityState, NodeTelemetry } from '../core/contracts';

vi.mock('../storage/outageBuffer', () => ({
  OutageBuffer: class {},
}));
import { TelemetryUploader, type TelemetryOutbox } from '../network/telemetryUploader';
import type { BufferedBatch } from '../storage/outageBuffer';

class MemoryOutbox implements TelemetryOutbox {
  entries: BufferedBatch[];
  constructor(bodies: string[] = []) {
    this.entries = bodies.map((body, index) => ({ body, createdAt: index }));
  }
  add(body: string): void { this.entries.push({ body, createdAt: 0 }); }
  peek(): BufferedBatch | undefined { return this.entries[0]; }
  removeFirst(): void { this.entries.shift(); }
  size(): number { return this.entries.length; }
}

const settings = { backendUrl: 'http://backend.test' };
const telemetry: NodeTelemetry = {
  node_id: '1234', timestamp: 100, position: { x: 1, y: 2 }, position_accuracy: 3,
  velocity: 1, direction: 90, zone: 'gate_a', confidence: .8, source: 'phone',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('telemetry outage recovery', () => {
  it('reports and immediately replays an existing disk backlog', async () => {
    vi.useFakeTimers();
    const outbox = new MemoryOutbox(['{"batch":[]}']);
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    const uploader = new TelemetryUploader(settings as never, outbox, fetcher);
    const connectivity: ConnectivityState[] = [];
    uploader.connectivityChanged.subscribe((value) => connectivity.push(value));

    uploader.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.size()).toBe(0);
    expect(uploader.snapshot().buffered).toBe(0);
    expect(connectivity).toEqual(['restored']);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(connectivity).toEqual(['restored']);
    await vi.advanceTimersByTimeAsync(1);
    expect(connectivity).toEqual(['restored', 'online']);
    uploader.stop();
  });

  it('aborts a stalled upload and preserves the batch in the outage queue', async () => {
    vi.useFakeTimers();
    const outbox = new MemoryOutbox();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Pick<Response, 'ok' | 'status'>>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const uploader = new TelemetryUploader(settings as never, outbox, fetcher, 100);
    const connectivity: ConnectivityState[] = [];
    uploader.connectivityChanged.subscribe((value) => connectivity.push(value));
    uploader.start();
    await Promise.resolve();
    uploader.offer(telemetry);

    const flushing = uploader.flushNow();
    await vi.advanceTimersByTimeAsync(100);
    await flushing;

    expect(outbox.size()).toBe(1);
    expect(uploader.snapshot()).toMatchObject({ failures: 1, buffered: 1 });
    expect(connectivity).toEqual(['local-only']);
    uploader.stop();
  });
});
