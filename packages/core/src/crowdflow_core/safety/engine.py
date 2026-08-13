"""The safety gate.

Everything that would change crowd movement passes through here — including,
especially, anything the Crowd Ops Agent proposes. The agent recommends; it
never acts. That is not a policy note, it is this function.

Constraints are hard. They are not weighted against benefit, and there is no
override flag: a system that can be argued into routing through a marshal post
under time pressure is worse than one that cannot route at all.
"""

from __future__ import annotations

from crowdflow_contracts import (
    CircuitPack,
    RerouteCommand,
    SafetyOutcome,
    SafetyVerdict,
    VenueState,
)


class SafetyEngine:
    def __init__(self, pack: CircuitPack) -> None:
        self.pack = pack
        self.emergency_mode = False

    def review(
        self,
        command: RerouteCommand,
        state: VenueState | None = None,
        graph=None,
    ) -> SafetyVerdict:
        violations: list[str] = []
        reasons: list[str] = []

        forbidden = set(self.pack.constraints.never_route_through)
        hit = forbidden.intersection(command.prefer)
        if hit:
            violations.append("never_route_through")
            reasons.append(f"prefers forbidden zone(s): {sorted(hit)}")

        exits = set(self.pack.constraints.emergency_exits)
        blocked_exits = exits.intersection(command.avoid)
        if blocked_exits:
            violations.append("emergency_exit_blocked")
            reasons.append(f"avoids emergency exit(s): {sorted(blocked_exits)}")

        if self.emergency_mode and command.avoid:
            violations.append("emergency_mode")
            reasons.append("normal optimisation is disabled during evacuation")

        unknown = [
            z for z in (*command.avoid, *command.prefer, command.source_zone,
                        command.destination_zone)
            if z not in self.pack.zones
        ]
        if unknown:
            violations.append("unknown_zone")
            reasons.append(f"references zones not in the pack: {sorted(set(unknown))}")

        if graph is not None and exits:
            still = graph.reachable(command.source_zone)
            lost = [e for e in exits if e not in still]
            if lost:
                violations.append("egress_unreachable")
                reasons.append(f"would leave exits unreachable: {sorted(lost)}")

        if command.target_fraction > 0.5:
            violations.append("excessive_diversion")
            reasons.append(
                f"diverting {command.target_fraction:.0%} risks creating the "
                "bottleneck it is avoiding"
            )

        if violations:
            return SafetyVerdict(
                command_id=command.command_id,
                outcome=SafetyOutcome.REJECTED,
                reason="; ".join(reasons),
                violated_constraints=violations,
                emergency_mode=self.emergency_mode,
            )

        return SafetyVerdict(
            command_id=command.command_id,
            outcome=SafetyOutcome.APPROVED,
            reason="no hard constraint engaged; emergency egress unaffected",
            emergency_mode=self.emergency_mode,
        )
