"""Reasoning-loop tests.

Every one of these runs with a scripted client: no API key, no network, no
provider SDK installed. That is not just convenient — a suite that could reach a
model is a suite whose green run proves less than it looks.
"""

from __future__ import annotations

import pytest
from conftest import build_context, call, says, scripted
from crowdflow_agent import (
    MAX_TURNS,
    CrowdOpsAgent,
    ModelResponse,
    ScriptExhausted,
    ToolCall,
    Toolbox,
)


def agent(client, toolbox=None) -> tuple[CrowdOpsAgent, Toolbox]:
    toolbox = toolbox or Toolbox(build_context())
    return CrowdOpsAgent(client, toolbox), toolbox


def test_a_question_answered_without_tools_ends_in_one_turn():
    a, _ = agent(scripted(says("Nothing is building; the venue is nominal.")))
    run = a.ask("How are we doing?")
    assert run.answer.startswith("Nothing is building")
    assert run.tools_used == []
    assert not run.truncated


def test_the_loop_feeds_tool_results_back_and_continues():
    client = scripted(
        call("get_venue_state", {"limit": 3}, "c1"),
        call("get_predictions", {"limit": 2}, "c2"),
        says("Vale reaches capacity in under three minutes."),
    )
    a, _ = agent(client)
    run = a.ask("What is about to go wrong?")

    assert run.tools_used == ["get_venue_state", "get_predictions"]
    assert run.answer.startswith("Vale reaches")
    # The second request must contain the first tool's result, or the model is
    # answering from nothing.
    second = client.requests[1]
    assert any(m.tool_results for m in second.messages)
    assert "band_counts" in second.rendered()


def test_several_tool_calls_in_one_turn_are_all_executed():
    client = scripted(
        ModelResponse(tool_calls=(
            ToolCall(id="a", name="get_venue_state", arguments={}),
            ToolCall(id="b", name="get_event_schedule", arguments={}),
        )),
        says("done"),
    )
    a, _ = agent(client)
    run = a.ask("Brief me.")
    assert run.tools_used == ["get_venue_state", "get_event_schedule"]
    assert len(run.turns[0].results) == 2
    assert [r.call_id for r in run.turns[0].results] == ["a", "b"]


def test_a_bad_tool_call_does_not_end_the_run():
    """The recovery path. A model that mistypes a zone id must be able to try
    again; an exception here would end the run with nothing to show."""
    client = scripted(
        call("get_zone_state", {"zone_id": "paddock-club"}, "c1"),
        call("get_zone_state", {"zone_id": "gate-1"}, "c2"),
        says("Gate 1 is nominal."),
    )
    a, _ = agent(client)
    run = a.ask("How is the paddock club?")

    assert run.turns[0].results[0].is_error
    assert run.answer == "Gate 1 is nominal."
    assert not run.truncated


def test_a_looping_model_is_stopped_and_the_run_says_so():
    """A model calling tools forever costs money and time silently. The bound
    exists, and the run reports being cut off rather than presenting a partial
    answer as a considered one."""
    client = scripted(*[call("get_venue_state", {}, f"c{i}") for i in range(MAX_TURNS)])
    a, _ = agent(client)
    run = a.ask("Keep looking.")

    assert run.truncated
    assert client.calls == MAX_TURNS
    assert "nothing was dispatched" in run.answer
    assert len(run.tool_calls) == MAX_TURNS


def test_the_transcript_records_every_call_and_result():
    client = scripted(call("get_venue_state", {}, "c1"), says("ok"))
    a, _ = agent(client)
    run = a.ask("state?")
    assert [t.calls for t in run.turns] == [run.turns[0].calls, ()]
    assert run.turns[0].results[0].name == "get_venue_state"
    assert run.turns[0].results[0].content["circuit_id"] == "test-circuit"


def test_the_model_is_shown_the_whole_tool_surface_and_the_boundaries():
    client = scripted(says("noted"))
    a, toolbox = agent(client)
    a.ask("hello")

    assert client.tools_offered == set(toolbox.names)
    system = client.requests[0].system
    assert "recommend" in system and "never act" in system
    assert "DENSITY, not flow" in system
    assert "UNKNOWN, not empty" in system


def test_proposals_are_attached_to_the_run_whatever_the_verdict():
    client = scripted(
        call("create_reroute", {
            "source_zone": "gate-1", "destination_zone": "gate-2",
            "avoid": [], "prefer": ["marshal-post"], "target_fraction": 0.3,
            "reason": "back way",
        }, "c1"),
        says("Rejected — the marshal post is off limits."),
    )
    a, _ = agent(client)
    run = a.ask("Can we send them round the back?")
    assert len(run.proposals) == 1
    assert run.approved_proposals == []
    assert len(run.rejected_proposals) == 1


def test_the_same_script_gives_the_same_run():
    """Invariant 6 reaches the agent too: a run nobody can reproduce cannot be
    reviewed after the fact."""
    def once() -> list[str]:
        client = scripted(call("get_venue_state", {"limit": 2}, "c1"), says("fine"))
        a, _ = agent(client)
        run = a.ask("state?")
        return [str(t.results) for t in run.turns]

    assert once() == once()


def test_a_short_script_fails_loudly_rather_than_silently_stopping():
    """A fixture bug should look like a fixture bug."""
    a, _ = agent(scripted(call("get_venue_state", {}, "c1")))
    with pytest.raises(ScriptExhausted):
        a.ask("state?")
