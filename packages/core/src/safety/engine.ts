import type { CircuitPack, RerouteCommand, SafetyVerdict, VenueState } from '@crowdflow/contracts';
import { VenueGraph } from '../routing/graph.js';

export class SafetyEngine {
  emergencyMode = false;
  constructor(readonly pack: CircuitPack) {}

  review(command: RerouteCommand, _state?: VenueState, graph = new VenueGraph(this.pack)): SafetyVerdict {
    const violations: string[] = [];
    const reasons: string[] = [];
    const forbidden = new Set(this.pack.constraints?.never_route_through ?? []);
    const named = [...new Set([...(command.prefer ?? []), ...(command.avoid ?? [])])]
      .filter((zone) => forbidden.has(zone));
    if (named.length) {
      violations.push('never_route_through');
      reasons.push(`names forbidden zone(s): ${named.sort().join(', ')}`);
    }
    if (forbidden.size) {
      const route = graph.route(
        command.source_zone,
        command.destination_zone,
        undefined,
        new Set(command.avoid ?? []),
        new Set(command.prefer ?? []),
      );
      if (route.path.length) {
        const traversed = route.path.filter((zone) => forbidden.has(zone));
        if (traversed.length) {
          violations.push('route_traverses_forbidden_zone');
          reasons.push(`route traverses ${[...new Set(traversed)].join(', ')}`);
        }
      } else if (!named.length) {
        violations.push('no_permissible_route');
        reasons.push(`no permissible route from ${command.source_zone} to ${command.destination_zone}`);
      }
    }
    const exits = new Set(this.pack.constraints?.emergency_exits ?? []);
    const blocked = (command.avoid ?? []).filter((zone) => exits.has(zone));
    if (blocked.length) {
      violations.push('emergency_exit_blocked');
      reasons.push(`avoids emergency exit(s): ${blocked.join(', ')}`);
    }
    if (this.emergencyMode && (command.avoid?.length ?? 0) > 0) {
      violations.push('emergency_mode');
      reasons.push('normal optimisation is disabled during evacuation');
    }
    const zones = this.pack.zones ?? {};
    const unknown = [...(command.avoid ?? []), ...(command.prefer ?? []), command.source_zone, command.destination_zone]
      .filter((zone) => !(zone in zones));
    if (unknown.length) {
      violations.push('unknown_zone');
      reasons.push(`references zones not in the pack: ${[...new Set(unknown)].sort().join(', ')}`);
    }
    if (exits.size) {
      const reachable = graph.reachable(command.source_zone);
      const lost = [...exits].filter((exit) => !reachable.has(exit));
      if (lost.length) {
        violations.push('egress_unreachable');
        reasons.push(`would leave exits unreachable: ${lost.sort().join(', ')}`);
      }
    }
    if (command.target_fraction > 0.5) {
      violations.push('excessive_diversion');
      reasons.push(`diverting ${(command.target_fraction * 100).toFixed(0)}% risks creating another bottleneck`);
    }
    const approved = violations.length === 0;
    return {
      command_id: command.command_id,
      outcome: approved ? 'approved' : 'rejected',
      reason: approved ? 'no hard constraint engaged; emergency egress unaffected' : reasons.join('; '),
      violated_constraints: violations,
      emergency_mode: this.emergencyMode,
      dispatchable: approved,
    };
  }
}
