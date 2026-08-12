import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoopbackTransport } from '../transports/loopbackTransport';

afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('loopback transport', () => {
  it('aborts a backend request that cannot complete', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    vi.stubGlobal('fetch', fetcher);
    const transport = new LoopbackTransport(() => 'http://backend.test');
    await transport.start('1234');

    const sending = expect(transport.broadcast(new Uint8Array([1]))).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(4_500);
    await sending;
    await transport.stop();
  });

  it('rejects packets above the radio protocol ceiling before fetching', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const transport = new LoopbackTransport(() => 'http://backend.test');
    await transport.start('1234');
    await expect(transport.broadcast(new Uint8Array(256))).rejects.toThrow(/255/);
    expect(fetcher).not.toHaveBeenCalled();
    await transport.stop();
  });
});
