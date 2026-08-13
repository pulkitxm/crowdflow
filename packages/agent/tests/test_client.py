"""Provider translation tests with no SDK, key or network."""

from __future__ import annotations

from types import SimpleNamespace

from crowdflow_agent.client import AnthropicClient, Message, ToolCall


def test_anthropic_round_trips_signed_thinking_blocks():
    thinking = {
        "type": "thinking",
        "thinking": "opaque provider state",
        "signature": "signed-block",
    }
    rendered = AnthropicClient._to_api(
        [
            Message(
                role="assistant",
                text="I will inspect the zone.",
                thinking_blocks=(thinking,),
                tool_calls=(ToolCall(id="call-1", name="get_zone_state"),),
            )
        ]
    )
    assert rendered[0]["content"][0] == thinking
    assert rendered[0]["content"][1]["type"] == "text"
    assert rendered[0]["content"][2]["type"] == "tool_use"


def test_anthropic_response_preserves_thinking_for_the_next_turn():
    class Block:
        type = "thinking"

        def model_dump(self):
            return {
                "type": "thinking",
                "thinking": "opaque provider state",
                "signature": "signed-block",
            }

    response = SimpleNamespace(
        content=[
            Block(),
            SimpleNamespace(type="text", text="Checking."),
            SimpleNamespace(
                type="tool_use", id="call-1", name="get_zone_state", input={"zone_id": "gate"}
            ),
        ]
    )

    class Messages:
        def create(self, **_kwargs):
            return response

    client = AnthropicClient(client=SimpleNamespace(messages=Messages()))
    result = client.complete(system="system", messages=[Message(role="user", text="why?")], tools=[])

    assert result.text == "Checking."
    assert result.tool_calls[0].name == "get_zone_state"
    assert result.thinking_blocks[0]["signature"] == "signed-block"
