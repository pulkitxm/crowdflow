"""The deliberately small contract delivered to a spectator phone.

A phone receives conclusions, not ``VenueState``.  Density, Fruin grades,
confidence and model details belong on the operator console; shipping them to the
app would invite the app to reclassify or explain the world.  These models carry
only facts that can change where somebody puts their feet in the next minute: a
landmark, a duration, the already-computed way ahead, crossing availability and
a safety-reviewed reroute.

The six view models form a discriminated union.  Python is therefore the source
of truth for the entire feed, not merely for the three contract types that happen
to be embedded in it.  ``packages/contracts/scripts/generate.py`` emits the same
union into TypeScript.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel

from .decisions import RerouteCommand, SafetyVerdict
from .standards import LOSBand


# Defining this separately from LOSBand is intentional: ``unknown`` is an
# observation state, not a crowd band.
class WayAhead(str, Enum):
    NOMINAL = LOSBand.NOMINAL.value
    BUILDING = LOSBand.BUILDING.value
    CRITICAL = LOSBand.CRITICAL.value
    UNKNOWN = "unknown"


class CrossingOpen(BaseModel):
    model_config = ConfigDict(frozen=True)

    open: Literal[True]
    closes_at: float | None = Field(
        description="absolute unix seconds; None when no closing time is known"
    )


class CrossingClosed(BaseModel):
    model_config = ConfigDict(frozen=True)

    open: Literal[False]
    opens_at: float | None = Field(
        description="absolute unix seconds; None when no reopening time is known"
    )


CrossingState = Annotated[CrossingOpen | CrossingClosed, Field(discriminator="open")]


class CrossingNotice(BaseModel):
    """A timetable fact a spectator cannot infer by looking at the crossing."""

    model_config = ConfigDict(frozen=True)

    name: str
    state: CrossingState


class Step(BaseModel):
    """One already-priced leg of a route."""

    model_config = ConfigDict(frozen=True)

    id: str
    to: str = Field(description="human-readable landmark from the circuit pack")
    walk_s: float = Field(ge=0, description="walking seconds computed by the routing engine")
    way_ahead: WayAhead
    crossing: CrossingNotice | None = None


class Route(BaseModel):
    """Where the spectator is, where they are going and the walk between them."""

    model_config = ConfigDict(frozen=True)

    id: str
    from_: str = Field(alias="from", serialization_alias="from")
    to: str
    steps: list[Step]
    total_walk_s: float = Field(
        ge=0,
        description="door-to-door seconds from routing, including waits; never summed on the phone",
    )


class RerouteOffer(BaseModel):
    """A proposed alternative and the safety verdict that gates its display."""

    model_config = ConfigDict(frozen=True)

    command: RerouteCommand
    verdict: SafetyVerdict
    instead: Route


class LinkStatus(BaseModel):
    """Freshness and reachability, stated rather than hidden."""

    model_config = ConfigDict(frozen=True)

    online: bool
    mesh_peers: int = Field(ge=0)
    updated_at: float = Field(description="unix seconds of the newest observation behind the route")


class GateChoice(BaseModel):
    model_config = ConfigDict(frozen=True)

    zone_id: str
    name: str
    walk_s: float = Field(ge=0)
    way_ahead: WayAhead
    note: str | None = None
    selected: bool = False


class LeaveOption(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    label: str
    total_s: float = Field(ge=0, description="door-to-car seconds, including any wait")
    way_ahead: WayAhead
    spent: str
    recommendation_note: str | None = Field(
        default=None,
        description="engine-authored reason this option is recommended; absent otherwise",
    )


class ViewBase(BaseModel):
    model_config = ConfigDict(frozen=True)

    now: float
    link: LinkStatus
    route: Route


class ArrivalView(ViewBase):
    kind: Literal["arrival"]
    gates: list[GateChoice]
    note: str


class WalkView(ViewBase):
    kind: Literal["walk"]


class AheadView(ViewBase):
    kind: Literal["ahead"]
    step_id: str
    offer: RerouteOffer


class ReroutedView(ViewBase):
    kind: Literal["rerouted"]
    instead_of: Route
    added_s: float
    reason: str


class OfflineView(ViewBase):
    kind: Literal["offline"]


class HoldView(ViewBase):
    kind: Literal["hold"]
    options: list[LeaveOption]
    recommended_id: str
    headline: str
    because: str


_SPECTATOR_VIEW = Annotated[
    ArrivalView | WalkView | AheadView | ReroutedView | OfflineView | HoldView,
    Field(discriminator="kind"),
]


class SpectatorView(RootModel[_SPECTATOR_VIEW]):
    """One of the six screen states for a race day."""
