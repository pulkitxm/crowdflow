"""The reasoning loop.

Small on purpose. The loop is: ask the model, run whatever tools it asked for,
give it the results, repeat until it stops asking. Everything interesting lives
either in the tool layer (what may be touched) or the safety engine (what may be
done); a loop that grew clever would be a loop hiding one of those.

Three properties it must have:

  * **Bounded.** A model that keeps calling tools forever must stop. The run
    reports that it was truncated rather than pretending it finished.
  * **Recorded.** Every turn, every tool call and every result is kept. An
    agent's answer is only as trustworthy as the trail behind it.
  * **Reproducible.** Given the same client and the same context, the same run.
    With the fake client that is exact, which is what makes the safety test a
    test rather than an observation.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .client import Message, ModelClient, ToolCall, ToolResult
from .prompts import SYSTEM_PROMPT
from .proposals import Proposal
from .tools import Toolbox

MAX_TURNS = 8
"""Model turns before the loop gives up.

ASSUMED, with reasoning: a real question here is answered by reading two or
three tools and then speaking, so eight leaves room for a wrong turn and a
correction without letting a looping model spin. The bound exists because a
model calling tools in a cycle costs money and time silently; the run says it
was truncated so the caller can tell a considered answer from a cut-off one.
"""


@dataclass
class AgentTurn:
    """One exchange: what the model said, what it called, what came back."""

    text: str | None
    calls: tuple[ToolCall, ...] = ()
    results: tuple[ToolResult, ...] = ()


@dataclass
class AgentRun:
    """Everything one question produced."""

    question: str
    answer: str | None = None
    turns: list[AgentTurn] = field(default_factory=list)
    proposals: list[Proposal] = field(default_factory=list)
    truncated: bool = False

    @property
    def tool_calls(self) -> list[ToolCall]:
        return [c for t in self.turns for c in t.calls]

    @property
    def tools_used(self) -> list[str]:
        return [c.name for c in self.tool_calls]

    @property
    def approved_proposals(self) -> list[Proposal]:
        """Proposals the safety engine approved. Still nothing dispatched."""
        return [p for p in self.proposals if p.approved]

    @property
    def rejected_proposals(self) -> list[Proposal]:
        return [p for p in self.proposals if not p.approved]


class CrowdOpsAgent:
    """A tool-calling agent over the CrowdFlow engines.

    Deliberately not part of the control loop. `crowdflow_core.loop` runs the
    product; this observes it and explains it, and anything it proposes re-enters
    at the safety engine exactly like a command the loop generated itself.
    """

    def __init__(
        self,
        client: ModelClient,
        toolbox: Toolbox,
        *,
        system_prompt: str = SYSTEM_PROMPT,
        max_turns: int = MAX_TURNS,
    ) -> None:
        self.client = client
        self.toolbox = toolbox
        self.system_prompt = system_prompt
        self.max_turns = max_turns

    def ask(self, question: str) -> AgentRun:
        run = AgentRun(question=question)
        messages: list[Message] = [Message(role="user", text=question)]

        for _ in range(self.max_turns):
            response = self.client.complete(
                system=self.system_prompt,
                messages=messages,
                tools=self.toolbox.schemas(),
            )

            if not response.wants_tools:
                run.turns.append(AgentTurn(text=response.text))
                run.answer = response.text
                run.proposals = self.toolbox.proposals
                return run

            results = tuple(
                ToolResult(
                    call_id=call.id,
                    name=call.name,
                    content=self.toolbox.invoke(call.name, call.arguments),
                )
                for call in response.tool_calls
            )
            run.turns.append(
                AgentTurn(text=response.text, calls=response.tool_calls, results=results)
            )
            messages.append(
                Message(
                    role="assistant", text=response.text, tool_calls=response.tool_calls
                )
            )
            messages.append(Message(role="tool", tool_results=results))

        run.truncated = True
        run.answer = (
            f"Stopped after {self.max_turns} turns without a final answer. "
            "The tool calls made are in the transcript; nothing was dispatched."
        )
        run.proposals = self.toolbox.proposals
        return run
