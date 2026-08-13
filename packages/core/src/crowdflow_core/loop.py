"""The closed loop.

    state -> predict -> intervene -> route -> safety -> command

This is the product. It is deliberately small: every step is a call into one
engine, and the ordering is the argument. In particular the agent is *not* in
this loop — it observes and explains, and anything it proposes re-enters at
safety like any other command.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from crowdflow_contracts import (
    Forecast,
    InterventionCandidate,
    RerouteCommand,
    SafetyVerdict,
    VenueState,
)

from .intervention import InterventionEngine
from .prediction import BaselinePredictor
from .routing import VenueGraph
from .safety import SafetyEngine
from .simulation.model import Simulation
from .state import StateEngine

COMMAND_TTL_S = 300.0
"""Reroute commands expire. Stale routing advice is actively harmful — the
crowd it was written for has moved on."""

@dataclass
class TickResult:
    """Everything one tick produced. The dashboard renders this and nothing else."""

    time_s: float
    state: VenueState
    forecasts: list[Forecast] = field(default_factory=list)
    candidates: list[InterventionCandidate] = field(default_factory=list)
    command: RerouteCommand | None = None
    verdict: SafetyVerdict | None = None
    dispatched: bool = False

    @property
    def headline(self) -> Forecast | None:
        return self.forecasts[0] if self.forecasts else None


class ControlLoop:
    """Binds the engines. One tick in, one TickResult out."""

    def __init__(
        self,
        sim: Simulation,
        graph: VenueGraph,
        participation: float,
        *,
        horizon_s: float = 300.0,
        intervene: bool = True,
    ) -> None:
        self.sim = sim
        self.graph = graph
        self.state_engine = StateEngine(graph.pack, participation)
        self.predictor = BaselinePredictor(horizon_s=horizon_s)
        self.intervention = InterventionEngine(horizon_s=min(horizon_s, 120.0))
        self.safety = SafetyEngine(graph.pack)
        self.intervene = intervene
        self.participation = participation
        self.active_command: RerouteCommand | None = None
        self._last_intervention_s = -1e9

    def tick(self, session_state: str | None = None) -> TickResult:
        if session_state is not None and session_state != self.graph.session_state:
            # D5: the edge set changes with the session, not merely the label on
            # VenueState. Rebuild before anyone plans this tick, and clear any
            # advisory whose path was computed against the old structure.
            self.graph.rebuild(session_state)
            self.active_command = None
            self.sim.avoid = set()
            self.sim.prefer = set()
        self.sim.step()
        now = self.sim.time_s

        self.state_engine.ingest(self.sim.emit(), now)
        state = self.state_engine.snapshot(now, session_state)

        forecasts = self.predictor.forecast(state)
        result = TickResult(time_s=now, state=state, forecasts=forecasts)

        if self.active_command and not self.active_command.is_valid_at(now):
            self.active_command = None
            self.sim.avoid = set()
            self.sim.prefer = set()

        if not self.intervene:
            return result

        actionable = [forecast for forecast in forecasts if forecast.is_actionable]
        if not actionable or self.active_command:
            return result
        if now - self._last_intervention_s < 120.0:
            return result

        target = actionable[0]
        alternative = self._alternative_to(target.zone_id)
        if alternative is None:
            return result

        chosen = self.intervention.evaluate(
            self.sim,
            from_zone=target.zone_id,
            to_zone=alternative,
            avoid={target.zone_id},
            prefer={alternative},
        )
        result.candidates = chosen.candidates
        self._last_intervention_s = now

        if chosen.selected is None:
            return result

        command = RerouteCommand(
            command_id=f"cmd-{uuid.uuid4().hex[:8]}",
            issued_at=now,
            expires_at=now + COMMAND_TTL_S,
            source_zone=target.zone_id,
            destination_zone=chosen.selected.to_zone,
            avoid=[target.zone_id],
            prefer=[chosen.selected.to_zone],
            target_fraction=chosen.selected.divert_fraction,
            reason=(target.causes[0] if target.causes else "flow rising toward capacity"),
            expected_cost_s=chosen.selected.projected_walk_time_delta_s,
        )
        verdict = self.safety.review(command, state, self.graph)
        result.command = command
        result.verdict = verdict

        if verdict.may_dispatch:
            self.active_command = command
            self.sim.avoid = set(command.avoid)
            self.sim.prefer = set(command.prefer)
            result.dispatched = True

        return result

    def _alternative_to(self, zone_id: str) -> str | None:
        """A neighbouring zone with the most headroom. Deliberately simple:
        the intervention engine does the real evaluation."""
        best, best_deg = None, -1
        for nxt, _ in self.graph.neighbours(zone_id):
            deg = len(self.graph.neighbours(nxt))
            if deg > best_deg:
                best, best_deg = nxt, deg
        return best
