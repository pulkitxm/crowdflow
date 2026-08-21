import type { Message, ModelClient, ModelResponse, ToolCall, ToolSchema } from './client.js';

export const DEFAULT_GEMINI_MODEL = process.env.CROWDFLOW_GEMINI_MODEL ?? 'gemini-3.6-flash';
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiClientOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  fetch?: typeof fetch;
  retryDelaysMs?: number[];
}

export const DEFAULT_RETRY_DELAYS_MS = [500, 2000, 5000];
const RETRYABLE_STATUS = new Set([429, 500, 503, 529]);

interface GeminiPart { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> }; thoughtSignature?: string }
export interface GeminiThoughtSignature { call_id: string; signature: string }
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }
interface GeminiResponse { candidates?: Array<{ content?: { parts?: GeminiPart[] } }>; error?: { message?: string } }

export class GeminiClient implements ModelClient {
  readonly model: string;
  readonly maxTokens: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly retryDelaysMs: number[];
  private calls = 0;

  constructor(options: GeminiClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('GeminiClient needs an API key: set GEMINI_API_KEY (free at https://aistudio.google.com/apikey)');
    this.apiKey = apiKey;
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.maxTokens = options.maxTokens ?? 16000;
    this.baseUrl = (options.baseUrl ?? GEMINI_BASE_URL).replace(/\/$/, '');
    this.fetcher = options.fetch ?? fetch;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  async complete(system: string, messages: Message[], tools: ToolSchema[]): Promise<ModelResponse> {
    const request: Record<string, unknown> = {
      system_instruction: { parts: [{ text: system }] },
      contents: toGeminiContents(messages),
      generationConfig: { maxOutputTokens: this.maxTokens, temperature: 0.2 },
    };
    if (tools.length) request.tools = [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: sanitizeSchema(tool.input_schema) })) }];
    const payload = await this.send(request);
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((part) => part.text).map((part) => part.text).join('\n') || undefined;
    const thinking_blocks: GeminiThoughtSignature[] = [];
    const tool_calls: ToolCall[] = parts.filter((part) => part.functionCall).map((part) => {
      const id = `gemini-call-${++this.calls}`;
      if (part.thoughtSignature) thinking_blocks.push({ call_id: id, signature: part.thoughtSignature });
      return { id, name: part.functionCall!.name, arguments: part.functionCall!.args ?? {} };
    });
    return { text, tool_calls, thinking_blocks };
  }

  private async send(request: Record<string, unknown>): Promise<GeminiResponse> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetcher(`${this.baseUrl}/models/${this.model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(request),
      });
      const payload = await response.json() as GeminiResponse;
      if (response.ok) return payload;
      const delay = this.retryDelaysMs[attempt];
      if (RETRYABLE_STATUS.has(response.status) && delay != null) {
        const hinted = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(payload.error?.message ?? '');
        await new Promise((resolve) => setTimeout(resolve, hinted ? Math.min(Number(hinted[1]) * 1000 + 250, 20000) : delay));
        continue;
      }
      throw new Error(`Gemini ${this.model} -> ${response.status}: ${payload.error?.message ?? 'request failed'}${RETRYABLE_STATUS.has(response.status) ? ` (after ${attempt + 1} attempts)` : ''}`);
    }
  }
}

export function toGeminiContents(messages: Message[]): GeminiContent[] {
  return messages.map((message) => {
    if (message.role === 'tool') return { role: 'user', parts: (message.tool_results ?? []).map((result) => ({ functionResponse: { name: result.name, response: result.content } })) };
    if (message.role === 'assistant') {
      const signatures = new Map(((message.thinking_blocks ?? []) as GeminiThoughtSignature[]).filter((block) => block && typeof block.signature === 'string').map((block) => [block.call_id, block.signature]));
      return { role: 'model', parts: [
        ...(message.text ? [{ text: message.text }] : []),
        ...(message.tool_calls ?? []).map((call): GeminiPart => {
          const signature = signatures.get(call.id);
          return signature ? { functionCall: { name: call.name, args: call.arguments }, thoughtSignature: signature } : { functionCall: { name: call.name, args: call.arguments } };
        }),
      ] };
    }
    return { role: 'user', parts: [{ text: message.text ?? '' }] };
  });
}

export function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, property]) => [name, sanitizeSchema(property as Record<string, unknown>)]));
    } else if (key === 'items' && value && typeof value === 'object') {
      out[key] = sanitizeSchema(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}
