import { randomUUID } from 'node:crypto';
import type { RerouteCommand, SafetyVerdict, VenueState } from '@crowdflow/contracts';
import { COMMAND_TTL_S, SafetyEngine, VenueGraph } from '@crowdflow/core';

export interface Proposal { command: RerouteCommand; verdict: SafetyVerdict; expected_cost_s: number }
export function proposalSummary(proposal: Proposal): Record<string, unknown> {
  return { command_id: proposal.command.command_id, outcome: proposal.verdict.outcome, reason: proposal.verdict.reason, violated_constraints: proposal.verdict.violated_constraints ?? [], dispatched: false, note: 'Safety-reviewed proposal only. Nothing was sent to the mesh.', source_zone: proposal.command.source_zone, destination_zone: proposal.command.destination_zone, avoid: proposal.command.avoid ?? [], prefer: proposal.command.prefer ?? [], target_fraction: proposal.command.target_fraction, expected_cost_s: proposal.expected_cost_s };
}
export class ProposalLedger {
  readonly proposals: Proposal[] = [];
  constructor(readonly safety: SafetyEngine) {}
  propose(input: { now: number; source_zone: string; destination_zone: string; avoid: string[]; prefer: string[]; target_fraction: number; reason: string; expected_cost_s: number; state?: VenueState; graph?: VenueGraph }): Proposal {
    const command: RerouteCommand = { command_id: `agent-${randomUUID().slice(0, 8)}`, issued_at: input.now, expires_at: input.now + COMMAND_TTL_S, source_zone: input.source_zone, destination_zone: input.destination_zone, avoid: [...input.avoid], prefer: [...input.prefer], target_fraction: input.target_fraction, reason: input.reason, expected_cost_s: input.expected_cost_s };
    const verdict = this.safety.review(command, input.state, input.graph);
    const proposal = { command, verdict, expected_cost_s: input.expected_cost_s }; this.proposals.push(proposal); return proposal;
  }
  get approved(): Proposal[] { return this.proposals.filter((proposal) => proposal.verdict.dispatchable); }
  get rejected(): Proposal[] { return this.proposals.filter((proposal) => !proposal.verdict.dispatchable); }
}
