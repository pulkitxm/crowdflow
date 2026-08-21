import { describe, expect, it, vi } from 'vitest';
import { GeminiClient, resolveModelClient, sanitizeSchema, toGeminiContents } from '../src/index.js';

function fakeFetch(payload: unknown, ok = true, status = 200) {
  const fetcher = vi.fn().mockResolvedValue({ ok, status, json: async () => payload });
  return { fetcher: fetcher as unknown as typeof fetch, calls: fetcher };
}

describe('Gemini ModelClient', () => {
  it('maps text and function calls from the generateContent response', async () => {
    const { fetcher, calls } = fakeFetch({
      candidates: [{ content: { parts: [{ text: 'divert 30%' }, { functionCall: { name: 'create_reroute', args: { target_fraction: 0.3 } } }] } }],
    });
    const gemini = new GeminiClient({ model: 'test-model', apiKey: 'k', fetch: fetcher });
    const response = await gemini.complete('system', [{ role: 'user', text: 'go' }], [{ name: 'create_reroute', description: 'd', input_schema: { type: 'object', properties: {}, additionalProperties: false } }]);
    expect(response.text).toBe('divert 30%');
    expect(response.tool_calls[0]).toMatchObject({ name: 'create_reroute', arguments: { target_fraction: 0.3 } });
    expect(response.tool_calls[0]!.id).toBeTruthy();
    const [url, init] = calls.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain('/models/test-model:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    const body = JSON.parse(init.body as string) as Record<string, any>;
    expect(body.system_instruction.parts[0].text).toBe('system');
    expect(body.tools[0].functionDeclarations[0].name).toBe('create_reroute');
    expect(body.tools[0].functionDeclarations[0].parameters.additionalProperties).toBeUndefined();
  });

  it('omits tools when none are supplied', async () => {
    const { fetcher, calls } = fakeFetch({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    await new GeminiClient({ model: 'm', apiKey: 'k', fetch: fetcher }).complete('s', [{ role: 'user', text: 'hi' }], []);
    const body = JSON.parse((calls.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.tools).toBeUndefined();
  });

  it('maps tool results to functionResponse parts and assistant calls to functionCall parts', () => {
    const contents = toGeminiContents([
      { role: 'user', text: 'q' },
      { role: 'assistant', text: 'looking', tool_calls: [{ id: '1', name: 'get_venue_state', arguments: {} }] },
      { role: 'tool', tool_results: [{ call_id: '1', name: 'get_venue_state', content: { observed_zones: 4 } }] },
    ]);
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ text: 'looking' }, { functionCall: { name: 'get_venue_state', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'get_venue_state', response: { observed_zones: 4 } } }] },
    ]);
  });

  it('captures thought signatures and echoes them on replayed function calls', async () => {
    const { fetcher } = fakeFetch({
      candidates: [{ content: { parts: [{ functionCall: { name: 'get_venue_state', args: {} }, thoughtSignature: 'sig-1' }] } }],
    });
    const gemini = new GeminiClient({ model: 'm', apiKey: 'k', fetch: fetcher });
    const response = await gemini.complete('s', [{ role: 'user', text: 'q' }], []);
    expect(response.thinking_blocks).toEqual([{ call_id: response.tool_calls[0]!.id, signature: 'sig-1' }]);
    const contents = toGeminiContents([
      { role: 'assistant', tool_calls: response.tool_calls, thinking_blocks: response.thinking_blocks },
    ]);
    expect(contents[0]!.parts[0]).toEqual({ functionCall: { name: 'get_venue_state', args: {} }, thoughtSignature: 'sig-1' });
  });

  it('strips additionalProperties recursively but keeps the rest of the schema', () => {
    expect(sanitizeSchema({ type: 'object', additionalProperties: false, properties: { avoid: { type: 'array', items: { type: 'string' } }, fraction: { type: 'number', minimum: 0, maximum: 1 } }, required: ['fraction'] })).toEqual({ type: 'object', properties: { avoid: { type: 'array', items: { type: 'string' } }, fraction: { type: 'number', minimum: 0, maximum: 1 } }, required: ['fraction'] });
  });

  it('retries transient 503s and succeeds within the delay budget', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) });
    const gemini = new GeminiClient({ model: 'm', apiKey: 'k', fetch: fetcher as unknown as typeof fetch, retryDelaysMs: [1] });
    const response = await gemini.complete('s', [{ role: 'user', text: 'hi' }], []);
    expect(response.text).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('honors the quota retry hint instead of the ladder delay', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded. Please retry in 0.001s.' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) });
    const gemini = new GeminiClient({ model: 'm', apiKey: 'k', fetch: fetcher as unknown as typeof fetch, retryDelaysMs: [1] });
    expect((await gemini.complete('s', [{ role: 'user', text: 'hi' }], [])).text).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and says how many attempts were made', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) });
    const gemini = new GeminiClient({ model: 'm', apiKey: 'k', fetch: fetcher as unknown as typeof fetch, retryDelaysMs: [1, 1] });
    await expect(gemini.complete('s', [{ role: 'user', text: 'hi' }], [])).rejects.toThrow('after 3 attempts');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('surfaces API errors with status and message', async () => {
    const { fetcher } = fakeFetch({ error: { message: 'API key not valid' } }, false, 400);
    await expect(new GeminiClient({ model: 'm', apiKey: 'bad', fetch: fetcher }).complete('s', [{ role: 'user', text: 'hi' }], [])).rejects.toThrow('Gemini m -> 400: API key not valid');
  });

  it('refuses to construct without a key and resolves from the provider switch', () => {
    const key = process.env.GEMINI_API_KEY; const google = process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;
    try {
      expect(() => new GeminiClient()).toThrow('GEMINI_API_KEY');
      process.env.GEMINI_API_KEY = 'k';
      expect(resolveModelClient('gemini')).toBeInstanceOf(GeminiClient);
    } finally {
      if (key == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
      if (google != null) process.env.GOOGLE_API_KEY = google;
    }
  });
});
