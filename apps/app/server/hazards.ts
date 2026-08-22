import type { Agent } from '@crowdflow/core';
import type { ConsoleEvent, GateAvailability, HazardRecord, HazardRequest } from '@crowdflow/contracts/wire';
import type { ScenarioSession } from './session.js';

export class HazardController {
  private records: HazardRecord[] = [];
  private sequence = 0;
  private evacuation = false;

  constructor(private readonly session: ScenarioSession) {}

  active(): HazardRecord[] { return this.records.filter((record) => record.status === 'active').map(copyHazard); }
  history(): HazardRecord[] { return this.records.map(copyHazard); }
  evacuationEnabled(): boolean { return this.evacuation; }

  apply(request: HazardRequest): HazardRecord {
    validateRequest(request, this.session);
    const impact = resolveImpact(request, this.session);
    const record: HazardRecord = {
      ...request,
      location: { ...request.location, position: request.location.position ? { ...request.location.position } : request.location.position },
      capacity_percent: request.mode === 'closed' ? 0 : request.capacity_percent,
      radius_m: request.radius_m ?? 0,
      id: `haz-${++this.sequence}`,
      status: 'active',
      created_at_s: this.session.sim.timeS,
      cleared_at_s: null,
      affected_people: 0,
      rerouted_people: 0,
      awaiting_safe_route: 0,
      replacement_exits: [],
      affected_zone_ids: [...impact.zones].sort(),
      affected_edge_ids: [...impact.edges].sort(),
    };
    this.records.push(record);
    this.recalculate(record);
    return copyHazard(record);
  }

  clear(id: string): HazardRecord {
    const record = this.records.find((entry) => entry.id === id && entry.status === 'active');
    if (!record) throw new Error(`active hazard ${id} was not found`);
    record.status = 'cleared';
    record.cleared_at_s = this.session.sim.timeS;
    this.recalculate();
    return copyHazard(record);
  }

  clearAll(): HazardRecord[] {
    const cleared: HazardRecord[] = [];
    for (const record of this.records) {
      if (record.status !== 'active') continue;
      record.status = 'cleared';
      record.cleared_at_s = this.session.sim.timeS;
      cleared.push(copyHazard(record));
    }
    this.recalculate();
    return cleared;
  }

  setEvacuation(enabled: boolean): void {
    this.evacuation = enabled;
    this.session.loop.safety.emergencyMode = enabled;
    this.recalculate();
  }

  gateAvailability(): GateAvailability[] {
    const graph = this.session.circuit.graph;
    const zones = this.session.circuit.pack.zones ?? {};
    const active = this.active();
    return Object.values(zones)
      .filter((zone) => zone.kind === 'gate' || zone.kind === 'exit' || zone.kind === 'parking')
      .map((zone) => {
        const hazards = active.filter((hazard) => hazard.affected_zone_ids.includes(zone.id));
        const capacity = hazards.reduce((value, hazard) => Math.min(value, hazard.mode === 'closed' ? 0 : hazard.capacity_percent ?? 100), 100);
        return {
          id: zone.id,
          name: zone.name ?? zone.id,
          kind: zone.kind,
          available: graph.isZoneAvailable(zone.id),
          capacity_percent: capacity,
          hazard_ids: hazards.map((hazard) => hazard.id),
          replacement_exit_ids: [...new Set(hazards.flatMap((hazard) => hazard.replacement_exits))].sort(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  warning(): string | null {
    const awaiting = Math.round(this.session.sim.awaitingRoute * this.session.populationScale);
    return awaiting > 0 ? `${awaiting.toLocaleString()} people are awaiting a safe route` : null;
  }

  events(): ConsoleEvent[] {
    return this.session.events.filter((event) => event.kind === 'hazard' || event.kind === 'evacuation');
  }

  private recalculate(focus?: HazardRecord): void {
    const graph = this.session.circuit.graph;
    const active = this.records.filter((record) => record.status === 'active');
    const closedEdges = new Set<string>();
    const closedZones = new Set<string>();
    const edgeCapacity = new Map<string, number>();
    const zoneCapacity = new Map<string, number>();
    for (const hazard of active) {
      const factor = (hazard.capacity_percent ?? 100) / 100;
      for (const id of hazard.affected_edge_ids) {
        if (hazard.mode === 'closed') closedEdges.add(id);
        else edgeCapacity.set(id, Math.min(edgeCapacity.get(id) ?? 1, factor));
      }
      for (const id of hazard.affected_zone_ids) {
        if (hazard.mode === 'closed') closedZones.add(id);
        else zoneCapacity.set(id, Math.min(zoneCapacity.get(id) ?? 1, factor));
      }
    }
    graph.setOperationalRestrictions({ closedEdges, closedZones, edgeCapacity, zoneCapacity });
    const affectedAgents = this.session.sim.agents.filter((agent) => !agent.arrived && (this.evacuation || active.some((hazard) => affectsAgent(hazard, agent))));
    const affectedIds = new Set(affectedAgents.map((agent) => agent.id));
    this.session.sim.invalidateRoutes();
    const replacements = new Set<string>();
    let rerouted = 0;
    for (const agent of this.session.sim.agents) {
      if (agent.arrived) continue;
      if (this.evacuation || !graph.isZoneAvailable(agent.destination)) {
        const exit = safestExit(agent, this.session);
        if (exit) {
          if (agent.destination !== exit) rerouted += 1;
          agent.destination = exit;
          agent.pending_leg = null;
          agent.itinerary = [];
          replacements.add(exit);
        }
      }
    }
    if (focus) {
      focus.affected_people = Math.round(affectedIds.size * this.session.populationScale);
      focus.replacement_exits = [...replacements].sort();
    }
    this.session.sim.stepRoutes();
    if (focus) {
      focus.awaiting_safe_route = Math.round(this.session.sim.awaitingRoute * this.session.populationScale);
      focus.rerouted_people = Math.max(Math.round(rerouted * this.session.populationScale), focus.affected_people - focus.awaiting_safe_route);
      if (!focus.replacement_exits.length) {
        focus.replacement_exits = [...new Set(affectedAgents.map((agent) => agent.destination).filter((id) => graph.isZoneAvailable(id)))].sort();
      }
    }
  }
}

function validateRequest(request: HazardRequest, session: ScenarioSession): void {
  if (!['fire', 'gate_blockage', 'walkway_blockage', 'exit_unavailable'].includes(request.type)) throw new Error('unknown hazard type');
  if (!['low', 'medium', 'high', 'critical'].includes(request.severity)) throw new Error('unknown hazard severity');
  if (!['closed', 'restricted'].includes(request.mode)) throw new Error('hazard mode must be closed or restricted');
  if (request.mode === 'restricted' && !(Number.isFinite(request.capacity_percent) && request.capacity_percent! > 0 && request.capacity_percent! < 100)) throw new Error('restricted hazards need capacity_percent between 0 and 100');
  if (request.type === 'walkway_blockage' && !session.circuit.pack.edges?.[request.location.edge_id ?? '']) throw new Error('walkway blockage needs a known edge_id');
  const zoneId = request.location.gate_id ?? request.location.zone_id;
  if ((request.type === 'gate_blockage' || request.type === 'exit_unavailable') && !session.circuit.pack.zones?.[zoneId ?? '']) throw new Error(`${request.type} needs a known zone`);
  if (request.type === 'gate_blockage' && session.circuit.pack.zones?.[zoneId ?? '']?.kind !== 'gate') throw new Error('gate blockage target must be a gate');
  if (request.type === 'fire') {
    if (!(request.location.position || session.circuit.pack.zones?.[zoneId ?? ''])) throw new Error('fire needs a known zone, gate, or map position');
    if (!(Number.isFinite(request.radius_m) && request.radius_m! > 0 && request.radius_m! <= 5000)) throw new Error('fire radius_m must be between 0 and 5000');
  }
}

function resolveImpact(request: HazardRequest, session: ScenarioSession): { zones: Set<string>; edges: Set<string> } {
  const zones = new Set<string>();
  const edges = new Set<string>();
  const zoneId = request.location.gate_id ?? request.location.zone_id;
  if (zoneId) zones.add(zoneId);
  if (request.location.edge_id) edges.add(request.location.edge_id);
  if (request.type === 'fire') {
    const center = request.location.position ?? session.circuit.pack.zones?.[zoneId ?? '']?.position;
    const radius = request.radius_m ?? 0;
    if (center) {
      for (const zone of Object.values(session.circuit.pack.zones ?? {})) {
        if (Math.hypot(zone.position.x - center.x, zone.position.y - center.y) <= radius) zones.add(zone.id);
      }
      for (const edge of Object.values(session.circuit.pack.edges ?? {})) {
        if (zones.has(edge.source) || zones.has(edge.destination)) edges.add(edge.id);
      }
    }
  }
  return { zones, edges };
}

function affectsAgent(hazard: HazardRecord, agent: Agent): boolean {
  if (hazard.affected_zone_ids.includes(agent.at) || hazard.affected_zone_ids.includes(agent.destination)) return true;
  if (agent.next_zone && hazard.affected_zone_ids.includes(agent.next_zone)) return true;
  if (agent.edge_id && hazard.affected_edge_ids.includes(agent.edge_id)) return true;
  return agent.path.some((zone) => hazard.affected_zone_ids.includes(zone));
}

function safestExit(agent: Agent, session: ScenarioSession): string | null {
  const graph = session.circuit.graph;
  const declared = session.circuit.pack.constraints?.emergency_exits ?? [];
  const candidates = declared.length
    ? declared
    : Object.values(session.circuit.pack.zones ?? {}).filter((zone) => zone.kind === 'exit' || zone.kind === 'parking' || zone.kind === 'gate').map((zone) => zone.id);
  let best: { id: string; cost: number } | null = null;
  for (const id of [...new Set(candidates)].sort()) {
    if (!graph.isZoneAvailable(id) || id === agent.at) continue;
    const route = graph.route(agent.at, id);
    if (!route.path.length) continue;
    if (!best || route.cost_s < best.cost || (route.cost_s === best.cost && id < best.id)) best = { id, cost: route.cost_s };
  }
  return best?.id ?? null;
}

function copyHazard(record: HazardRecord): HazardRecord {
  return {
    ...record,
    location: { ...record.location, position: record.location.position ? { ...record.location.position } : record.location.position },
    replacement_exits: [...record.replacement_exits],
    affected_zone_ids: [...record.affected_zone_ids],
    affected_edge_ids: [...record.affected_edge_ids],
  };
}
