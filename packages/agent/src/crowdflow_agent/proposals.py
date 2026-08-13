"""The one place the agent's ideas become commands — and the gate they hit.

This module exists to be small enough to read in full, because the system's most
important claim rests on it: **there is no path from an agent tool call to a
dispatched reroute that bypasses the safety engine.**

The construction is deliberate:

  * `RerouteCommand` is built here and nowhere else in this package. A test walks
    the package's AST and fails if that stops being true.
  * A command is never returned on its own. It leaves this module inside a
    `Proposal`, which cannot be constructed without a `SafetyVerdict` — the type
    system makes an unreviewed command unrepresentable.
  * `Proposal` has no dispatch method, and this package holds no reference to a
    mesh, a socket or a simulation it could push one into. The agent's output is
    a list of proposals; something else decides, and that something else can only
    act on the ones the verdict already approved.

The agent recommends. It never acts. That is not a policy note, it is the shape
of this file.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from crowdflow_contracts import (
    RerouteCommand,
    SafetyOutcome,
    SafetyVerdict,
    VenueState,
)
from crowdflow_core.loop import COMMAND_TTL_S
from crowdflow_core.routing import VenueGraph
from crowdflow_core.safety import SafetyEngine


@dataclass(frozen=True)
class Proposal:
    """A command the agent suggested, and the verdict it received.

    Frozen and paired: there is no way to hold one without the other, so no
    caller can accidentally read the command and forget the verdict.
    """

    command: RerouteCommand
    verdict: SafetyVerdict
    expected_cost_s: float

    @property
    def approved(self) -> bool:
        return self.verdict.may_dispatch

    @property
    def rejected(self) -> bool:
        return self.verdict.outcome is SafetyOutcome.REJECTED

    def summary(self) -> dict:
        """What the model is told about its own proposal.

        Rejections come back with the stated reason and the named constraints:
        an agent that is told only 'no' will try the same thing again, and an
        agent told *which* rule it broke can propose something legal instead.
        """
        return {
            "command_id": self.command.command_id,
            "outcome": self.verdict.outcome.value,
            "reason": self.verdict.reason,
            "violated_constraints": list(self.verdict.violated_constraints),
            "dispatched": False,
            "note": (
                "This is a proposal reviewed by the safety engine. Nothing has "
                "been sent to the mesh. An operator dispatches approved commands."
            ),
            "source_zone": self.command.source_zone,
            "destination_zone": self.command.destination_zone,
            "avoid": list(self.command.avoid),
            "prefer": list(self.command.prefer),
            "target_fraction": self.command.target_fraction,
            "expected_cost_s": self.expected_cost_s,
        }


class ProposalLedger:
    """Every command the agent proposed this run, with its verdict.

    Kept in full, rejections included. A record of what the agent *wanted* to do
    is the only way to audit an agent that was never allowed to do it.
    """

    def __init__(self, safety: SafetyEngine) -> None:
        self.safety = safety
        self.proposals: list[Proposal] = []

    def propose(
        self,
        *,
        now: float,
        source_zone: str,
        destination_zone: str,
        avoid: list[str],
        prefer: list[str],
        target_fraction: float,
        reason: str,
        expected_cost_s: float,
        state: VenueState | None = None,
        graph: VenueGraph | None = None,
    ) -> Proposal:
        """Build a command, put it through safety, record both.

        `expected_cost_s` is computed by the routing engine before it gets here.
        The model is never asked for it: a language model quoting an added
        walking time is a language model computing a route, which is the one
        thing it must not do.
        """
        command = RerouteCommand(
            command_id=f"agent-{uuid.uuid4().hex[:8]}",
            issued_at=now,
            expires_at=now + COMMAND_TTL_S,
            source_zone=source_zone,
            destination_zone=destination_zone,
            avoid=list(avoid),
            prefer=list(prefer),
            target_fraction=target_fraction,
            reason=reason,
            expected_cost_s=expected_cost_s,
        )
        verdict = self.safety.review(command, state, graph)
        proposal = Proposal(
            command=command, verdict=verdict, expected_cost_s=expected_cost_s
        )
        self.proposals.append(proposal)
        return proposal

    @property
    def approved(self) -> list[Proposal]:
        """The only proposals an adapter may dispatch — and even then, after a
        human. Derived from the verdict every time; never a stored flag that
        could drift from the verdict that set it."""
        return [p for p in self.proposals if p.approved]

    @property
    def rejected(self) -> list[Proposal]:
        return [p for p in self.proposals if not p.approved]
