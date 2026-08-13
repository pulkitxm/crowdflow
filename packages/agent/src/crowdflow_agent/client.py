"""The model client boundary.

The agent knows one thing about a language model: it can be handed a system
prompt, a transcript and a list of tool schemas, and it answers with either text
or tool calls. That is the whole contract, and it exists so the reasoning loop
can be exercised exhaustively without a network, an API key or a bill.

Two implementations ship:

  FakeModelClient    a scripted client, for tests
  AnthropicClient    the real adapter, importing its SDK lazily

The fake is not a stub — it records every request it was given, which is how the
tests assert what the model was *shown*. "The model never sees raw points" is
otherwise an unfalsifiable claim in a docstring.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

DEFAULT_MODEL = "claude-opus-5"
"""Which model the Anthropic adapter uses when the caller does not say."""

DEFAULT_MAX_TOKENS = 16000
"""Non-streaming ceiling. Large enough that a tool-calling turn is never cut off
mid-argument, small enough to stay well inside the SDK's request timeout."""


@dataclass(frozen=True)
class ToolCall:
    """A model's request to run one tool. `arguments` is untrusted."""

    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolResult:
    """What a tool returned. Errors travel as results, not exceptions.

    A raised exception ends the loop and the model never learns why. A result
    carrying `error` lets it correct itself — which is the difference between an
    agent that recovers from a typo'd zone id and one that dies on it.
    """

    call_id: str
    name: str
    content: dict[str, Any]

    @property
    def is_error(self) -> bool:
        return "error" in self.content


@dataclass(frozen=True)
class Message:
    """One turn of the transcript, including provider continuity blocks."""

    role: str
    """user | assistant | tool"""

    text: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()
    tool_results: tuple[ToolResult, ...] = ()
    thinking_blocks: tuple[dict[str, Any], ...] = ()
    """Opaque signed thinking blocks returned by Anthropic.

    Adaptive thinking requires these blocks to be sent back unchanged on the
    next turn. The agent never reads them; preserving them is transcript
    continuity, not exposing reasoning to application logic.
    """


@dataclass(frozen=True)
class ModelResponse:
    """What a client returns: prose, tool calls, or both."""

    text: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()
    thinking_blocks: tuple[dict[str, Any], ...] = ()

    @property
    def wants_tools(self) -> bool:
        return bool(self.tool_calls)


@dataclass(frozen=True)
class ModelRequest:
    """A recorded request. Only the fake keeps these."""

    system: str
    messages: tuple[Message, ...]
    tools: tuple[dict[str, Any], ...]

    def rendered(self) -> str:
        """Everything the model would have seen, as one string.

        Exists for tests: the cheapest way to assert that a raw time series
        never reached the prompt is to look for it in here.
        """
        parts = [self.system]
        for m in self.messages:
            parts.append(m.text or "")
            parts.extend(json.dumps(c.arguments, sort_keys=True) for c in m.tool_calls)
            parts.extend(json.dumps(r.content, sort_keys=True, default=str)
                         for r in m.tool_results)
        parts.extend(json.dumps(t, sort_keys=True) for t in self.tools)
        return "\n".join(parts)


@runtime_checkable
class ModelClient(Protocol):
    """Anything that can take a turn."""

    def complete(
        self,
        *,
        system: str,
        messages: list[Message],
        tools: list[dict[str, Any]],
    ) -> ModelResponse: ...


class ScriptExhausted(RuntimeError):
    """The fake ran out of scripted turns. Always a test bug, never a model one."""


class FakeModelClient:
    """A model that says exactly what the test told it to say.

    Deterministic by construction, which is invariant 6 applied to the agent: an
    agent run must be reproducible, and a run whose model is a coin flip is not.
    """

    def __init__(self, script: list[ModelResponse]) -> None:
        self.script = list(script)
        self.requests: list[ModelRequest] = []
        self._index = 0

    @property
    def calls(self) -> int:
        return self._index

    def complete(
        self,
        *,
        system: str,
        messages: list[Message],
        tools: list[dict[str, Any]],
    ) -> ModelResponse:
        self.requests.append(
            ModelRequest(system=system, messages=tuple(messages), tools=tuple(tools))
        )
        if self._index >= len(self.script):
            raise ScriptExhausted(
                f"fake client asked for turn {self._index + 1}, script has {len(self.script)}"
            )
        response = self.script[self._index]
        self._index += 1
        return response

    @property
    def tools_offered(self) -> set[str]:
        """Tool names the client was actually shown. Used to assert the surface."""
        return {t["name"] for r in self.requests for t in r.tools}


class AnthropicClient:
    """The real adapter. Untested by the suite, and deliberately so.

    Everything above this line runs without a network; this class is the single
    place that does not, which is why it holds no logic beyond translation. If a
    behaviour can be got wrong here, it is a translation bug and it is visible in
    twenty lines.

    The SDK import is inside __init__ so that neither the package nor the test
    suite requires it to be installed.
    """

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        client: Any | None = None,
    ) -> None:
        if client is None:
            import anthropic  # lazy on purpose; see the class docstring

            client = anthropic.Anthropic()
        self._client = client
        self.model = model
        self.max_tokens = max_tokens

    @staticmethod
    def _to_api(messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for m in messages:
            if m.role == "tool":
                out.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": r.call_id,
                            "content": json.dumps(r.content, default=str),
                            "is_error": r.is_error,
                        }
                        for r in m.tool_results
                    ],
                })
                continue
            blocks: list[dict[str, Any]] = [dict(block) for block in m.thinking_blocks]
            if m.text:
                blocks.append({"type": "text", "text": m.text})
            blocks.extend(
                {"type": "tool_use", "id": c.id, "name": c.name, "input": c.arguments}
                for c in m.tool_calls
            )
            out.append({"role": m.role, "content": blocks})
        return out

    def complete(
        self,
        *,
        system: str,
        messages: list[Message],
        tools: list[dict[str, Any]],
    ) -> ModelResponse:
        response = self._client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            thinking={"type": "adaptive"},
            system=system,
            tools=[
                {
                    "name": t["name"],
                    "description": t["description"],
                    "input_schema": t["input_schema"],
                }
                for t in tools
            ],
            messages=self._to_api(messages),
        )
        text = "\n".join(b.text for b in response.content if b.type == "text") or None
        calls = tuple(
            ToolCall(id=b.id, name=b.name, arguments=dict(b.input))
            for b in response.content
            if b.type == "tool_use"
        )
        thinking = tuple(
            b.model_dump() if hasattr(b, "model_dump") else dict(b)
            for b in response.content
            if b.type in ("thinking", "redacted_thinking")
        )
        return ModelResponse(
            text=text,
            tool_calls=calls,
            thinking_blocks=thinking,
        )
