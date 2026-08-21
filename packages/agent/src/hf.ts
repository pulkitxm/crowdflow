import { InferenceClient } from '@huggingface/inference';
import type { Message, ModelClient, ModelResponse, ToolSchema } from './client.js';
import { AnthropicClient } from './client.js';
import { GeminiClient } from './gemini.js';

export const DEFAULT_HF_MODEL = process.env.CROWDFLOW_HF_MODEL ?? 'meta-llama/Llama-3.3-70B-Instruct';

type ChatArgs = Parameters<InferenceClient['chatCompletion']>[0];

export interface HuggingFaceClientOptions {
  model?: string;
  token?: string;
  endpointUrl?: string;
  maxTokens?: number;
  /** Injectable for tests; defaults to a real InferenceClient. */
  client?: InferenceClient;
}

/**
 * A `ModelClient` backed by the Hugging Face Inference API chat-completions
 * endpoint, using OpenAI-style tool calling. Slots in behind the same seam as
 * `AnthropicClient`, so the agent reasoning loop and toolbox are untouched.
 */
export class HuggingFaceClient implements ModelClient {
  readonly model: string;
  readonly maxTokens: number;
  private readonly client: InferenceClient;

  constructor(options: HuggingFaceClientOptions = {}) {
    this.model = options.model ?? DEFAULT_HF_MODEL;
    this.maxTokens = options.maxTokens ?? 16000;
    this.client = options.client ?? new InferenceClient(options.token, options.endpointUrl ? { endpointUrl: options.endpointUrl } : undefined);
  }

  async complete(system: string, messages: Message[], tools: ToolSchema[]): Promise<ModelResponse> {
    const args: ChatArgs = {
      model: this.model,
      messages: toHfMessages(system, messages),
      max_tokens: this.maxTokens,
      temperature: 0.2,
    };
    if (tools.length) {
      args.tools = toHfTools(tools);
      args.tool_choice = 'auto';
    }
    const response = await this.client.chatCompletion(args);
    const message = response.choices[0]?.message;
    const tool_calls = (message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    }));
    return { text: message?.content || undefined, tool_calls, thinking_blocks: [] };
  }
}

function toHfTools(tools: ToolSchema[]): NonNullable<ChatArgs['tools']> {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  }));
}

function toHfMessages(system: string, messages: Message[]): NonNullable<ChatArgs['messages']> {
  const out: NonNullable<ChatArgs['messages']> = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.text ?? '' });
    } else if (message.role === 'assistant') {
      const assistant: NonNullable<ChatArgs['messages']>[number] = { role: 'assistant' };
      if (message.text != null) assistant.content = message.text;
      if (message.tool_calls?.length) {
        assistant.tool_calls = message.tool_calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }));
      }
      out.push(assistant);
    } else {
      for (const result of message.tool_results ?? []) {
        out.push({ role: 'tool', tool_call_id: result.call_id, content: JSON.stringify(result.content) });
      }
    }
  }
  return out;
}

function parseArguments(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

export type ModelProvider = 'anthropic' | 'huggingface' | 'gemini';
export const DEFAULT_MODEL_PROVIDER: ModelProvider = process.env.CROWDFLOW_MODEL_PROVIDER === 'huggingface' ? 'huggingface' : process.env.CROWDFLOW_MODEL_PROVIDER === 'gemini' ? 'gemini' : 'anthropic';

/** Pick the agent's model client from `CROWDFLOW_MODEL_PROVIDER`; Anthropic remains the default. */
export function resolveModelClient(provider: ModelProvider = DEFAULT_MODEL_PROVIDER): ModelClient {
  if (provider === 'huggingface') return new HuggingFaceClient();
  if (provider === 'gemini') return new GeminiClient();
  return new AnthropicClient();
}
