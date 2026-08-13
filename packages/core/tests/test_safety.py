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
    verdict = safety.review(command(prefer=["north"]))

    assert verdict.outcome is SafetyOutcome.REJECTED
    assert not verdict.may_dispatch
    assert verdict.violated_constraints == ["never_route_through"]
    assert "north" in verdict.reason
    assert "forbidden" in verdict.reason
    assert verdict.command_id == "cmd-test"


def test_the_forbidden_check_is_not_fooled_by_extra_zones(safety):
    verdict = safety.review(command(prefer=["south", "north"]))
    assert verdict.outcome is SafetyOutcome.REJECTED
    assert "north" in verdict.reason


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
        command(prefer=["north"], avoid=["exit"], target_fraction=0.9)
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


def test_the_gate_works_without_a_graph_or_a_state(safety):
    """Both are optional arguments; the hard constraints do not depend on them,
    and a gate that fails open when a caller omits one would be worthless."""
    assert safety.review(command(prefer=["north"]), None, None).outcome is (
        SafetyOutcome.REJECTED
    )
