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

        # Route-dependent constraints cannot be reviewed without the route
        # graph. Failing open here makes an omitted optional argument equivalent
        # to an approval. Build the deterministic graph from the pack instead;
        # callers with live session state still pass their rebuilt graph.
        if graph is None:
            from ..routing.graph import VenueGraph

            graph = VenueGraph(self.pack)

        forbidden = set(self.pack.constraints.never_route_through)

        # Names first — cheap, and catches a command that says the quiet part.
        named = forbidden.intersection(set(command.prefer) | set(command.avoid))
        if named:
            violations.append("never_route_through")
            reasons.append(f"names forbidden zone(s): {sorted(named)}")

        # THEN THE ROUTE ITSELF. Checking only the names was the whole defect:
        # a command can carry an empty `prefer` and still describe a diversion
        # whose only path runs through a live-circuit working position. The
        # command is what an operator reads; the route is what the crowd walks,
        # and they are not the same object.
        if forbidden:
            taken = graph.route(
                command.source_zone,
                command.destination_zone,
                avoid=set(command.avoid) or None,
                prefer=set(command.prefer) or None,
            )
            if taken.found:
                traversed = [z for z in taken.path if z in forbidden]
                if traversed:
                    violations.append("route_traverses_forbidden_zone")
                    reasons.append(
                        f"the route this command produces runs through "
                        f"{sorted(set(traversed))}: {' -> '.join(taken.path)}"
                    )
            elif not named:
                # No path at all once hard constraints are applied. Refusing is
                # the honest answer: dispatching a diversion nobody can walk
                # sends people toward a route that does not exist.
                violations.append("no_permissible_route")
                reasons.append(
                    f"no route from {command.source_zone} to "
                    f"{command.destination_zone} that respects hard constraints"
                )

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

        if exits:
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
