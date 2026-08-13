"""What devices emit.

Two payloads, deliberately separate:

  CrowdNode      live state, aggregated and disposable   -> state engine
  TraceFragment  noised, short, un-linkable              -> venue refinement

Conflating them would leak a trace through the state path. A CrowdNode says
"someone is here now"; a TraceFragment says "this stretch is walkable" and is
built so that it cannot say who walked it.

The simulator emits exactly these types. The core cannot tell simulated telemetry
from a real phone -- that invariant is what lets one stand in for the other.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class Position(BaseModel):
    """A point in the venue's local metric frame, in metres.

    Never latitude/longitude. Lat/lon exists only at the circuit pack's origin and
    at the device's location adapter (plan.md section 10).
    """

    model_config = ConfigDict(frozen=True)

    x: float = Field(description="metres east of venue origin")
    y: float = Field(description="metres north of venue origin")


class CrowdNode(BaseModel):
    """One anonymous device's live movement state.

    node_id is a rotating pseudonym, not an identity. It is valid only within its
    rotation epoch and must never be joined across epochs.
    """

    model_config = ConfigDict(frozen=True)

    node_id: str = Field(description="rotating pseudonym, valid within its epoch only")
    epoch: int = Field(description="ID rotation epoch; IDs are not comparable across epochs")
    timestamp: float = Field(description="unix seconds")

    position: Position
    speed_ms: float = Field(ge=0, description="metres per second")
    heading_deg: float = Field(ge=0, lt=360, description="degrees clockwise from north")

    accuracy_m: float = Field(gt=0, description="positional 1-sigma; feeds the confidence model")
    zone_id: str | None = Field(
        default=None,
        description="assigned by the state engine, not self-reported",
    )


class TraceFragment(BaseModel):
    """A short, noised path segment contributed for venue refinement.

    Carries planar Laplace noise applied ON DEVICE before storage
    (geo-indistinguishability, Andres et al. CCS 2013 -- see plan/methods.md
    section 4). Fragments are deliberately too short to reconstruct one person's
    day, and their IDs rotate per fragment.

    Accurate in aggregate, deniable individually: map refinement is density
    estimation over many fragments, and zero-mean noise averages out.
    """

    model_config = ConfigDict(frozen=True)

    fragment_id: str = Field(description="per-fragment random; never reused, never linkable")
    points: list[Position] = Field(min_length=2, description="noised, in venue frame")
    t_start: float = Field(description="unix seconds")
    t_end: float = Field(description="unix seconds")

    epsilon: float = Field(
        gt=0,
        description="geo-indistinguishability privacy parameter actually applied",
    )
    noise_radius_m: float = Field(
        gt=0,
        description="radius within which the true path is indistinguishable",
    )

    @property
    def duration_s(self) -> float:
        return self.t_end - self.t_start


class MeshMessageType(str, Enum):
    HELLO = "hello"
    PEER_DISCOVERY = "peer_discovery"
    STATE_UPDATE = "state_update"
    ZONE_UPDATE = "zone_update"
    TRACE_FRAGMENT = "trace_fragment"
    ROUTE_UPDATE = "route_update"
    ALERT = "alert"
    REROUTE = "reroute"
    ACK = "ack"
    HEARTBEAT = "heartbeat"
    SYNC = "sync"


class MeshClass(str, Enum):
    """Traffic class, which selects the routing protocol.

    Flooding everything is epidemic routing: highest delivery, but buffer
    exhaustion and battery drain, which is fatal for phones in pockets.
    See plan/methods.md section 5. The UPLINK recommendation was deliberately
    revised after measurement: PRoPHET bought only 0.6 percentage points of
    delivery for about 3.1x the radio traffic, so both loss-tolerant classes now
    use the bounded policy until encounter predictability proves a material gain.
    """

    STATE = "state"
    """High volume, loss-tolerant -> Spray-and-Wait with a small copy bound."""

    UPLINK = "uplink"
    """Must reach any connected node -> bounded Spray-and-Wait.

    D7 makes the destination a property rather than an address. PRoPHET is an
    elegant theoretical fit, but the branch's own seeded comparison did not
    justify its battery cost. Keep the class separate so a measured deployment
    can revisit the policy without changing the wire format.
    """

    URGENT = "urgent"
    """Rare, must arrive -> rate-limited epidemic. Affordable because it is rare."""


class MeshMessage(BaseModel):
    """Envelope for anything crossing the mesh.

    sequence prevents duplicate processing; ttl stops packets travelling forever.
    Both are enforced at every hop, not just at the destination.
    """

    model_config = ConfigDict(frozen=True)

    type: MeshMessageType
    traffic_class: MeshClass
    source: str = Field(description="rotating node pseudonym of the originator")
    sequence: int = Field(ge=0, description="per-source monotonic; used for dedupe")
    ttl: int = Field(ge=0, le=8, description="hops remaining")
    timestamp: float

    payload: dict = Field(default_factory=dict)

    def hop(self) -> MeshMessage:
        """Decrement TTL for relay. Returns a new message; originals stay frozen."""
        return self.model_copy(update={"ttl": max(0, self.ttl - 1)})

    @property
    def expired(self) -> bool:
        return self.ttl <= 0
