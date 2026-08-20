
import type { RerouteOffer } from './types';

export interface ShowableOffer {
  reason: string;
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

export function isExpired(offer: RerouteOffer, now: number): boolean {
  return now >= offer.command.expires_at;
}
