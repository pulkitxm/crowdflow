"""Fixtures.

Most tests run on a three-zone synthetic venue rather than on Silverstone. Not
for speed — for control: a corridor that is deliberately too narrow congests on
tick four, which is the only way to test what the console does when a zone goes
CRITICAL, loses coverage, or reports a number nobody should trust.

The Silverstone pack is used where the point is that the real thing loads.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from crowdflow_api import packs
from crowdflow_api.wire import ScenarioOption
from crowdflow_contracts import (
    CircuitPack,
    CoordinateFrame,
    Edge,
    Position,
    Provenance,
    Sourced,
    Zone,
    ZoneKind,
)
from crowdflow_core.routing import VenueGraph

REPO_ROOT = Path(__file__).resolve().parents[3]


def _sourced(value: float) -> Sourced:
    return Sourced(value=value, provenance=Provenance.MEASURED, samples=64)


@pytest.fixture
def toy_circuit() -> packs.LoadedCircuit:
    """Stand -> pinch -> car park, with the pinch too narrow to cope.

    Widths are measured-provenance so the routing engine does not tax them; the
    congestion has to come from geometry meeting demand, not from a penalty.
    """
    zones = {
        "stand": Zone(id="stand", kind=ZoneKind.VIEWING, name="Stand A",
                      position=Position(x=0.0, y=0.0)),
        "pinch": Zone(id="pinch", kind=ZoneKind.CONCOURSE, name="Bridge Approach",
                      position=Position(x=60.0, y=0.0)),
        "park": Zone(id="park", kind=ZoneKind.PARKING, name="Car Park 1",
                     position=Position(x=140.0, y=0.0)),
        "quiet": Zone(id="quiet", kind=ZoneKind.AMENITY, name="North Kiosks",
                      position=Position(x=60.0, y=200.0)),
    }
    edges = {
        "e-stand-pinch": Edge(id="e-stand-pinch", source="stand", destination="pinch",
                              length_m=60.0, width_m=_sourced(6.0)),
        "e-pinch-park": Edge(id="e-pinch-park", source="pinch", destination="park",
                             length_m=80.0, width_m=_sourced(1.5)),
        "e-pinch-quiet": Edge(id="e-pinch-quiet", source="pinch", destination="quiet",
                              length_m=200.0, width_m=_sourced(4.0)),
    }
    pack = CircuitPack(
        id="toy",
        name="Toy Circuit",
        geometry_source="synthetic",
        track_length_m=1000.0,
        altitude_m=0.0,
        frame=CoordinateFrame(
            origin_lat=52.0, origin_lon=-1.0,
            track_bounds_m=(200.0, 200.0),
            venue_bounds_m=(-50.0, -50.0, 250.0, 250.0),
        ),
        zones=zones,
        edges=edges,
    )
    return packs.LoadedCircuit(pack=pack, track=[], graph=VenueGraph(pack))


@pytest.fixture
def toy_option() -> ScenarioOption:
    return ScenarioOption(
        id="egress",
        name="Post-race egress",
        description="everyone leaves at once",
        origins=["stand"],
        destination="park",
        origin_names=["Stand A"],
        destination_name="Car Park 1",
    )


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO_ROOT
