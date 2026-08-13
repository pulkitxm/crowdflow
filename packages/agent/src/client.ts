import Anthropic from '@anthropic-ai/sdk';

export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface ToolResult { call_id: string; name: string; content: Record<string, unknown> }
export interface Message { role: 'user' | 'assistant' | 'tool'; text?: string | undefined; tool_calls?: ToolCall[] | undefined; tool_results?: ToolResult[] | undefined; thinking_blocks?: unknown[] | undefined }
export interface ModelResponse { text?: string | undefined; tool_calls: ToolCall[]; thinking_blocks: unknown[] }
export interface ModelClient { complete(system: string, messages: Message[], tools: ToolSchema[]): Promise<ModelResponse> }
export interface ToolSchema { name: string; description: string; input_schema: Record<string, unknown> }

export class FakeModelClient implements ModelClient {
  readonly requests: Array<{ system: string; messages: Message[]; tools: ToolSchema[] }> = [];
  constructor(private readonly script: ModelResponse[]) {}
  async complete(system: string, messages: Message[], tools: ToolSchema[]): Promise<ModelResponse> {
    this.requests.push({ system, messages: structuredClone(messages), tools: structuredClone(tools) });
    const response = this.script.shift(); if (!response) throw new Error('fake model script exhausted'); return response;
  }
}

export class AnthropicClient implements ModelClient {
  constructor(readonly client = new Anthropic(), readonly model = 'claude-opus-4-6', readonly maxTokens = 16000) {}
  async complete(system: string, messages: Message[], tools: ToolSchema[]): Promise<ModelResponse> {
    const response = await this.client.messages.create({
      model: this.model, max_tokens: this.maxTokens, system,
      tools: tools as Anthropic.Tool[], messages: toAnthropic(messages),
    });
    return {
      text: response.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n') || undefined,
      tool_calls: response.content.filter((block) => block.type === 'tool_use').map((block) => ({ id: block.id, name: block.name, arguments: block.input as Record<string, unknown> })),
      thinking_blocks: response.content.filter((block) => block.type === 'thinking' || block.type === 'redacted_thinking'),
    };
  }
}

export function toAnthropic(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((message) => {
    if (message.role === 'tool') return { role: 'user', content: (message.tool_results ?? []).map((result) => ({ type: 'tool_result' as const, tool_use_id: result.call_id, content: JSON.stringify(result.content), is_error: 'error' in result.content })) };
    return { role: message.role, content: [
      ...((message.thinking_blocks ?? []) as Anthropic.ContentBlockParam[]),
      ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
      ...(message.tool_calls ?? []).map((call) => ({ type: 'tool_use' as const, id: call.id, name: call.name, input: call.arguments })),
    ] };
  });
}
