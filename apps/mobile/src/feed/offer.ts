/**
 * The last mile of invariant 4: the agent recommends, it never acts.
 *
 * The safety engine's verdict is enforced server-side before a command is issued
 * to the mesh, and enforcing it again on the client is not redundancy theatre —
 * a phone in a mesh receives whatever its neighbours forward, including messages
 * that were replayed, held from an earlier epoch, or crafted. The client is the
 * only place that can decide what a *person* is shown, so it checks the verdict
 * that travelled with the command and refuses anything else.
 *
 * `modified` is refused too. A verdict does not carry a replacement command, so
 * there is nothing safe to dispatch in that outcome; the contract's served
 * `dispatchable` field is false. A correction must become a new command and pass
 * a fresh review before it can be shown.
 */

import type { RerouteOffer } from './types';

/** An offer that has passed the gate and may be put in front of a person. */
export interface ShowableOffer {
  /** Plain language, straight from the command. Never rewritten on the client. */
  reason: string;
  /** Honest added seconds. Shown above the button, before it can be pressed. */
  cost_s: number;
  offer: RerouteOffer;
}

export function showableOffer(offer: RerouteOffer): ShowableOffer | null {
  if (!offer.verdict.dispatchable || offer.verdict.outcome !== 'approved') return null;
  if (offer.verdict.command_id !== offer.command.command_id) return null;
  return {
    reason: offer.command.reason,
    cost_s: offer.command.expected_cost_s,
    offer,
  };
}

/**
 * Whether a command has outlived its usefulness.
 *
 * Reroute commands expire because stale routing is actively harmful: sending
 * people around a crossing that reopened five minutes ago creates the queue it
 * was trying to prevent. Expiry is carried on the command, not decided here.
 */
export function isExpired(offer: RerouteOffer, now: number): boolean {
  return now >= offer.command.expires_at;
}
