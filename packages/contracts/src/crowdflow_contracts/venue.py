"""Circuit pack and event profile.

Per D6 the venue structure is IMPORTED before the event (OpenStreetMap plus the
official venue map) and REFINED by observation afterwards. Every field therefore
records its provenance: a capacity that was measured is a different kind of fact
from one that was read off a plan, and the routing engine should know which it has.

Geography is static and lives in the CircuitPack. The timetable changes every
weekend and lives in the EventProfile. Session state drives crossing availability,
so the event profile is an input to the graph, not only to the predictor.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

from .standards import MEASURED_SAMPLE_FLOOR
from .telemetry import Position


class Provenance(str, Enum):
    """Where a value came from. Never decorative — routing weights it."""

    OSM = "osm"
    VENUE_MAP = "venue_map"
    F1_CIRCUITS = "f1_circuits"
    AUTHORED = "authored"
    MEASURED = "measured"
    ASSUMED = "assumed"


class Sourced(BaseModel):
    """A value with its provenance and, where applicable, its sample count."""

    model_config = ConfigDict(frozen=True)

    value: float
    provenance: Provenance
    samples: int | None = Field(default=None, description="observations behind a MEASURED value")
    note: str | None = None

    @property
    def is_trustworthy(self) -> bool:
        """Whether routing should treat this value as settled.

        A MEASURED value is only better than an imported one once enough
        observations stand behind it — nine traces and nine thousand traces are
        not the same fact, and `samples` is what tells them apart. The floor is
        `standards.MEASURED_SAMPLE_FLOOR`, not a literal, so it can be argued
        with in one place.
        """
        if self.provenance is Provenance.MEASURED:
            return (self.samples or 0) >= MEASURED_SAMPLE_FLOOR
        return self.provenance is not Provenance.ASSUMED


class ZoneKind(str, Enum):
    GATE = "gate"
    CONCOURSE = "concourse"
    CROSSING = "crossing"
    VIEWING = "viewing"
    AMENITY = "amenity"
    PARKING = "parking"
    EXIT = "exit"


class CrossingKind(str, Enum):
    BRIDGE = "bridge"
    TUNNEL = "tunnel"
    AT_GRADE = "at_grade"


class Zone(BaseModel):
    """A named place. Imported from OSM tags where possible."""

    model_config = ConfigDict(frozen=True)

    id: str
    kind: ZoneKind
    name: str | None = Field(default=None, description="human-readable; the app uses this")
    position: Position
    capacity: Sourced | None = None
    osm_id: str | None = None


class Edge(BaseModel):
    """A walkable connection.

    width_m matters more than it looks: flow rate is per metre of width, so the
    LOS band cannot be computed without it.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    source: str
    destination: str
    length_m: float = Field(gt=0)
    width_m: Sourced = Field(description="required — LOS flow is per metre of width")
    gradient: float = Field(default=0.0, description="rise over run; affects walking speed")
    bidirectional: bool = True
    free_speed_ms: Sourced | None = Field(
        default=None, description="observed where available, else the standards prior"
    )
    capacity_flow_ped_m_min: Sourced | None = Field(
        default=None,
        description="observed peak sustained flow per metre of width; never invented",
    )


class Availability(BaseModel):
    """When an edge exists at all (D5).

    `blocked: bool` cannot express "open until quali, then closed for sixty
    minutes". At-grade crossings close whenever cars are running, which makes
    routing time-dependent: a path is valid only if each edge is still open when
    the walker would actually reach it.
    """

    model_config = ConfigDict(frozen=True)

    always_open: bool = True
    open_when: list[str] = Field(default_factory=list, description="session states")
    closed_when: list[str] = Field(default_factory=list)
    close_lead_s: float = Field(default=0, description="closes this long before cars run")
    reopen_lag_s: float = Field(default=0)

    def is_open_during(self, session_state: str | None) -> bool:
        if self.always_open:
            return True
        if session_state is None:
            return False
        if session_state in self.closed_when:
            return False
        return not self.open_when or session_state in self.open_when


class Crossing(BaseModel):
    """The dominant bottleneck mechanism at a circuit.

    Bridges and tunnels stay open but carry far less than the at-grade crossings
    they replace — which is exactly why they pinch when a session starts.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    kind: CrossingKind
    edge_id: str
    throughput_per_min: Sourced
    availability: Availability = Field(default_factory=Availability)


class CoordinateFrame(BaseModel):
    """Local metric frame. Derived from the source bbox, never estimated."""

    model_config = ConfigDict(frozen=True)

    origin_lat: float
    origin_lon: float
    rotation_deg: float = 0.0
    track_bounds_m: tuple[float, float] = Field(description="track extent (x, y)")
    venue_bounds_m: tuple[float, float, float, float] = Field(
        description=(
            "(min_x, min_y, max_x, max_y). Larger than the track: car parks, campsites "
            "and park-and-ride sit outside it. Sizing to the track clips arrival routes."
        )
    )


class SafetyConstraints(BaseModel):
    """Hard rules the agent cannot override."""

    model_config = ConfigDict(frozen=True)

    never_route_through: list[str] = Field(default_factory=list)
    emergency_exits: list[str] = Field(default_factory=list)
    accessible_routes: list[list[str]] = Field(default_factory=list)


class CircuitPack(BaseModel):
    """One venue. Swapping circuits must require no code change."""

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    geometry_source: str = Field(description="f1-circuits id, e.g. gb-1948")
    track_length_m: float
    altitude_m: float

    frame: CoordinateFrame
    zones: dict[str, Zone] = Field(default_factory=dict)
    edges: dict[str, Edge] = Field(default_factory=dict)
    crossings: dict[str, Crossing] = Field(default_factory=dict)
    constraints: SafetyConstraints = Field(default_factory=SafetyConstraints)

    def validate_integrity(self) -> list[str]:
        """Structural problems, as human-readable strings.

        Fails loudly at load rather than as a NaN inside the routing engine.
        """
        problems: list[str] = []
        for e in self.edges.values():
            if e.source not in self.zones:
                problems.append(f"edge {e.id}: unknown source zone {e.source!r}")
            if e.destination not in self.zones:
                problems.append(f"edge {e.id}: unknown destination zone {e.destination!r}")
        for c in self.crossings.values():
            if c.edge_id not in self.edges:
                problems.append(f"crossing {c.id}: unknown edge {c.edge_id!r}")
        connected = {e.source for e in self.edges.values()} | {
            e.destination for e in self.edges.values()
        }
        for z in self.zones.values():
            if z.id not in connected:
                problems.append(f"zone {z.id}: orphaned, no edge references it")
        for exit_id in self.constraints.emergency_exits:
            if exit_id not in self.zones:
                problems.append(f"emergency exit {exit_id!r} is not a known zone")
        return problems


class Session(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    kind: str = Field(description="practice | qualifying | sprint | race | support | ceremony")
    start: str = Field(description="ISO 8601")
    end: str


class EventProfile(BaseModel):
    """This weekend's timetable. Changes every event; the circuit does not.

    The chequered flag is the largest crowd-movement trigger of the day, so this
    feeds the predictor directly, not just the display.
    """

    model_config = ConfigDict(frozen=True)

    circuit_id: str
    name: str
    sessions: list[Session] = Field(default_factory=list)
    gates_open: str | None = None
