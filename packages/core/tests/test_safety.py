"""The safety gate: hard constraints, stated reasons, no override.

Constraints here are not weighted against benefit. There is no flag that turns
them off, and a rejection always says what it caught — a verdict an operator
cannot read is a verdict they will learn to ignore.

The gate is also where invariant 4 lives: the agent recommends, the gate decides,
and nothing reaches the mesh without a verdict attached. test_loop.py checks the
loop end of that; this file checks the gate itself.
"""

from __future__ import annotations

import pytest
from crowdflow_contracts import RerouteCommand, SafetyOutcome

from crowdflow_core.routing import VenueGraph
from crowdflow_core.safety import SafetyEngine

from conftest import edge, make_pack, zone


def command(**overrides) -> RerouteCommand:
    """A command that would be approved, so each test changes exactly one thing."""
    base = dict(
        command_id="cmd-test",
        issued_at=0.0,
        expires_at=300.0,
        source_zone="gate",
        destination_zone="exit",
        avoid=["gate"],
        prefer=["south"],
        target_fraction=0.3,
        reason="density rising toward capacity",
        expected_cost_s=45.0,
    )
    base.update(overrides)
    return RerouteCommand(**base)


@pytest.fixture
def safety(diamond_pack) -> SafetyEngine:
    return SafetyEngine(diamond_pack)


# ------------------------------------------------------------- the baseline --

def test_a_clean_command_is_approved_and_still_says_why(safety):
    """Approvals are explained too. A gate that only speaks when it refuses
    leaves the operator guessing what it checked."""
    verdict = safety.review(command())
    assert verdict.outcome is SafetyOutcome.APPROVED
    assert verdict.may_dispatch
    assert verdict.violated_constraints == []
    assert verdict.reason


# ------------------------------------------------------------ hard refusals --

def test_a_command_preferring_a_forbidden_zone_is_rejected_with_a_reason(safety):
    """never_route_through is the pack's own list — marshal posts, working
    lanes, anything a spectator must not be sent along."""
    verdict = safety.review(command(prefer=["marshal"]))

    assert verdict.outcome is SafetyOutcome.REJECTED
    assert not verdict.may_dispatch
    assert verdict.violated_constraints == ["never_route_through"]
    assert "marshal" in verdict.reason
    assert "forbidden" in verdict.reason
    assert verdict.command_id == "cmd-test"


def test_the_forbidden_check_is_not_fooled_by_extra_zones(safety):
    verdict = safety.review(command(prefer=["south", "marshal"]))
    assert verdict.outcome is SafetyOutcome.REJECTED
    assert "marshal" in verdict.reason


def test_a_command_avoiding_an_emergency_exit_is_rejected(safety):
    """Routing people away from an exit is the one thing that must never be an
    optimisation, however much congestion it would relieve."""
    verdict = safety.review(command(avoid=["exit"]))
    assert verdict.outcome is SafetyOutcome.REJECTED
    assert verdict.violated_constraints == ["emergency_exit_blocked"]
    assert "exit" in verdict.reason


def test_an_excessive_diversion_is_rejected(safety):
    """Past half the crowd, the diversion is the bottleneck."""
    assert safety.review(command(target_fraction=0.5)).may_dispatch
    verdict = safety.review(command(target_fraction=0.51))
    assert verdict.outcome is SafetyOutcome.REJECTED
    assert verdict.violated_constraints == ["excessive_diversion"]
    assert "51%" in verdict.reason


def test_a_command_naming_an_unknown_zone_is_rejected(safety):
    """A typo'd zone would otherwise be broadcast to every phone in the venue."""
    verdict = safety.review(command(prefer=["carpark_z"]))
    assert verdict.outcome is SafetyOutcome.REJECTED
    assert verdict.violated_constraints == ["unknown_zone"]
    assert "carpark_z" in verdict.reason


def test_every_violation_is_reported_not_just_the_first(safety):
    """The operator should see the whole objection, not fix one and resubmit."""
    verdict = safety.review(
        command(prefer=["marshal"], avoid=["exit"], target_fraction=0.9)
    )
    assert set(verdict.violated_constraints) == {
        "never_route_through", "emergency_exit_blocked", "excessive_diversion"
    }
    assert verdict.reason.count(";") == 2


# --------------------------------------------------------- emergency mode ----

def test_emergency_mode_disables_optimisation_entirely(safety):
    """During an evacuation there is no such thing as a congestion trade-off."""
    approved = safety.review(command())
    assert approved.may_dispatch
    assert not approved.emergency_mode

    safety.emergency_mode = True
    verdict = safety.review(command())
    assert verdict.outcome is SafetyOutcome.REJECTED
    assert "emergency_mode" in verdict.violated_constraints
    assert verdict.emergency_mode
    assert "evacuation" in verdict.reason


# ------------------------------------------------------------- egress --------

def test_a_command_that_would_strand_an_exit_is_rejected():
    """Checked against the live graph, because availability changes what is
    reachable: an approval given during practice can be wrong during a race."""
    pack = make_pack(
        [zone("stand", 0, 0), zone("bridge", 50, 0), zone("exit", 100, 0)],
        [edge("e_sb", "stand", "bridge", 50.0), edge("e_be", "bridge", "exit", 50.0)],
    )
    pack = pack.model_copy(
        update={
            "constraints": pack.constraints.model_copy(
                update={"emergency_exits": ["exit"]}
            )
        }
    )
    graph = VenueGraph(pack, "race")
    safety = SafetyEngine(pack)
    cmd = command(source_zone="stand", destination_zone="exit", avoid=["bridge"],
                  prefer=["bridge"])

    assert safety.review(cmd, None, graph).may_dispatch  # exit still reachable

    severed = pack.model_copy(update={"edges": {"e_sb": pack.edges["e_sb"]}})
    cut_graph = VenueGraph(severed, "race")
    verdict = SafetyEngine(severed).review(cmd, None, cut_graph)
    assert verdict.outcome is SafetyOutcome.REJECTED
    assert "egress_unreachable" in verdict.violated_constraints
    assert "exit" in verdict.reason


def test_the_gate_builds_a_graph_instead_of_skipping_route_checks(safety):
    """Omitting a graph must not silently omit route-dependent constraints."""
    assert safety.review(command(prefer=["marshal"]), None, None).outcome is (
        SafetyOutcome.REJECTED
    )
    approved = safety.review(command(), None, None)
    assert approved.may_dispatch
    assert "egress unchecked" not in approved.reason


# ------------------------------------------ the route, not the command text --

def _corridor(forbidden: list[str], detour: bool = False):
    """gate-1 -> marshal-post -> gate-2, optionally with a legal way round."""
    from crowdflow_contracts import (CircuitPack, CoordinateFrame, Edge, Position,
                                     Provenance, SafetyConstraints, Sourced, Zone, ZoneKind)
    w = Sourced(value=5.0, provenance=Provenance.OSM)
    edges = {
        "e1": Edge(id="e1", source="gate-1", destination="marshal-post",
                   length_m=100.0, width_m=w),
        "e2": Edge(id="e2", source="marshal-post", destination="gate-2",
                   length_m=100.0, width_m=w),
    }
    zones = ["gate-1", "marshal-post", "gate-2"]
    if detour:
        edges["d1"] = Edge(id="d1", source="gate-1", destination="detour",
                           length_m=400.0, width_m=w)
        edges["d2"] = Edge(id="d2", source="detour", destination="gate-2",
                           length_m=400.0, width_m=w)
        zones.append("detour")
    return CircuitPack(
        id="t", name="T", geometry_source="x", track_length_m=1.0, altitude_m=0.0,
        frame=CoordinateFrame(origin_lat=0.0, origin_lon=0.0, track_bounds_m=(1.0, 1.0),
                              venue_bounds_m=(0.0, 0.0, 1.0, 1.0)),
        zones={z: Zone(id=z, kind=ZoneKind.CONCOURSE,
                       position=Position(x=i * 100.0, y=0.0))
               for i, z in enumerate(zones)},
        edges=edges,
        constraints=SafetyConstraints(never_route_through=forbidden),
    )


def _clean_command():
    """A command that NAMES nothing forbidden. That was the whole problem."""
    from crowdflow_contracts import RerouteCommand
    return RerouteCommand(
        command_id="c1", issued_at=0.0, expires_at=300.0,
        source_zone="gate-1", destination_zone="gate-2",
        avoid=[], prefer=[], target_fraction=0.3,
        reason="test", expected_cost_s=0.0,
    )


def test_a_forbidden_zone_is_unroutable_not_merely_expensive():
    """`avoid` is a cost multiplier, which is correct for a preference and wrong
    for a prohibition: a multiplier still returns a path when it is the only one,
    and a path is what the caller acts on."""
    from crowdflow_core.routing import VenueGraph

    graph = VenueGraph(_corridor(["marshal-post"]))
    assert graph.forbidden_zones == {"marshal-post"}
    assert not graph.route("gate-1", "gate-2").found, (
        "if the only way runs through a marshal post, there is no way"
    )
    assert graph.route("gate-1", "gate-2").rejected_reason


def test_a_legal_detour_is_still_found():
    """The exclusion must remove the forbidden zone, not the destination."""
    from crowdflow_core.routing import VenueGraph

    result = VenueGraph(_corridor(["marshal-post"], detour=True)).route("gate-1", "gate-2")
    assert result.found
    assert result.path == ["gate-1", "detour", "gate-2"]


def test_safety_rejects_a_command_whose_ROUTE_is_forbidden():
    """THE BYPASS. The gate was always invoked and always checked the wrong thing:
    `forbidden.intersection(command.prefer)` inspects the zone NAMES an operator
    reads, never the path the crowd walks. A command naming nothing forbidden was
    approved while its only route ran through a live-circuit working position."""
    from crowdflow_core.routing import VenueGraph

    pack = _corridor(["marshal-post"])
    command = _clean_command()
    assert not set(command.prefer) & set(pack.constraints.never_route_through), (
        "the command names nothing forbidden — that is the point"
    )

    verdict = SafetyEngine(pack).review(command, None, VenueGraph(pack))
    assert not verdict.may_dispatch
    assert verdict.violated_constraints
    assert "marshal-post" in verdict.reason or "hard constraints" in verdict.reason


def test_the_same_command_is_approved_when_a_legal_route_exists():
    """Guards against the fix degenerating into 'reject everything'."""
    from crowdflow_core.routing import VenueGraph

    pack = _corridor(["marshal-post"], detour=True)
    verdict = SafetyEngine(pack).review(_clean_command(), None, VenueGraph(pack))
    assert verdict.may_dispatch, verdict.reason


def test_a_command_naming_a_forbidden_zone_is_still_caught():
    """The cheap name check stays — it catches a command that says the quiet part."""
    from crowdflow_contracts import RerouteCommand
    from crowdflow_core.routing import VenueGraph

    pack = _corridor(["marshal-post"], detour=True)
    command = RerouteCommand(
        command_id="c2", issued_at=0.0, expires_at=300.0,
        source_zone="gate-1", destination_zone="gate-2",
        avoid=[], prefer=["marshal-post"], target_fraction=0.3,
        reason="test", expected_cost_s=0.0,
    )
    verdict = SafetyEngine(pack).review(command, None, VenueGraph(pack))
    assert not verdict.may_dispatch
    assert "never_route_through" in verdict.violated_constraints
