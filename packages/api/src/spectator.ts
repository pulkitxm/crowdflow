import type { AheadView, CircuitPack, CrossingNotice, LinkStatus, RerouteCommand, Route, SafetyVerdict, SpectatorView, Step, VenueState, WayAhead } from '@crowdflow/contracts';
import { isOpenDuring, validCommandAt } from '@crowdflow/contracts';
import { VenueGraph } from '@crowdflow/core';
import type { ScenarioSession } from './session.js';
import type { TickEnvelope } from './wire.js';

export class SpectatorFeedUnavailable extends Error {}
export const SPECTATOR_OFFER_RETENTION_S = 300;
export interface ActiveOffer { command: RerouteCommand; verdict: SafetyVerdict; dispatched_at: number }

export class SpectatorFeed {
  private offers = new Map<string, ActiveOffer>();
  constructor(readonly session: ScenarioSession) {}
  observe(envelope: TickEnvelope): void {
    if (envelope.dispatched && envelope.command && envelope.verdict?.dispatchable) this.offers.set(envelope.command.command_id, { command: envelope.command, verdict: envelope.verdict, dispatched_at: envelope.time_s });
    for (const [id, offer] of this.offers) if (!validCommandAt(offer.command, envelope.time_s) || envelope.time_s - offer.dispatched_at > SPECTATOR_OFFER_RETENTION_S) this.offers.delete(id);
  }
  view(request: SpectatorRequest): SpectatorView {
    const envelope = this.session.lastEnvelope; if (!envelope) throw new SpectatorFeedUnavailable('no crowd tick is available yet'); this.observe(envelope);
    return buildSpectatorView(this.session.circuit.graph, envelope, request, [...this.offers.values()]);
  }
}

export interface SpectatorRequest { origin: string; destination: string; online?: boolean; mesh_peers?: number; now_unix_s?: number }
export function buildSpectatorView(graph: VenueGraph, envelope: TickEnvelope, request: SpectatorRequest, offers: ActiveOffer[] = []): SpectatorView {
  const online = request.online ?? true; const peers = request.mesh_peers ?? 0; if (peers < 0) throw new Error('mesh_peers must be non-negative');
  const route = buildRoute(graph, envelope.state, request.origin, request.destination); const now = request.now_unix_s ?? Date.now() / 1000;
  // Simulation timestamps are relative. Freshness is translated once at the API boundary.
  const ageS = Math.max(0, envelope.time_s - envelope.state.timestamp); const link: LinkStatus = { online, mesh_peers: peers, updated_at: now - ageS };
  if (!online) return { kind: 'offline', now, link, route };
  const path = graph.route(request.origin, request.destination).path;
  const active = offers.filter((offer) => offer.verdict.dispatchable && validCommandAt(offer.command, envelope.time_s) && path.includes(offer.command.source_zone)).sort((a, b) => b.dispatched_at - a.dispatched_at || a.command.command_id.localeCompare(b.command.command_id))[0];
  if (!active) return { kind: 'walk', now, link, route };
  const instead = buildRoute(graph, envelope.state, request.origin, request.destination, new Set(active.command.avoid ?? []), new Set(active.command.prefer ?? []), `${route.id}-reroute`);
  const step = Math.min(path.indexOf(active.command.source_zone), route.steps.length - 1); if (step < 0) throw new SpectatorFeedUnavailable('an affected route has no walkable leg');
  return { kind: 'ahead', now, link, route, step_id: route.steps[step]!.id, offer: { command: active.command, verdict: active.verdict, instead } } satisfies AheadView;
}

export function buildRoute(graph: VenueGraph, state: VenueState, origin: string, destination: string, avoid = new Set<string>(), prefer = new Set<string>(), routeId = 'current-route'): Route {
  const result = graph.route(origin, destination, undefined, avoid, prefer); const steps: Step[] = [];
  for (let index = 0; index < result.path.length - 1; index += 1) {
    const source = result.path[index]!; const target = result.path[index + 1]!; const edge = selectEdge(graph.pack, source, target, state.session_id ?? null, avoid);
    if (!edge) throw new SpectatorFeedUnavailable(`route edge missing: ${source} -> ${target}`);
    const zone = state.zones?.[target] ?? state.zones?.[source]; const way = (zone?.band ?? 'unknown') as WayAhead; const speed = zone?.mean_speed_ms && zone.mean_speed_ms > 0 ? zone.mean_speed_ms : edge.free_speed_ms?.value;
    const walk = speed && speed > 0 ? edge.length_m / speed : result.distance_m > 0 ? result.eta_s * edge.length_m / result.distance_m : 0;
    steps.push({ id: `${routeId}-leg-${index}`, to: label(graph.pack, target), walk_s: Number(walk.toFixed(1)), way_ahead: way, crossing: crossing(graph.pack, edge.id, state.session_id ?? null) });
  }
  return { id: routeId, from: label(graph.pack, origin), to: label(graph.pack, destination), steps, total_walk_s: Number(result.eta_s.toFixed(1)) };
}

function selectEdge(pack: CircuitPack, source: string, destination: string, session: string | null, avoid: Set<string>) {
  return Object.values(pack.edges ?? {}).filter((edge) => !avoid.has(edge.id) && ((edge.source === source && edge.destination === destination) || ((edge.bidirectional ?? true) && edge.source === destination && edge.destination === source))).filter((edge) => { const item = Object.values(pack.crossings ?? {}).find((value) => value.edge_id === edge.id); return !item?.availability || isOpenDuring(item.availability, session); }).sort((a, b) => a.length_m - b.length_m || a.id.localeCompare(b.id))[0];
}
function crossing(pack: CircuitPack, edgeId: string, session: string | null): CrossingNotice | null {
  const item = Object.values(pack.crossings ?? {}).find((value) => value.edge_id === edgeId); if (!item) return null; const open = !item.availability || isOpenDuring(item.availability, session); return { name: item.id.replaceAll('_', ' '), state: open ? { open: true, closes_at: null } : { open: false, opens_at: null } };
}
function label(pack: CircuitPack, id: string): string { return pack.zones?.[id]?.name ?? id; }
