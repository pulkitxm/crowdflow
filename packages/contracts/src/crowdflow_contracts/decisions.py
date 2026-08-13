"""Prediction, intervention, routing and safety payloads.

The chain is deliberately one-directional:

    Forecast -> InterventionCandidate[] -> RerouteCommand -> SafetyVerdict -> mesh

Nothing skips a link. In particular the Crowd Ops Agent re-enters at
SafetyVerdict like any other proposal -- it recommends, it never acts.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, computed_field

from .standards import LOSBand


class Forecast(BaseModel):
    """Where congestion will be, when, and why.

    The headline is time_to_threshold_s, not the current value. "2:47 until
    capacity" drives a decision; "87% full" does not.
    """

    model_config = ConfigDict(frozen=True)

    zone_id: str
    issued_at: float
    horizon_s: float = Field(gt=0, description="how far ahead this forecast looks")

    target_band: LOSBand = Field(description="the band predicted to be crossed")
    probability: float = Field(ge=0, le=1)
    time_to_threshold_s: float | None = Field(
        default=None, description="None when the threshold is not projected to be crossed"
    )
    projected_peak_flow: float = Field(ge=0, description="ped/m/min at the projected peak")

    confidence: float = Field(ge=0, le=1)
    model_id: str = Field(description="which model produced this; baseline is a valid answer")

    causes: list[str] = Field(
        default_factory=list,
        description="human-readable drivers, ordered by contribution",
    )

    @property
    def is_actionable(self) -> bool:
        """Worth surfacing: crossing predicted, soon enough to act, confidently enough."""
        return (
            self.time_to_threshold_s is not None
            and self.time_to_threshold_s > 0
            and self.probability >= 0.6
            and self.confidence >= 0.5
        )


class ScoreBreakdown(BaseModel):
    """Why a candidate scored what it did.

    Shown to the operator. An intervention recommendation without its components
    is an assertion; with them it is an argument.
    """

    model_config = ConfigDict(frozen=True)

    congestion_reduction: float
    walk_time_cost: float
    capacity_headroom: float
    safety_margin: float
    fairness: float

    @computed_field
    @property
    def total(self) -> float:
        return (
            self.congestion_reduction
            + self.capacity_headroom
            + self.safety_margin
            + self.fairness
            - self.walk_time_cost
        )


class InterventionCandidate(BaseModel):
    """One simulated what-if. Rejected candidates are kept and displayed."""

    model_config = ConfigDict(frozen=True)

    candidate_id: str
    description: str = Field(description="plain language, e.g. 'Divert 30% of Vale to Gate 4'")

    divert_fraction: float = Field(ge=0, le=1, description="0.0 is the do-nothing baseline")
    from_zone: str
    to_zone: str
    via: list[str] = Field(default_factory=list)

    projected_peak_flow: float = Field(ge=0, description="ped/m/min")
    projected_walk_time_delta_s: float = Field(
        description="positive means longer. Always shown beside the benefit, never hidden."
    )
    projected_bottleneck_duration_s: float = Field(ge=0)

    score: ScoreBreakdown
    selected: bool = False


class RerouteCommand(BaseModel):
    """What actually goes over the mesh.

    Deliberately NOT a per-person route. Broadcasting avoid/prefer sets and
    letting each device compute its own path scales, and works offline
    (plan.md section 33).
    """

    model_config = ConfigDict(frozen=True)

    command_id: str
    issued_at: float
    expires_at: float = Field(description="commands must expire; stale routing is harmful")

    source_zone: str
    destination_zone: str
    avoid: list[str] = Field(default_factory=list)
    prefer: list[str] = Field(default_factory=list)

    target_fraction: float = Field(
        ge=0, le=1, description="share of affected walkers this should reach"
    )
    reason: str = Field(description="plain language, surfaced in the app")
    expected_cost_s: float = Field(
        description="honest added walking time, stated before the user accepts"
    )

    def is_valid_at(self, t: float) -> bool:
        return self.issued_at <= t < self.expires_at


class SafetyOutcome(str, Enum):
    APPROVED = "approved"
    REJECTED = "rejected"
    MODIFIED = "modified"


class SafetyVerdict(BaseModel):
    """The gate every action passes through.

    Hard constraints the AI cannot override: never route through a blocked or
    forbidden edge, never intentionally exceed capacity, never route away from
    emergency exits during evacuation (plan.md section 34).
    """

    model_config = ConfigDict(frozen=True)

    command_id: str
    outcome: SafetyOutcome
    reason: str = Field(description="stated even on approval; rejections are explained")
    violated_constraints: list[str] = Field(default_factory=list)
    emergency_mode: bool = False

    @property
    def may_dispatch(self) -> bool:
        return self.outcome in (SafetyOutcome.APPROVED, SafetyOutcome.MODIFIED)
