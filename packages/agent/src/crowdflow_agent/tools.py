"""The tool layer: everything the agent is allowed to touch.

Two rules shape every tool here, and between them they define what the agent is.

**The model reads; the engines compute.** No tool asks the model for a density, a
route, a walking time or a forecast. `find_alternative_route` runs A* and hands
back a path; `simulate_intervention` runs the seeded what-if sweep and hands back
candidates; `create_reroute` computes its own added walking time from the graph.
The model chooses *which* question to ask and explains the answer. Every number
in an answer was produced by an engine that can be re-run without it.

**Arguments are untrusted.** A tool call is text a language model emitted; it can
name a zone that does not exist, pass a fraction of 4.0, or invent a tool
argument. Every input is a Pydantic model, and a validation failure comes back as
a tool *result* the model can read and correct — not an exception that kills the
run. The failure mode being avoided is an agent that dies on a typo.

Responses are shaped for reading, not dumping. A venue has 1,875 zones; a tool
that returned all of them would fill a context window with noise and force the
model to do the ranking an engine has already done. Tools return the worst N,
with counts for everything else — and always say how many zones are unobserved,
because unobserved is not empty (invariant 5).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from crowdflow_contracts import (
    CircuitPack,
    EventProfile,
    Forecast,
    LOSBand,
    VenueState,
)
from crowdflow_core.intervention import InterventionEngine
from crowdflow_core.routing import VenueGraph
from crowdflow_core.safety import SafetyEngine
from crowdflow_core.simulation.model import Simulation
from pydantic import BaseModel, Field, ValidationError

from .insights import InsightEngine
from .proposals import Proposal, ProposalLedger

MAX_ROWS = 8
"""How many zones or candidates a listing tool returns.

ASSUMED, with reasoning: the tools rank before they truncate, so this is a
readability limit rather than an information one — an operator asked about the
worst zones wants the worst handful, and a model given four hundred rows spends
its turn re-sorting them. Every truncated response states the full count."""


@dataclass
class OpsContext:
    """Everything the tools read. Supplied by the adapter, never fetched here.

    The agent package performs no I/O: whoever builds this has already loaded the
    pack, run the tick and produced the state. That keeps the agent testable and
    keeps the question 'what did the agent see?' answerable.
    """

    pack: CircuitPack
    graph: VenueGraph
    safety: SafetyEngine
    state: VenueState
    now: float
    forecasts: list[Forecast] = field(default_factory=list)
    event: EventProfile | None = None
    simulation: Simulation | None = None
    intervention: InterventionEngine | None = None
    insights: InsightEngine | None = None


# --------------------------------------------------------------- tool inputs --

class _NoArgs(BaseModel):
    model_config = {"extra": "forbid"}


class ZoneArgs(BaseModel):
    model_config = {"extra": "forbid"}
    zone_id: str = Field(description="zone id from the circuit pack")


class LimitArgs(BaseModel):
    model_config = {"extra": "forbid"}
    limit: int = Field(default=MAX_ROWS, ge=1, le=50)


class RouteArgs(BaseModel):
    model_config = {"extra": "forbid"}
    origin: str
    destination: str
    avoid: list[str] = Field(default_factory=list, description="zone ids to route around")


class SimulateArgs(BaseModel):
    model_config = {"extra": "forbid"}
    from_zone: str = Field(description="zone the diversion takes traffic away from")
    to_zone: str = Field(description="zone traffic is diverted toward")


class RerouteArgs(BaseModel):
    model_config = {"extra": "forbid"}
    source_zone: str
    destination_zone: str
    avoid: list[str] = Field(default_factory=list)
    prefer: list[str] = Field(default_factory=list)
    target_fraction: float = Field(
        ge=0, le=1, description="share of affected walkers this should reach"
    )
    reason: str = Field(description="plain language, shown in the app and to the operator")


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args_model: type[BaseModel]
    handler: Callable[[BaseModel], dict[str, Any]]

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.args_model.model_json_schema(),
        }


class Toolbox:
    """Binds tools to one OpsContext, and owns the proposal ledger.

    Note what this class does NOT have: any way to send a command anywhere. It
    holds a SafetyEngine and a list of proposals. There is no dispatch method to
    call, correctly or otherwise.
    """

    def __init__(self, context: OpsContext) -> None:
        self.context = context
        self.ledger = ProposalLedger(context.safety)
        self._specs: dict[str, ToolSpec] = {}
        for spec in self._build():
            self._specs[spec.name] = spec

    # -- surface -----------------------------------------------------------

    @property
    def names(self) -> list[str]:
        return list(self._specs)

    def schemas(self) -> list[dict[str, Any]]:
        return [s.schema() for s in self._specs.values()]

    @property
    def proposals(self) -> list[Proposal]:
        return list(self.ledger.proposals)

    def dispatchable(self) -> list[Proposal]:
        """Proposals safety approved. Still proposals: nothing here is sent."""
        return self.ledger.approved

    def invoke(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Run one tool call. Never raises on bad model output."""
        spec = self._specs.get(name)
        if spec is None:
            return {
                "error": f"unknown tool {name!r}",
                "available": self.names,
            }
        try:
            args = spec.args_model.model_validate(arguments)
        except ValidationError as exc:
            return {
                "error": "invalid arguments",
                "detail": exc.errors(include_url=False, include_context=False),
            }
        return spec.handler(args)

    # -- helpers -----------------------------------------------------------

    def _unknown_zones(self, *zone_ids: str) -> list[str]:
        return sorted({z for z in zone_ids if z and z not in self.context.pack.zones})

    def _zone_row(self, zone_id: str) -> dict[str, Any]:
        zone = self.context.state.zones[zone_id]
        pack_zone = self.context.pack.zones.get(zone_id)
        return {
            "zone_id": zone_id,
            "name": (pack_zone.name if pack_zone else None) or zone_id,
            "kind": pack_zone.kind.value if pack_zone else None,
            "band": zone.band.value,
            "density_persons_m2": zone.density_persons_m2,
            "flow_ped_m_min": zone.flow_ped_m_min,
            "mean_speed_ms": zone.mean_speed_ms,
            "queue_excess": zone.queue_excess,
            "estimated_population": zone.estimated_population,
            "net_flow_per_min": zone.net_flow_per_min,
            "confidence": zone.confidence.value,
            "reportable": zone.confidence.is_reportable,
        }

    # -- tools -------------------------------------------------------------

    def _build(self) -> list[ToolSpec]:
        return [
            ToolSpec(
                name="get_venue_state",
                description=(
                    "Current crowd state across the whole venue: band counts, the "
                    "worst zones by density, coverage, and how many zones nobody is "
                    "reporting from. Zones are classified on DENSITY, not flow. "
                    "Unobserved zones are unknown, never empty."
                ),
                args_model=LimitArgs,
                handler=self._get_venue_state,
            ),
            ToolSpec(
                name="get_zone_state",
                description=(
                    "Everything known about one zone right now, including the "
                    "confidence in the estimate and whether it is reportable at all."
                ),
                args_model=ZoneArgs,
                handler=self._get_zone_state,
            ),
            ToolSpec(
                name="get_predictions",
                description=(
                    "Forecasts from the prediction engine, soonest threshold "
                    "crossing first. Each carries time-to-threshold, probability, "
                    "confidence, the model that produced it, and its causes."
                ),
                args_model=LimitArgs,
                handler=self._get_predictions,
            ),
            ToolSpec(
                name="simulate_intervention",
                description=(
                    "Run the seeded counterfactual sweep: what each diversion "
                    "fraction would do, including doing nothing. Returns every "
                    "candidate with its projected peak density, added walking time "
                    "and score, and which one the engine selected."
                ),
                args_model=SimulateArgs,
                handler=self._simulate_intervention,
            ),
            ToolSpec(
                name="find_alternative_route",
                description=(
                    "Ask the routing engine for a walkable path under current "
                    "conditions, optionally avoiding zones. Returns the path, "
                    "distance and honest walking time, or why no path exists."
                ),
                args_model=RouteArgs,
                handler=self._find_alternative_route,
            ),
            ToolSpec(
                name="get_event_schedule",
                description=(
                    "This weekend's session timetable. Session state drives which "
                    "crossings are open, so it changes what routing is possible."
                ),
                args_model=_NoArgs,
                handler=self._get_event_schedule,
            ),
            ToolSpec(
                name="generate_insight",
                description=(
                    "Statistically detected anomalies from rolling per-zone and "
                    "per-gate baselines. Already computed; read them, do not "
                    "recompute them."
                ),
                args_model=LimitArgs,
                handler=self._generate_insight,
            ),
            ToolSpec(
                name="create_reroute",
                description=(
                    "PROPOSE a reroute. This does NOT dispatch anything. The "
                    "proposal is put through the safety engine and you are told "
                    "whether it was approved or rejected and why. An operator "
                    "dispatches approved proposals; you cannot."
                ),
                args_model=RerouteArgs,
                handler=self._create_reroute,
            ),
        ]

    # -- handlers ----------------------------------------------------------

    def _get_venue_state(self, args: LimitArgs) -> dict[str, Any]:
        state = self.context.state
        ranked = sorted(
            state.zones.values(), key=lambda z: z.density_persons_m2, reverse=True
        )
        return {
            "circuit_id": state.circuit_id,
            "timestamp": state.timestamp,
            "session_id": state.session_id,
            "observed_zones": len(state.zones),
            "unobserved_zones": len(state.unobserved_zones),
            "unobserved_note": (
                "Zones with no reporting device. Unknown, NOT empty — do not "
                "describe them as quiet."
            ),
            "coverage": round(state.coverage, 3),
            "estimated_present": state.estimated_present,
            "band_counts": {
                band.value: len(state.in_band(band)) for band in LOSBand
            },
            "worst_zones": [
                self._zone_row(z.zone_id) for z in ranked[: args.limit]
            ],
        }

    def _get_zone_state(self, args: ZoneArgs) -> dict[str, Any]:
        unknown = self._unknown_zones(args.zone_id)
        if unknown:
            return {"error": f"unknown zone {args.zone_id!r}"}
        if args.zone_id in self.context.state.unobserved_zones:
            return {
                "zone_id": args.zone_id,
                "observed": False,
                "note": (
                    "No device is reporting from this zone. Its state is unknown; "
                    "it is not known to be empty."
                ),
            }
        if args.zone_id not in self.context.state.zones:
            return {"zone_id": args.zone_id, "observed": False, "note": "no state this tick"}
        return {"observed": True, **self._zone_row(args.zone_id)}

    def _get_predictions(self, args: LimitArgs) -> dict[str, Any]:
        forecasts = self.context.forecasts[: args.limit]
        return {
            "total": len(self.context.forecasts),
            "forecasts": [
                {
                    "zone_id": f.zone_id,
                    "target_band": f.target_band.value,
                    "time_to_threshold_s": f.time_to_threshold_s,
                    "probability": f.probability,
                    "confidence": f.confidence,
                    "projected_peak_density_persons_m2": f.projected_peak_density_persons_m2,
                    "model_id": f.model_id,
                    "actionable": f.is_actionable,
                    "causes": list(f.causes),
                }
                for f in forecasts
            ],
        }

    def _simulate_intervention(self, args: SimulateArgs) -> dict[str, Any]:
        unknown = self._unknown_zones(args.from_zone, args.to_zone)
        if unknown:
            return {"error": f"unknown zone(s): {unknown}"}
        if self.context.simulation is None or self.context.intervention is None:
            return {
                "error": (
                    "no simulation attached to this session; what-if evaluation is "
                    "unavailable"
                )
            }
        result = self.context.intervention.evaluate(
            self.context.simulation,
            from_zone=args.from_zone,
            to_zone=args.to_zone,
            avoid={args.from_zone},
            prefer={args.to_zone},
        )
        return {
            "seeded": True,
            "note": (
                "Every candidate was simulated, including the do-nothing baseline. "
                "If no candidate is selected, doing nothing scored best."
            ),
            "selected": result.selected.candidate_id if result.selected else None,
            "candidates": [
                {
                    "candidate_id": c.candidate_id,
                    "description": c.description,
                    "divert_fraction": c.divert_fraction,
                    "projected_peak_density": c.projected_peak_density_persons_m2,
                    "projected_walk_time_delta_s": c.projected_walk_time_delta_s,
                    "projected_bottleneck_duration_s": c.projected_bottleneck_duration_s,
                    "score_total": c.score.total,
                    "selected": c.selected,
                }
                for c in result.candidates[:MAX_ROWS]
            ],
        }

    def _route(self, origin: str, destination: str, avoid: set[str] | None,
               prefer: set[str] | None = None):
        return self.context.graph.route(
            origin,
            destination,
            states=self.context.state.zones,
            avoid=avoid or None,
            prefer=prefer or None,
        )

    def _find_alternative_route(self, args: RouteArgs) -> dict[str, Any]:
        unknown = self._unknown_zones(args.origin, args.destination, *args.avoid)
        if unknown:
            return {"error": f"unknown zone(s): {unknown}"}
        result = self._route(args.origin, args.destination, set(args.avoid))
        if not result.found:
            return {
                "found": False,
                "reason": result.rejected_reason or "no path under current conditions",
            }
        return {
            "found": True,
            "path": result.path,
            "distance_m": round(result.distance_m, 1),
            "walk_time_s": round(result.eta_s, 1),
            "note": "Computed by the routing engine over current density, not estimated.",
        }

    def _get_event_schedule(self, args: _NoArgs) -> dict[str, Any]:
        event = self.context.event
        if event is None:
            return {"error": "no event profile loaded for this circuit"}
        return {
            "circuit_id": event.circuit_id,
            "name": event.name,
            "gates_open": event.gates_open,
            "current_session_id": self.context.state.session_id,
            "sessions": [
                {"id": s.id, "kind": s.kind, "start": s.start, "end": s.end}
                for s in event.sessions
            ],
        }

    def _generate_insight(self, args: LimitArgs) -> dict[str, Any]:
        engine = self.context.insights
        if engine is None:
            return {"error": "no insight engine attached to this session"}
        found = engine.insights(limit=args.limit)
        return {
            "note": (
                "Detected statistically from rolling baselines using a modified "
                "z-score. The headline is authoritative; rephrase it, do not "
                "recompute it."
            ),
            "insights": [i.model_dump(mode="json") for i in found],
        }

    def _create_reroute(self, args: RerouteArgs) -> dict[str, Any]:
        unknown = self._unknown_zones(
            args.source_zone, args.destination_zone, *args.avoid, *args.prefer
        )
        if unknown:
            return {"error": f"unknown zone(s): {unknown}"}

        # The added walking time is MEASURED off the graph, not taken from the
        # model. Without a computable baseline there is no honest cost to state,
        # and a reroute whose cost is unknown is not a reroute worth proposing.
        baseline = self._route(args.source_zone, args.destination_zone, None)
        diverted = self._route(
            args.source_zone,
            args.destination_zone,
            set(args.avoid),
            set(args.prefer),
        )
        if not baseline.found or not diverted.found:
            return {
                "error": (
                    "cannot cost this reroute: the routing engine finds no path "
                    f"{'without' if not baseline.found else 'with'} the diversion"
                ),
                "reason": (baseline if not baseline.found else diverted).rejected_reason,
            }

        proposal = self.ledger.propose(
            now=self.context.now,
            source_zone=args.source_zone,
            destination_zone=args.destination_zone,
            avoid=args.avoid,
            prefer=args.prefer,
            target_fraction=args.target_fraction,
            reason=args.reason,
            expected_cost_s=round(diverted.eta_s - baseline.eta_s, 1),
            state=self.context.state,
            graph=self.context.graph,
        )
        return proposal.summary()
