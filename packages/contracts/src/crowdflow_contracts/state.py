"""Aggregated crowd state — what every downstream engine actually consumes.

The primary measure is FLOW RATE in pedestrians per metre of width per minute,
not a headcount and not a percentage of capacity. Two reasons:

  1. It is the unit Fruin's Level of Service is defined in, so the bands come
     from a published standard rather than from us.
  2. Flow and density are not monotonically related -- past the critical density
     flow *falls* as density rises. A headcount cannot distinguish "busy and
     moving" from "jammed", which is precisely the distinction that matters.

Everything in this module is derived, never authored. Fields carrying an estimate
carry its uncertainty alongside.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, computed_field

from .standards import (
    ASSUMED_REPORTABLE_CONFIDENCE_FLOOR,
    ASSUMED_REPORTABLE_NODE_FLOOR,
    LOSBand,
    band_for_density,
    los_grade_for_flow,
)


class Confidence(BaseModel):
    """How much to trust the state beside it.

    Never presented without the claim it qualifies. With thirty nodes reporting,
    the system says so; it does not quietly present the same number it would give
    for four hundred.
    """

    model_config = ConfigDict(frozen=True)

    value: float = Field(ge=0, le=1)

    observed_nodes: int = Field(ge=0, description="devices contributing to this estimate")
    freshness_s: float = Field(ge=0, description="age of the newest observation")
    mean_accuracy_m: float = Field(gt=0, description="mean positional 1-sigma")
    stability: float = Field(
        ge=0, le=1, description="agreement with recent estimates for this zone"
    )

    @computed_field
    @property
    def reportable(self) -> bool:
        """The contract's served judgement; clients never restate its thresholds."""
        return (
            self.value >= ASSUMED_REPORTABLE_CONFIDENCE_FLOOR
            and self.observed_nodes >= ASSUMED_REPORTABLE_NODE_FLOOR
        )

    @property
    def is_reportable(self) -> bool:
        """Python convenience alias for the serialised ``reportable`` field."""
        return self.reportable


class ZoneState(BaseModel):
    """One zone at one instant."""

    model_config = ConfigDict(frozen=True)

    zone_id: str
    timestamp: float

    # --- observed -----------------------------------------------------------
    observed_nodes: int = Field(ge=0, description="devices seen; NOT people")
    participation_rate: float = Field(
        gt=0, le=1, description="measured, never assumed — see standards.MEASURED_NOT_ASSUMED"
    )

    # --- derived ------------------------------------------------------------
    density_persons_m2: float = Field(
        ge=0,
        description=(
            "persons per square metre — the AUTHORITATIVE measure. Flow is not "
            "monotonic in density (it peaks then collapses), so a band cannot be "
            "read off flow alone: a jammed corridor and an empty one look alike."
        ),
    )
    flow_ped_m_min: float = Field(
        ge=0, description="pedestrians per metre width per minute — reported, not classified on"
    )
    queue_excess: float = Field(
        default=0.0, ge=0,
        description="people who do not fit at jam density, i.e. backed up behind",
    )
    mean_speed_ms: float = Field(ge=0)
    dominant_heading_deg: float | None = Field(default=None, ge=0, lt=360)

    inflow_per_min: float = Field(ge=0)
    outflow_per_min: float = Field(ge=0)

    confidence: Confidence

    @computed_field
    @property
    def estimated_population(self) -> int:
        """Observed devices scaled by measured participation.

        The single most load-bearing number in the system, which is why
        participation_rate is measured rather than configured.
        """
        return round(self.observed_nodes / self.participation_rate)

    @computed_field
    @property
    def band(self) -> LOSBand:
        """Operational band, classified on density (see standards.band_for_density).

        CRITICAL means at or beyond capacity density — the point where flow stops
        improving and starts to collapse — not a high flow number.
        """
        return band_for_density(self.density_persons_m2)

    @computed_field
    @property
    def over_capacity(self) -> bool:
        """Past the peak of the fundamental diagram: more arrivals now reduce
        throughput. The single most important operator signal."""
        return self.band is LOSBand.CRITICAL

    @computed_field
    @property
    def los_grade(self) -> str:
        """Full Fruin grade A-F. Console only; the app never shows this."""
        return los_grade_for_flow(self.flow_ped_m_min)

    @computed_field
    @property
    def net_flow_per_min(self) -> float:
        """Positive means filling. Sustained positive net flow is the early warning."""
        return self.inflow_per_min - self.outflow_per_min


class VenueState(BaseModel):
    """Every zone at one tick, plus what the system knows it cannot see."""

    model_config = ConfigDict(frozen=True)

    circuit_id: str
    timestamp: float
    session_id: str | None = Field(default=None, description="drives crossing availability")

    zones: dict[str, ZoneState] = Field(default_factory=dict)

    unobserved_zones: list[str] = Field(
        default_factory=list,
        description=(
            "Zones with no reporting device. MUST render as unknown, never as empty. "
            "Under D7 uplinks are opportunistic, so coverage genuinely varies."
        ),
    )

    @property
    def total_observed_nodes(self) -> int:
        return sum(z.observed_nodes for z in self.zones.values())

    @property
    def estimated_present(self) -> int:
        return sum(z.estimated_population for z in self.zones.values())

    def in_band(self, band: LOSBand) -> list[ZoneState]:
        return [z for z in self.zones.values() if z.band is band]

    @property
    def coverage(self) -> float:
        """Fraction of known zones currently observed. A first-class metric under D7."""
        total = len(self.zones) + len(self.unobserved_zones)
        return len(self.zones) / total if total else 0.0
