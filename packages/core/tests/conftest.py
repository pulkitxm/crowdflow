"""Small hand-built venues for the Phase 2 engine tests.

The Silverstone pack is 1,875 zones of imported OSM. Excellent for proving the
system runs at venue scale, useless for proving *why* an engine did something:
any assertion over it is really an assertion about which footpath the importer
happened to keep. So the engine tests run on venues small enough to reason about
by hand, where the expected answer is arithmetic rather than observation.

Geometry is chosen so the numbers are round: the diamond's two arms differ by a
known ratio, and every width is MEASURED so no test result depends on the
untrusted-width tax.
"""

from __future__ import annotations

import pytest
from crowdflow_contracts import (
    Availability,
    CircuitPack,
    CoordinateFrame,
    Crossing,
    CrossingKind,
    Edge,
    Provenance,
    SafetyConstraints,
    Sourced,
    Zone,
    ZoneKind,
)
from crowdflow_contracts.telemetry import Position

from crowdflow_core.routing import VenueGraph

MEASURED_SAMPLES = 100
"""Enough samples that Sourced.is_trustworthy holds (its floor is 30), so a
fixture width never silently triggers UNTRUSTED_WIDTH_PENALTY."""


def measured(value: float) -> Sourced:
    return Sourced(value=value, provenance=Provenance.MEASURED, samples=MEASURED_SAMPLES)


def zone(zid: str, x: float, y: float, kind: ZoneKind = ZoneKind.CONCOURSE) -> Zone:
    return Zone(id=zid, kind=kind, name=zid, position=Position(x=x, y=y))


def edge(
    eid: str,
    source: str,
    destination: str,
    length_m: float,
    width_m: float = 4.0,
    *,
    free_speed_ms: float | None = None,
) -> Edge:
    return Edge(
        id=eid,
        source=source,
        destination=destination,
        length_m=length_m,
        width_m=measured(width_m),
        free_speed_ms=None if free_speed_ms is None else measured(free_speed_ms),
    )


def make_pack(
    zones: list[Zone],
    edges: list[Edge],
    crossings: list[Crossing] | None = None,
    constraints: SafetyConstraints | None = None,
) -> CircuitPack:
    return CircuitPack(
        id="testcircuit",
        name="Test Circuit",
        geometry_source="authored",
        track_length_m=1000.0,
        altitude_m=0.0,
        frame=CoordinateFrame(
            origin_lat=52.0,
            origin_lon=-1.0,
            track_bounds_m=(1000.0, 1000.0),
            venue_bounds_m=(-100.0, -100.0, 1100.0, 1100.0),
        ),
        zones={z.id: z for z in zones},
        edges={e.id: e for e in edges},
        crossings={c.id: c for c in (crossings or [])},
        constraints=constraints or SafetyConstraints(),
    )


@pytest.fixture
def diamond_pack() -> CircuitPack:
    """gate -> (north | south) -> exit, plus a short direct link.

        north      600 m each arm
      /      \\
    gate --- exit    direct: 200 m, and it is an at-grade crossing
      \\      /
        south      1200 m each arm

    The direct link is the fast route and the one that closes when cars run —
    the shape every circuit has, and the reason routing is time-dependent.
    """
    zones = [
        zone("gate", 0.0, 0.0, ZoneKind.GATE),
        zone("north", 100.0, 200.0),
        zone("south", 100.0, -200.0),
        zone("exit", 200.0, 0.0, ZoneKind.EXIT),
        # A working position beside the track. Reachable on paper, never
        # routable: it exists so `never_route_through` names something that is
        # genuinely forbidden rather than a legitimate detour. Marking `north`
        # forbidden — as this fixture used to — made the constraint inert,
        # because every routing test walks through north and expected to.
        zone("marshal", 100.0, 60.0),
    ]
    edges = [
        edge("e_direct", "gate", "exit", 200.0),
        edge("e_gate_north", "gate", "north", 600.0),
        edge("e_north_exit", "north", "exit", 600.0),
        edge("e_gate_south", "gate", "south", 1200.0),
        edge("e_south_exit", "south", "exit", 1200.0),
        edge("e_gate_marshal", "gate", "marshal", 150.0),
        edge("e_marshal_exit", "marshal", "exit", 150.0),
    ]
    crossings = [
        Crossing(
            id="x_direct",
            kind=CrossingKind.AT_GRADE,
            edge_id="e_direct",
            throughput_per_min=measured(80.0),
            availability=Availability(always_open=False, closed_when=["race"]),
        )
    ]
    return make_pack(
        zones,
        edges,
        crossings,
        SafetyConstraints(never_route_through=["marshal"], emergency_exits=["exit"]),
    )


@pytest.fixture
def diamond(diamond_pack: CircuitPack) -> VenueGraph:
    """Built during practice, when the at-grade crossing is open.

    The session matters: with no session state at all, Availability treats every
    time-limited edge as closed (fail-safe), which is correct but makes for a
    graph with no short route in it. See
    test_an_unknown_session_closes_every_time_limited_edge.
    """
    return VenueGraph(diamond_pack, "practice")


@pytest.fixture
def corridor_pack() -> CircuitPack:
    """A single 100 m x 5 m corridor between two zones.

    Area is exactly 500 m^2 either side of the midpoint rule, which makes the
    state engine's density arithmetic checkable on paper: a zone owns half of
    each incident edge, so `hall` owns 250 m^2.
    """
    zones = [
        zone("gate", 0.0, 0.0, ZoneKind.GATE),
        zone("hall", 100.0, 0.0),
        zone("stand", 200.0, 0.0, ZoneKind.VIEWING),
    ]
    edges = [
        edge("e_gate_hall", "gate", "hall", 100.0, width_m=5.0),
        edge("e_hall_stand", "hall", "stand", 100.0, width_m=5.0),
    ]
    return make_pack(zones, edges)
