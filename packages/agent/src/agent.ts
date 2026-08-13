import type { Message, ModelClient, ToolCall, ToolResult } from './client.js';
import { Toolbox } from './tools.js';
import type { Proposal } from './proposals.js';

export const MAX_TURNS = 8;
export const SYSTEM_PROMPT = `You are the Crowd Ops Agent for a Formula 1 circuit. Read what deterministic engines produced and explain it. Never compute density, routes, forecasts or walking times yourself. Zones classify on density, never flow. Unobserved means unknown, never empty. You recommend; you never act. create_reroute only creates a safety-reviewed proposal and nothing is dispatched. State intervention cost beside benefit and be brief.`;
export interface AgentTurn { text?: string | undefined; calls: ToolCall[]; results: ToolResult[] }
export interface AgentRun { question: string; answer?: string | undefined; turns: AgentTurn[]; proposals: Proposal[]; truncated: boolean }

export class CrowdOpsAgent {
  constructor(readonly client: ModelClient, readonly toolbox: Toolbox, readonly systemPrompt = SYSTEM_PROMPT, readonly maxTurns = MAX_TURNS) {}
  async ask(question: string): Promise<AgentRun> {
    const run: AgentRun = { question, turns: [], proposals: [], truncated: false };
    const messages: Message[] = [{ role: 'user', text: question }];
    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await this.client.complete(this.systemPrompt, messages, this.toolbox.schemas());
      if (!response.tool_calls.length) { run.turns.push({ text: response.text, calls: [], results: [] }); run.answer = response.text; run.proposals = this.toolbox.proposals; return run; }
      const results = response.tool_calls.map((call) => ({ call_id: call.id, name: call.name, content: this.toolbox.invoke(call.name, call.arguments) }));
      run.turns.push({ text: response.text, calls: response.tool_calls, results });
      messages.push({ role: 'assistant', text: response.text, tool_calls: response.tool_calls, thinking_blocks: response.thinking_blocks });
      messages.push({ role: 'tool', tool_results: results });
    }
    run.truncated = true; run.answer = `Stopped after ${this.maxTurns} turns; nothing was dispatched.`; run.proposals = this.toolbox.proposals; return run;
  }
}
