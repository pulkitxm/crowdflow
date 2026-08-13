"""Wire models — the shapes the operator console receives.

These exist because a `TickResult` is a core dataclass, and a dataclass is not a
schema. Everything here is either a contract model passed straight through, or a
thin envelope that adds transport facts (which tick, how long it took, what the
console missed while it was disconnected).

Two rules hold this file honest:

  * **No new physics.** Every field is copied from something core computed, or
    counted. `test_wire.py` asserts the envelope covers every public field of
    `TickResult` and of `RunMetrics`, so a new metric in core cannot silently
    fail to reach the console.
  * **Generated, not hand-written.** `scripts/generate.py` emits these into
    `packages/api/ts/index.ts`, importing the contract types from the contracts
    package rather than restating them. The dashboard therefore has exactly one
    definition of a `ZoneState`.
"""

from __future__ import annotations

from enum import Enum

from crowdflow_contracts import (
    CircuitPack,
    Forecast,
    InterventionCandidate,
    LOSBand,
    Position,
    RerouteCommand,
    SafetyVerdict,
    VenueState,
)
from pydantic import BaseModel, ConfigDict, Field

# --------------------------------------------------------------------------
# Geometry and metadata
# --------------------------------------------------------------------------


class VenueGeometry(BaseModel):
    """Everything needed to draw the venue, sent once per console.

    The track polyline is carried beside the pack because it is geometry, not
    graph: it is what makes the schematic recognisable as Silverstone rather
    than as an abstract network, and no engine consumes it.
    """

    model_config = ConfigDict(frozen=True)

    pack: CircuitPack
    track: list[Position] = Field(
        default_factory=list, description="circuit outline in the venue's metric frame"
    )
    integrity_problems: list[str] = Field(
        default_factory=list,
        description="pack.validate_integrity() — shown, not hidden: a console that "
        "silently renders a broken pack is worse than one that says so",
    )


class CircuitSummary(BaseModel):
    """One row of the circuit picker."""

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    zones: int
    edges: int
    crossings: int
    track_length_m: float
    untrustworthy_widths: int = Field(
        description="edges whose width is assumed rather than measured. Flow is per "
        "metre of width, so these zones' bands are provisional."
    )


class BandBoundary(BaseModel):
    """One operational band with the numbers that define it.

    The console shows a word and a number for every state; this is where the
    numbers come from. Serving them rather than hard-coding them in TypeScript
    is the whole point — change a constant in `standards.py` and the legend on
    the wall moves with it.
    """

    model_config = ConfigDict(frozen=True)

    band: LOSBand
    label: str
    los_grades: str
    density_min: float = Field(description="persons/m2, inclusive")
    density_max: float | None = Field(description="persons/m2, exclusive; None = unbounded")


class LosGrade(BaseModel):
    """One Fruin grade. Console only — the spectator app never shows these."""

    model_config = ConfigDict(frozen=True)

    grade: str
    flow_min: float
    flow_max: float | None
    note: str


class StandardsReport(BaseModel):
    """The constants registry, served at runtime.

    Every threshold the console displays comes from here, so there is no second
    copy of Fruin's numbers living in a stylesheet.
    """

    model_config = ConfigDict(frozen=True)

    source: str
    bands: list[BandBoundary]
    los: list[LosGrade]
    capacity_density: float = Field(description="persons/m2 at maximum flow")
    jam_density: float
    free_flow_speed_ms: float
    max_achievable_flow: float = Field(
        description="ped/m/min at capacity density — below Fruin's LOS E/F boundary, "
        "which is why the system classifies on density"
    )
    measured_not_assumed: list[str]


# --------------------------------------------------------------------------
# Live tick
# --------------------------------------------------------------------------


class NodeMark(BaseModel):
    """One anonymous device, reduced to what a map needs.

    The rotating pseudonym is deliberately dropped at this boundary. The console
    has no use for device identity — it plots dots — and an operator screen that
    never receives an id cannot leak one, however long it is left running in a
    room with a window.
    """

    model_config = ConfigDict(frozen=True)

    x: float
    y: float
    speed_ms: float
    accuracy_m: float = Field(description="positional 1-sigma; the dot is not a point")


class CoverageReport(BaseModel):
    """What the system can and cannot see this tick.

    `VenueState.coverage` divides observed zones by observed-plus-declared-
    unobserved, which omits zones that reported recently but not now. Those
    zones exist and the operator is entitled to know about them, so the
    denominator here is every zone in the pack and the third category is
    reported separately.
    """

    model_config = ConfigDict(frozen=True)

    zones_total: int = Field(description="every zone in the circuit pack")
    observed: int = Field(description="zones with a reading this tick")
    unknown: int = Field(description="zones the state engine declares unobserved")
    silent: int = Field(
        description="zones in neither list: seen within the stale window, nothing now. "
        "Not empty, not currently known."
    )
    low_confidence: int = Field(
        description="observed zones whose Confidence.is_reportable is False — a number "
        "exists but the contract says do not lean on it"
    )
    fraction_observed: float = Field(ge=0, le=1, description="observed / zones_total")


class PopulationSnapshot(BaseModel):
    """Simulated crowd bookkeeping. Ground truth, which only exists in simulation.

    Shown beside the estimate on purpose: the console is also how we check that
    the estimate tracks reality at the current participation rate.
    """

    model_config = ConfigDict(frozen=True)

    total: int
    waiting: int = Field(description="created but not yet departed")
    active: int
    arrived: int
    observed_nodes: int = Field(description="devices reporting — NOT people")
    estimated_present: int = Field(description="observed devices scaled by participation")


class MetricsSnapshot(BaseModel):
    """Running totals, using core's A/B definitions verbatim.

    Same numbers the gate is judged on, so the console cannot flatter a run the
    harness would fail.
    """

    model_config = ConfigDict(frozen=True)

    peak_density: float
    critical_zone_seconds: float
    building_zone_seconds: float
    peak_critical_zones: int
    total_queue_peak: float
    arrived: int
    mean_walk_s: float
    p95_walk_s: float
    interventions: int
    rejected_by_safety: int
    samples: int


class EventKind(str, Enum):
    SESSION = "session"
    BAND = "band"
    COVERAGE = "coverage"
    FORECAST = "forecast"
    INTERVENTION = "intervention"
    COMMAND = "command"
    SAFETY = "safety"


class EventSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class ConsoleEvent(BaseModel):
    """One line of the race-control feed.

    A log of transitions core already computed — a band change is `ZoneState.band`
    differing from last tick's, not a fresh classification. The adapter keeps the
    log because only the adapter sees every tick; a console that connects late
    would otherwise start with an empty screen and no history.
    """

    model_config = ConfigDict(frozen=True)

    seq: int = Field(description="monotonic within a session; the console dedupes on it")
    time_s: float = Field(description="simulation clock")
    kind: EventKind
    severity: EventSeverity
    message: str
    zone_id: str | None = None
    detail: str | None = None


class TickEnvelope(BaseModel):
    """One tick of the loop, as the console receives it.

    Mirrors `crowdflow_core.loop.TickResult` field for field, plus the transport
    facts a live screen needs: which tick, what it cost, and what the system
    could not see while producing it.
    """

    model_config = ConfigDict(frozen=True)

    tick: int
    time_s: float
    compute_ms: float = Field(
        description="measured wall time for this tick. Shown, because an intervention "
        "sweep costs seconds and a console that hides the pause is lying about freshness."
    )

    state: VenueState
    forecasts: list[Forecast] = Field(default_factory=list)
    actionable: list[str] = Field(
        default_factory=list,
        description=(
            "zone ids whose forecast passes Forecast.is_actionable. Sent because "
            "that bar is a property on the contract rather than a serialised field, "
            "and a console that restated it in TypeScript would be a second copy of "
            "a threshold — the exact thing standards.py exists to prevent."
        ),
    )
    candidates: list[InterventionCandidate] = Field(
        default_factory=list, description="every option evaluated, rejected ones included"
    )
    command: RerouteCommand | None = None
    verdict: SafetyVerdict | None = None
    dispatched: bool = False

    silent_zones: list[str] = Field(
        default_factory=list, description="see CoverageReport.silent"
    )
    low_confidence_zones: list[str] = Field(default_factory=list)

    coverage: CoverageReport
    population: PopulationSnapshot
    metrics: MetricsSnapshot
    nodes: list[NodeMark] = Field(
        default_factory=list,
        description="every reporting device, undownsampled. Thinning the marks would "
        "understate coverage, which is the one thing this screen must not do.",
    )
    events: list[ConsoleEvent] = Field(default_factory=list, description="new this tick")


# --------------------------------------------------------------------------
# Session control
# --------------------------------------------------------------------------


class SessionStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    COMPUTING = "computing"
    FINISHED = "finished"


class SessionInfo(BaseModel):
    """What is running, and under exactly which parameters.

    Every input that changes the numbers is here — including the seed, so a
    screenshot of the console is enough to reproduce the run (invariant 6).
    """

    model_config = ConfigDict(frozen=True)

    session_id: str
    circuit_id: str
    scenario: str
    description: str
    status: SessionStatus

    seed: int
    population: int
    participation: float = Field(description="measured share running the app")
    compliance: float = Field(description="share who act on a reroute — ASSUMED in core")
    tick_s: float = Field(description="simulation seconds per tick")
    speed: float = Field(description="wall-clock multiplier; 1.0 is real time")
    intervene: bool

    origins: list[str] = Field(default_factory=list)
    destination: str | None = None

    tick: int = 0
    time_s: float = 0.0
    duration_s: float = 0.0
    computing_ms: float = Field(
        default=0.0, description="wall time spent in the tick currently being computed"
    )


class ScenarioOption(BaseModel):
    """A scenario the console can start, with the zones it would use.

    The zone choice is shown rather than hidden: 'everyone leaves at once' is a
    different experiment depending on which stands and which car park, and an
    operator comparing two runs needs to know it was the same one.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    description: str
    origins: list[str] = Field(default_factory=list)
    destination: str | None = None
    origin_names: list[str] = Field(default_factory=list)
    destination_name: str | None = None


class SessionRequest(BaseModel):
    """Start or restart a run.

    Defaults come from `SimConfig`, not from literals typed here — one place
    decides what a default participation rate is.
    """

    circuit_id: str = "silverstone"
    scenario: str = "egress"
    seed: int | None = None
    population: int | None = None
    participation: float | None = Field(default=None, gt=0, le=1)
    tick_s: float | None = Field(default=None, gt=0)
    speed: float | None = Field(default=None, gt=0)
    intervene: bool = True
    origins: list[str] | None = None
    destination: str | None = None


class ControlAction(str, Enum):
    PLAY = "play"
    PAUSE = "pause"
    STEP = "step"
    SPEED = "speed"


class ControlRequest(BaseModel):
    action: ControlAction
    speed: float | None = Field(default=None, gt=0, description="only for action=speed")


# --------------------------------------------------------------------------
# WebSocket framing
# --------------------------------------------------------------------------


class FrameType(str, Enum):
    HELLO = "hello"
    TICK = "tick"
    STATUS = "status"


class SocketFrame(BaseModel):
    """Every WebSocket message, one shape.

    `session` is present on all three types deliberately. A console that has not
    received a tick for nine seconds must be able to tell "the server is inside
    an intervention sweep" from "the link is dead", and it can only do that if
    the status frames keep arriving with the run state attached.
    """

    model_config = ConfigDict(frozen=True)

    type: FrameType
    session: SessionInfo
    standards: StandardsReport | None = Field(
        default=None, description="sent once, on hello"
    )
    geometry_url: str | None = Field(
        default=None, description="sent on hello; geometry is too large to push per tick"
    )
    backlog: list[ConsoleEvent] = Field(
        default_factory=list, description="on hello: what the console missed"
    )
    tick: TickEnvelope | None = None
    last_tick: TickEnvelope | None = Field(
        default=None, description="on hello: the most recent tick, so the screen is never blank"
    )
    note: str | None = None


EXPORTED: tuple[type[BaseModel | Enum], ...] = (
    VenueGeometry,
    CircuitSummary,
    BandBoundary,
    LosGrade,
    StandardsReport,
    NodeMark,
    CoverageReport,
    PopulationSnapshot,
    MetricsSnapshot,
    EventKind,
    EventSeverity,
    ConsoleEvent,
    TickEnvelope,
    SessionStatus,
    SessionInfo,
    ScenarioOption,
    SessionRequest,
    ControlAction,
    ControlRequest,
    FrameType,
    SocketFrame,
)
"""What `scripts/generate.py` emits to TypeScript. Ordered so that a type appears
after the types it references, because the emitter does not sort."""
