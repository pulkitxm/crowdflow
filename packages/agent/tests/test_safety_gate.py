"""The test that matters most.

The agent recommends; it never acts. Everything else in this package is a
convenience, and this file is the load-bearing claim: there is no path from an
agent tool call to a dispatched reroute that skips SafetyEngine.review().

Three kinds of proof, because one is not enough:

  * **Behavioural** — an agent that proposes routing through a forbidden zone is
    rejected, with the constraint named, and nothing becomes dispatchable.
  * **Structural** — an AST walk over the package proving RerouteCommand is
    built in exactly one module, in a function that also calls review(). A
    future contributor cannot add a second path without failing this.
  * **Negative** — the package holds nothing that could dispatch: no transport
    import, no mesh, no send.

The behavioural test alone would pass a package that grew a second, unreviewed
path tomorrow. That is why the other two exist.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from conftest import build_context, build_pack, build_state, call, says, scripted
from crowdflow_agent import CrowdOpsAgent, Toolbox
from crowdflow_contracts import SafetyOutcome

AGENT_SRC = Path(__file__).resolve().parents[1] / "src" / "crowdflow_agent"


# ------------------------------------------------------------- behavioural --

def test_a_proposal_routing_through_a_forbidden_zone_is_rejected_with_a_reason():
    """The headline case.

    marshal-post is in never_route_through: it is a working position for people
    whose job is to be beside a live circuit, and a crowd sent through it is a
    safety incident. The agent proposes it anyway; the gate refuses, names the
    constraint, and nothing becomes dispatchable.
    """
    context = build_context()
    toolbox = Toolbox(context)
    client = scripted(
        call(
            "create_reroute",
            {
                "source_zone": "gate-1",
                "destination_zone": "gate-2",
                "avoid": ["concourse"],
                "prefer": ["marshal-post"],
                "target_fraction": 0.3,
                "reason": "Vale is filling; send people the back way",
            },
        ),
        says("I proposed a reroute via the marshal post; it was rejected."),
    )
    run = CrowdOpsAgent(client, toolbox).ask("Vale is building. What can we do?")

    assert len(run.proposals) == 1
    proposal = run.proposals[0]
    assert proposal.verdict.outcome is SafetyOutcome.REJECTED
    assert "never_route_through" in proposal.verdict.violated_constraints
    assert "marshal-post" in proposal.verdict.reason
    assert proposal.verdict.reason, "a rejection without a stated reason is not a rejection"

    # Nothing is dispatchable, from any angle.
    assert run.approved_proposals == []
    assert toolbox.dispatchable() == []
    assert not proposal.approved

    # And the model was told, in the tool result, that nothing was sent.
    result = run.turns[0].results[0].content
    assert result["outcome"] == "rejected"
    assert result["dispatched"] is False
    assert "never_route_through" in result["violated_constraints"]


def test_avoiding_an_emergency_exit_is_rejected():
    """The second hard constraint, checked separately: an agent may not route
    people away from egress, however sensible its congestion argument."""
    toolbox = Toolbox(build_context())
    result = toolbox.invoke(
        "create_reroute",
        {
            "source_zone": "gate-1",
            "destination_zone": "gate-2",
            "avoid": ["exit-a"],
            "prefer": [],
            "target_fraction": 0.2,
            "reason": "keep the exit clear for vehicles",
        },
    )
    assert result["outcome"] == "rejected"
    assert "emergency_exit_blocked" in result["violated_constraints"]
    assert toolbox.dispatchable() == []


def test_an_excessive_diversion_is_rejected():
    """Diverting most of a crowd manufactures the bottleneck it is avoiding.
    The agent cannot talk its way past that either."""
    toolbox = Toolbox(build_context())
    result = toolbox.invoke(
        "create_reroute",
        {
            "source_zone": "gate-1",
            "destination_zone": "gate-2",
            "avoid": [],
            "prefer": ["gate-2"],
            "target_fraction": 0.9,
            "reason": "move everyone",
        },
    )
    assert result["outcome"] == "rejected"
    assert "excessive_diversion" in result["violated_constraints"]


def test_a_legal_proposal_is_approved_and_still_not_dispatched():
    """Approval is permission for an operator, not an action.

    The distinction is the whole design: `dispatchable()` returns proposals, not
    receipts, and nothing in this package can turn one into the other.
    """
    toolbox = Toolbox(build_context())
    result = toolbox.invoke(
        "create_reroute",
        {
            "source_zone": "gate-1",
            "destination_zone": "gate-2",
            "avoid": [],
            "prefer": ["gate-2"],
            "target_fraction": 0.25,
            "reason": "Gate 2 has headroom",
        },
    )
    assert result["outcome"] == "approved"
    assert result["dispatched"] is False
    assert len(toolbox.dispatchable()) == 1
    assert not hasattr(toolbox.dispatchable()[0], "dispatch")


def test_rejections_are_kept_even_when_later_proposals_pass():
    """A record of what the agent wanted is the only audit of an agent that was
    stopped. The ledger keeps rejections; only the verdict decides eligibility."""
    toolbox = Toolbox(build_context())
    toolbox.invoke("create_reroute", {
        "source_zone": "gate-1", "destination_zone": "gate-2",
        "avoid": [], "prefer": ["marshal-post"], "target_fraction": 0.3,
        "reason": "first idea",
    })
    toolbox.invoke("create_reroute", {
        "source_zone": "gate-1", "destination_zone": "gate-2",
        "avoid": [], "prefer": ["gate-2"], "target_fraction": 0.3,
        "reason": "second idea",
    })
    assert len(toolbox.proposals) == 2
    assert len(toolbox.dispatchable()) == 1
    assert toolbox.dispatchable()[0].command.reason == "second idea"


def test_repeating_a_rejected_proposal_is_rejected_again():
    """There is no wording that gets a hard constraint past. Constraints are not
    weighed against benefit and there is no override flag, so persistence buys
    the agent nothing."""
    toolbox = Toolbox(build_context())
    args = {
        "source_zone": "gate-1", "destination_zone": "gate-2",
        "avoid": [], "prefer": ["marshal-post"], "target_fraction": 0.3,
        "reason": "this time it is urgent, lives are at stake",
    }
    for _ in range(3):
        assert toolbox.invoke("create_reroute", args)["outcome"] == "rejected"
    assert toolbox.dispatchable() == []


def test_the_agent_cannot_invent_a_zone_to_route_through():
    """Zone ids come from the pack. A model naming one that does not exist gets
    an error it can recover from, not a command over a fabricated graph."""
    toolbox = Toolbox(build_context())
    result = toolbox.invoke("create_reroute", {
        "source_zone": "gate-1", "destination_zone": "back-paddock",
        "avoid": [], "prefer": [], "target_fraction": 0.2, "reason": "shortcut",
    })
    assert "error" in result
    assert toolbox.proposals == [], "an invalid reroute must not reach the ledger"


def test_a_pack_with_no_constraints_still_reviews_every_proposal():
    """The gate is not conditional on there being something to catch. A pack
    with an empty constraint list still produces a verdict on every command."""
    pack = build_pack(forbidden=(), exits=())
    toolbox = Toolbox(build_context(pack, state=build_state(pack)))
    toolbox.invoke("create_reroute", {
        "source_zone": "gate-1", "destination_zone": "gate-2",
        "avoid": [], "prefer": ["marshal-post"], "target_fraction": 0.3,
        "reason": "nothing forbids this here",
    })
    assert len(toolbox.proposals) == 1
    assert toolbox.proposals[0].verdict.reason


# --------------------------------------------------------------- structural --

def _modules() -> list[Path]:
    return sorted(AGENT_SRC.rglob("*.py"))


def _call_name(call: ast.Call) -> str | None:
    """Constructor name for direct and module-qualified calls."""
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def _construction_sites(tree: ast.AST, class_name: str) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and _call_name(node) == class_name
    ]


def _functions_constructing(tree: ast.AST, class_name: str) -> list[ast.AST]:
    """Every function body containing a constructor, rejecting module scope."""
    parents: dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent

    out: list[ast.AST] = []
    for call in _construction_sites(tree, class_name):
        owner = parents.get(call)
        while owner is not None and not isinstance(
            owner, (ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            owner = parents.get(owner)
        if owner is None:
            raise AssertionError(
                f"{class_name} constructed at module scope on line {call.lineno}"
            )
        if owner not in out:
            out.append(owner)
    return out


def test_reroute_commands_are_built_in_exactly_one_module():
    """A second construction site is a second path to the mesh.

    This is the test that stops the invariant from decaying: adding a
    RerouteCommand anywhere else in this package fails the build and says why.
    """
    sites = []
    for path in _modules():
        tree = ast.parse(path.read_text(), filename=str(path))
        if _construction_sites(tree, "RerouteCommand"):
            # Also proves every construction has a function owner.
            _functions_constructing(tree, "RerouteCommand")
            sites.append(path.name)
    assert sites == ["proposals.py"], (
        "RerouteCommand must only be constructed in proposals.py, where it is "
        f"reviewed. Found construction in: {sites}"
    )


def test_every_function_that_builds_a_command_also_calls_review():
    """Construction and review live in the same function, so no refactor can
    leave a command built but unreviewed."""
    offenders: list[str] = []
    for path in _modules():
        tree = ast.parse(path.read_text(), filename=str(path))
        for func in _functions_constructing(tree, "RerouteCommand"):
            reviews = any(
                isinstance(n, ast.Call)
                and isinstance(n.func, ast.Attribute)
                and n.func.attr == "review"
                for n in ast.walk(func)
            )
            if not reviews:
                offenders.append(f"{path.name}:{func.name}")
    assert not offenders, (
        "these functions build a RerouteCommand without calling safety.review(): "
        f"{offenders}"
    )


def test_a_proposal_cannot_exist_without_a_verdict():
    """The type makes an unreviewed command unrepresentable — the cheapest
    enforcement available, and the one nobody can forget to apply."""
    from crowdflow_agent import Proposal

    with pytest.raises(TypeError):
        Proposal()  # type: ignore[call-arg]


FORBIDDEN_TRANSPORTS = {
    "socket": "the agent must not open sockets; it cannot reach the mesh",
    "socketio": "the agent must not open sockets",
    "websockets": "the agent must not open sockets",
    "requests": "the agent's only outbound call is its model client",
    "httpx": "the agent's only outbound call is its model client",
    "urllib": "the agent's only outbound call is its model client",
    "paho": "the agent must not speak to a broker",
}


@pytest.mark.parametrize("path", _modules(), ids=lambda p: p.stem)
def test_the_agent_has_no_way_to_reach_the_mesh(path: Path):
    """Negative proof: even a malicious tool could not send anything, because
    there is nothing in this package to send it with."""
    tree = ast.parse(path.read_text(), filename=str(path))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split(".")[0])
    violations = [
        f"{path.name} imports {r!r}: {FORBIDDEN_TRANSPORTS[r]}"
        for r in roots
        if r in FORBIDDEN_TRANSPORTS
    ]
    assert not violations, "\n".join(violations)


@pytest.mark.parametrize("path", _modules(), ids=lambda p: p.stem)
def test_nothing_in_the_agent_is_named_like_a_dispatcher(path: Path):
    """Names are documentation. If a `dispatch` appears here, either the
    invariant moved or somebody is about to break it."""
    tree = ast.parse(path.read_text(), filename=str(path))
    banned = {"dispatch", "broadcast", "send_command", "publish", "emit"}
    found = [
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name in banned
    ]
    assert not found, f"{path.name} defines {found}; the agent does not act"
