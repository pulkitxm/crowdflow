import { describe, expect, it, vi } from 'vitest';
import type { InferenceClient } from '@huggingface/inference';
import { HuggingFaceClient, resolveModelClient } from '../src/index.js';

function fakeClient(output: unknown) {
  const chatCompletion = vi.fn().mockResolvedValue(output);
  return { client: { chatCompletion } as unknown as InferenceClient, chatCompletion };
}

describe('HuggingFace ModelClient', () => {
  it('maps tool calls and text from the chat-completions response', async () => {
    const { client, chatCompletion } = fakeClient({
      choices: [{ message: { role: 'assistant', content: 'divert 30%', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'create_reroute', arguments: '{"target_fraction":0.3}' } }] } }],
    });
    const hf = new HuggingFaceClient({ model: 'test/model', client });
    const response = await hf.complete('system', [{ role: 'user', text: 'go' }], [{ name: 'create_reroute', description: 'd', input_schema: { type: 'object', properties: {} } }]);
    expect(response.text).toBe('divert 30%');
    expect(response.tool_calls[0]).toMatchObject({ id: 'call_1', name: 'create_reroute', arguments: { target_fraction: 0.3 } });
    const args = chatCompletion.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.messages).toEqual([{ role: 'system', content: 'system' }, { role: 'user', content: 'go' }]);
    expect((args.tools as Array<Record<string, unknown>>)[0]!.function).toMatchObject({ name: 'create_reroute' });
    expect(args.tool_choice).toBe('auto');
  });

  it('omits tools and tool_choice when none are supplied', async () => {
    const { client, chatCompletion } = fakeClient({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    await new HuggingFaceClient({ model: 'test/model', client }).complete('s', [{ role: 'user', text: 'hi' }], []);
    const args = chatCompletion.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.tools).toBeUndefined();
    expect(args.tool_choice).toBeUndefined();
  });

  it('flattens tool results into tool messages with tool_call_id', async () => {
    const { client, chatCompletion } = fakeClient({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    await new HuggingFaceClient({ model: 'test/model', client }).complete('s', [{ role: 'tool', tool_results: [{ call_id: '1', name: 'x', content: { a: 1 } }] }], []);
    const args = chatCompletion.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.messages).toContainEqual({ role: 'tool', tool_call_id: '1', content: '{"a":1}' });
  });

  it('resolves a huggingface client on request', () => {
    expect(resolveModelClient('huggingface')).toBeInstanceOf(HuggingFaceClient);
  });
});
