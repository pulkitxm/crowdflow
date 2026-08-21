import type { CircuitPack, VenueState } from '@crowdflow/contracts';
import { InterventionEngine, SafetyEngine } from '@crowdflow/core';
import { CrowdOpsAgent, InsightEngine, Toolbox, proposalSummary, resolveModelClient, type ModelClient, type ModelProvider, type OpsContext, type Proposal } from '@crowdflow/agent';
import type { LiveIngest } from './live.js';
import type { ScenarioSession } from './session.js';
import type { AgentAskRequest, AgentAskResponse, AgentStateSource, AgentStatus } from './wire.js';

const PROVIDERS: ModelProvider[] = ['anthropic', 'huggingface', 'gemini'];
export const DEFAULT_API_PROVIDER: ModelProvider = PROVIDERS.find((provider) => provider === process.env.CROWDFLOW_MODEL_PROVIDER) ?? 'gemini';

export interface PendingProposal {
  proposal: Proposal;
  circuit_id: string;
}

const PENDING_LIMIT = 100;

export class AgentService {
  private insightEngines = new Map<string, InsightEngine>();
  private pending = new Map<string, PendingProposal>();
  constructor(readonly resolveClient: (provider: ModelProvider) => ModelClient = resolveModelClient) {}

  proposal(commandId: string): PendingProposal | null {
    return this.pending.get(commandId) ?? null;
  }

  observe(pack: CircuitPack, state: VenueState): void {
    this.insights(pack).observe(state);
  }

  status(session: ScenarioSession | null, live: LiveIngest | null): AgentStatus {
    const provider = DEFAULT_API_PROVIDER;
    let configured = true; let detail: string | null = null;
    try { this.resolveClient(provider); } catch (error) { configured = false; detail = error instanceof Error ? error.message : String(error); }
    return { provider, configured, detail, state_source: pickSource(session, live) };
  }

  async ask(request: AgentAskRequest, session: ScenarioSession | null, live: LiveIngest | null, now: number): Promise<AgentAskResponse> {
    const question = request.question?.trim();
    if (!question) throw new Error('question is required');
    const provider = request.provider == null ? DEFAULT_API_PROVIDER : PROVIDERS.find((known) => known === request.provider);
    if (!provider) throw new Error(`unknown provider ${request.provider}; expected one of ${PROVIDERS.join(', ')}`);

    const source = pickSource(session, live);
    if (!source) throw new Error('no crowd state yet — start a session (POST /api/session) or arm live ingest (POST /api/live)');
    const circuit = source === 'live' ? live!.circuit : session!.circuit;
    const state = source === 'live' ? live!.snapshot(now, false).state : session!.lastEnvelope!.state;

    const context: OpsContext = { pack: circuit.pack, graph: circuit.graph, safety: new SafetyEngine(circuit.pack), state, now, insights: this.insights(circuit.pack) };
    if (session?.lastEnvelope?.forecasts) context.forecasts = session.lastEnvelope.forecasts;
    if (session) { context.simulation = session.sim; context.intervention = new InterventionEngine(); }

    const client = this.resolveClient(provider);
    const run = await new CrowdOpsAgent(client, new Toolbox(context)).ask(question);
    for (const item of run.proposals) {
      this.pending.set(item.command.command_id, { proposal: item, circuit_id: circuit.pack.id });
    }
    while (this.pending.size > PENDING_LIMIT) {
      const oldest = this.pending.keys().next().value;
      if (oldest == null) break;
      this.pending.delete(oldest);
    }
    return {
      question: run.question,
      answer: run.answer ?? null,
      provider,
      model: 'model' in client && typeof client.model === 'string' ? client.model : null,
      state_source: source,
      truncated: run.truncated,
      turns: run.turns.map((turn) => ({ text: turn.text ?? null, calls: turn.calls.map((call, index) => ({ name: call.name, arguments: call.arguments, result: turn.results[index]?.content ?? {} })) })),
      proposals: run.proposals.map(proposalSummary),
    };
  }

  private insights(pack: CircuitPack): InsightEngine {
    const existing = this.insightEngines.get(pack.id);
    if (existing) return existing;
    const created = new InsightEngine(pack);
    this.insightEngines.set(pack.id, created);
    return created;
  }
}

function pickSource(session: ScenarioSession | null, live: LiveIngest | null): AgentStateSource | null {
  if (live && Object.keys(live.snapshot(Date.now() / 1000, false).state.zones ?? {}).length) return 'live';
  if (session?.lastEnvelope) return 'scenario';
  return live ? 'live' : null;
}
