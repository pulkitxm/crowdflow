import type { Position, RerouteCommand } from '@crowdflow/contracts';
import { COMMAND_TTL_S } from '@crowdflow/core';
import type { Proposal } from '@crowdflow/agent';
import type { LoadedCircuit } from './packs.js';
import type { PeopleStore } from './people.js';
import type { ScenarioSession } from './session.js';
import type { AgentCommandStatus, GuidanceRecord } from './wire.js';

export const COHORT_RADIUS_M = 75;
export const MOVED_PROGRESS_M = 15;

interface TargetedPerson {
  person_id: number;
  start: Position;
  pinged_at: number | null;
}

interface ActiveDispatch {
  command: RerouteCommand;
  circuit: LoadedCircuit;
  dispatched_at: number;
  via: string[];
  walk_time_s: number;
  applied_to_simulation: boolean;
  cohort: Map<number, TargetedPerson>;
}

export class CrowdControl {
  private readonly active = new Map<string, ActiveDispatch>();

  constructor(private readonly people: PeopleStore) {}

  dispatch(proposal: Proposal, circuit: LoadedCircuit, session: ScenarioSession | null, now: number, radiusM = COHORT_RADIUS_M): AgentCommandStatus {
    if (!proposal.verdict.dispatchable) {
      throw new Error(`proposal ${proposal.command.command_id} is not dispatchable: safety said ${proposal.verdict.outcome} — ${proposal.verdict.reason}`);
    }
    if (this.active.has(proposal.command.command_id)) {
      throw new Error(`command ${proposal.command.command_id} is already dispatched`);
    }
    const command: RerouteCommand = { ...proposal.command, issued_at: now, expires_at: now + COMMAND_TTL_S };
    const avoidForRoute = new Set((command.avoid ?? []).filter((zone) => zone !== command.source_zone && zone !== command.destination_zone));
    const route = circuit.graph.route(command.source_zone, command.destination_zone, undefined, avoidForRoute, new Set(command.prefer ?? []));
    if (!route.path.length) throw new Error(`no guidable route from ${command.source_zone} to ${command.destination_zone}: ${route.rejected_reason ?? 'unknown'}`);

    let applied = false;
    if (session && session.circuit.pack.id === circuit.pack.id) {
      session.loop.activeCommand = command;
      session.sim.avoid = new Set(command.avoid ?? []);
      session.sim.prefer = new Set(command.prefer ?? []);
      applied = true;
    }

    const cohort = new Map<number, TargetedPerson>();
    const origin = circuit.pack.zones?.[command.source_zone]?.position;
    if (origin) {
      for (const person of this.people.list(circuit.pack.id, 1000)) {
        const distance = Math.hypot(person.position.x - origin.x, person.position.y - origin.y);
        if (distance <= radiusM && person.person_id % 100 < command.target_fraction * 100) {
          cohort.set(person.person_id, { person_id: person.person_id, start: person.position, pinged_at: null });
        }
      }
    }

    const entry: ActiveDispatch = { command, circuit, dispatched_at: now, via: route.path, walk_time_s: route.eta_s, applied_to_simulation: applied, cohort };
    this.active.set(command.command_id, entry);
    return this.describe(entry, now);
  }

  status(now: number): AgentCommandStatus[] {
    this.expire(now);
    return [...this.active.values()].map((entry) => this.describe(entry, now));
  }

  guidance(circuitId: string, now: number, personId?: number): GuidanceRecord[] {
    this.expire(now);
    const records: GuidanceRecord[] = [];
    for (const entry of this.active.values()) {
      if (entry.circuit.pack.id !== circuitId) continue;
      for (const person of entry.cohort.values()) {
        if (personId != null && person.person_id !== personId) continue;
        person.pinged_at = person.pinged_at ?? now;
        records.push({
          person_id: person.person_id,
          command_id: entry.command.command_id,
          from_zone: entry.command.source_zone,
          to_zone: entry.command.destination_zone,
          via: entry.via,
          avoid: [...(entry.command.avoid ?? [])],
          prefer: [...(entry.command.prefer ?? [])],
          reason: entry.command.reason,
          expires_at: entry.command.expires_at,
        });
      }
    }
    return records;
  }

  private describe(entry: ActiveDispatch, now: number): AgentCommandStatus {
    const positions = new Map(this.people.list(entry.circuit.pack.id, 1000).map((person) => [person.person_id, person.position]));
    const destination = entry.circuit.pack.zones?.[entry.command.destination_zone]?.position;
    const origin = entry.circuit.pack.zones?.[entry.command.source_zone]?.position;
    let moved = 0;
    let nearSource = 0;
    let pinged = 0;
    for (const person of entry.cohort.values()) {
      if (person.pinged_at != null) pinged += 1;
      const current = positions.get(person.person_id);
      if (!current) continue;
      if (destination && Math.hypot(current.x - destination.x, current.y - destination.y) < Math.hypot(person.start.x - destination.x, person.start.y - destination.y) - MOVED_PROGRESS_M) moved += 1;
      if (origin && Math.hypot(current.x - origin.x, current.y - origin.y) <= COHORT_RADIUS_M) nearSource += 1;
    }
    return {
      command_id: entry.command.command_id,
      circuit_id: entry.circuit.pack.id,
      source_zone: entry.command.source_zone,
      destination_zone: entry.command.destination_zone,
      via: entry.via,
      target_fraction: entry.command.target_fraction,
      reason: entry.command.reason,
      dispatched_at: entry.dispatched_at,
      expires_at: entry.command.expires_at,
      expires_in_s: Number(Math.max(0, entry.command.expires_at - now).toFixed(1)),
      walk_time_s: Number(entry.walk_time_s.toFixed(1)),
      applied_to_simulation: entry.applied_to_simulation,
      cohort: { targeted: entry.cohort.size, pinged, moved, still_near_source: nearSource },
    };
  }

  private expire(now: number): void {
    for (const [id, entry] of this.active) {
      if (entry.command.expires_at <= now) this.active.delete(id);
    }
  }
}
