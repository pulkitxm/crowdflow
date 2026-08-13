"""Fixtures for the agent tests.

A small hand-built venue rather than the Silverstone pack: the safety tests need
a zone that is explicitly forbidden and an emergency exit that must stay
reachable, and stating those in four lines beats hunting for them in 1,875 zones.
"""

from __future__ import annotations

import pytest
from crowdflow_agent import FakeModelClient, InsightEngine, ModelResponse, OpsContext, Toolbox
from crowdflow_contracts import (
    CircuitPack,
    Confidence,
    CoordinateFrame,
    Edge,
    EventProfile,
    Forecast,
    LOSBand,
    Position,
    Provenance,
    SafetyConstraints,
    Session,
    Sourced,
    VenueState,
    Zone,
    ZoneKind,
    ZoneState,
)
from crowdflow_core.routing import VenueGraph
from crowdflow_core.safety import SafetyEngine

PARTICIPATION = 0.2

ZONES: dict[str, tuple[float, float, ZoneKind, str]] = {
    "gate-1": (0.0, 0.0, ZoneKind.GATE, "Gate 1"),
    "concourse": (200.0, 0.0, ZoneKind.CONCOURSE, "Vale Concourse"),
    "gate-2": (400.0, 0.0, ZoneKind.GATE, "Gate 2"),
    "marshal-post": (200.0, 120.0, ZoneKind.AMENITY, "Marshal Post 7"),
    "exit-a": (600.0, 0.0, ZoneKind.EXIT, "Exit A"),
}

EDGES = [
    ("e-1", "gate-1", "concourse"),
    ("e-2", "concourse", "gate-2"),
    ("e-3", "concourse", "marshal-post"),
    ("e-4", "gate-2", "exit-a"),
]


def build_pack(
    *,
    forbidden: tuple[str, ...] = ("marshal-post",),
    exits: tuple[str, ...] = ("exit-a",),
    extra_gates: dict[str, str] | None = None,
    island: bool = False,
) -> CircuitPack:
    """`island` adds a connected pair of zones the main graph cannot reach —
    a campsite across a live circuit, which is a real thing at a real venue and
    the only honest way to test 'no path exists'."""
    import math

    zones = {
        zid: Zone(id=zid, kind=kind, name=name, position=Position(x=x, y=y))
        for zid, (x, y, kind, name) in ZONES.items()
    }
    edges = {}
    for eid, a, b in EDGES:
        ax, ay, *_ = ZONES[a]
        bx, by, *_ = ZONES[b]
        edges[eid] = Edge(
            id=eid,
            source=a,
            destination=b,
            length_m=math.dist((ax, ay), (bx, by)),
            width_m=Sourced(value=6.0, provenance=Provenance.MEASURED, samples=120),
        )

    # Extra gates exist only so peer comparison has a peer group; they hang off
    # the concourse so the graph stays connected and integrity stays clean.
    for i, (zid, name) in enumerate(sorted((extra_gates or {}).items())):
        zones[zid] = Zone(
            id=zid, kind=ZoneKind.GATE, name=name,
            position=Position(x=200.0, y=-100.0 * (i + 1)),
        )
        eid = f"e-extra-{zid}"
        edges[eid] = Edge(
            id=eid, source="concourse", destination=zid, length_m=100.0 * (i + 1),
            width_m=Sourced(value=6.0, provenance=Provenance.MEASURED, samples=120),
        )

    if island:
        for zid, x in (("campsite-a", -900.0), ("campsite-b", -800.0)):
            zones[zid] = Zone(
                id=zid, kind=ZoneKind.PARKING, name=zid,
                position=Position(x=x, y=-900.0),
            )
        edges["e-island"] = Edge(
            id="e-island", source="campsite-a", destination="campsite-b",
            length_m=100.0,
            width_m=Sourced(value=3.0, provenance=Provenance.MEASURED, samples=90),
        )

    return CircuitPack(
        id="test-circuit",
        name="Test Circuit",
        geometry_source="test",
        track_length_m=5000.0,
        altitude_m=100.0,
        frame=CoordinateFrame(
            origin_lat=52.0,
            origin_lon=-1.0,
            track_bounds_m=(1000.0, 1000.0),
            venue_bounds_m=(-1000.0, -1000.0, 1000.0, 1000.0),
        ),
        zones=zones,
        edges=edges,
        constraints=SafetyConstraints(
            never_route_through=list(forbidden), emergency_exits=list(exits)
        ),
    )


def zone_state(
    zone_id: str,
    *,
    now: float = 0.0,
    density: float = 0.4,
    speed: float = 1.2,
    outflow: float = 100.0,
    inflow: float = 100.0,
    nodes: int = 40,
    confidence: float = 0.7,
) -> ZoneState:
    return ZoneState(
        zone_id=zone_id,
        timestamp=now,
        observed_nodes=nodes,
        participation_rate=PARTICIPATION,
        density_persons_m2=density,
        flow_ped_m_min=round(density * speed * 60, 2),
        mean_speed_ms=speed,
        inflow_per_min=inflow,
        outflow_per_min=outflow,
        confidence=Confidence(
            value=confidence,
            observed_nodes=nodes,
            freshness_s=2.0,
            mean_accuracy_m=8.0,
            stability=0.8,
        ),
    )


def build_state(
    pack: CircuitPack,
    *,
    now: float = 1000.0,
    session_id: str | None = "quali",
    unobserved: tuple[str, ...] = ("marshal-post",),
    overrides: dict[str, ZoneState] | None = None,
) -> VenueState:
    zones = {
        zid: zone_state(zid, now=now)
        for zid in pack.zones
        if zid not in unobserved
    }
    zones.update(overrides or {})
    return VenueState(
        circuit_id=pack.id,
        timestamp=now,
        session_id=session_id,
        zones=zones,
        unobserved_zones=list(unobserved),
    )


def build_event(pack: CircuitPack) -> EventProfile:
    return EventProfile(
        circuit_id=pack.id,
        name="Test Grand Prix",
        gates_open="2026-07-04T08:00:00Z",
        sessions=[
            Session(id="fp1", kind="practice",
                    start="2026-07-04T12:30:00Z", end="2026-07-04T13:30:00Z"),
            Session(id="quali", kind="qualifying",
                    start="2026-07-04T16:00:00Z", end="2026-07-04T17:00:00Z"),
        ],
    )


def build_context(
    pack: CircuitPack | None = None,
    *,
    state: VenueState | None = None,
    forecasts: list[Forecast] | None = None,
    insights: InsightEngine | None = None,
    now: float = 1000.0,
) -> OpsContext:
    pack = pack or build_pack()
    state = state or build_state(pack, now=now)
    graph = VenueGraph(pack, state.session_id)
    return OpsContext(
        pack=pack,
        graph=graph,
        safety=SafetyEngine(pack),
        state=state,
        now=now,
        forecasts=forecasts if forecasts is not None else [sample_forecast(now)],
        event=build_event(pack),
        insights=insights,
    )


def sample_forecast(now: float = 1000.0) -> Forecast:
    return Forecast(
        zone_id="concourse",
        issued_at=now,
        horizon_s=300.0,
        target_band=LOSBand.CRITICAL,
        probability=0.82,
        time_to_threshold_s=167.0,
        projected_peak_flow=2.3,
        confidence=0.7,
        model_id="baseline-v1",
        causes=["inflow 240/min against outflow 90/min"],
    )


@pytest.fixture()
def pack() -> CircuitPack:
    return build_pack()


@pytest.fixture()
def context(pack: CircuitPack) -> OpsContext:
    return build_context(pack)


@pytest.fixture()
def toolbox(context: OpsContext) -> Toolbox:
    return Toolbox(context)


def call(name: str, arguments: dict, call_id: str = "call-1") -> ModelResponse:
    """A scripted turn in which the model calls exactly one tool."""
    from crowdflow_agent import ToolCall

    return ModelResponse(
        tool_calls=(ToolCall(id=call_id, name=name, arguments=arguments),)
    )


def says(text: str) -> ModelResponse:
    return ModelResponse(text=text)


def scripted(*responses: ModelResponse) -> FakeModelClient:
    return FakeModelClient(list(responses))
