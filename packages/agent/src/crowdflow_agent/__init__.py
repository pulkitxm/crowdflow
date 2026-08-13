"""The Crowd Ops Agent.

A separate package from crowdflow_core, and that is the point: core is pure and
may not import a model provider SDK (its purity test says so). The agent needs
one. Putting the agent here keeps the engines free of it and makes the boundary
between "computes" and "explains" a package boundary rather than a convention.

    insights    statistics first — anomaly detection, then optional narration
    tools       the tool layer; every number comes from an engine
    proposals   the only place a RerouteCommand is built, and its safety gate
    agent       the bounded, recorded reasoning loop
    client      the model boundary, with a fake that needs no network

The invariant the whole package is arranged around: **the agent recommends, it
never acts.** Anything it proposes re-enters the pipeline at SafetyEngine.review
exactly like any other command, and this package contains no way to dispatch
one. See proposals.py, and the test that walks this package's AST to prove no
second path was ever added.
"""

from .agent import MAX_TURNS, AgentRun, AgentTurn, CrowdOpsAgent
from .client import (
    AnthropicClient,
    FakeModelClient,
    Message,
    ModelClient,
    ModelRequest,
    ModelResponse,
    ScriptExhausted,
    ToolCall,
    ToolResult,
)
from .insights import Insight, InsightEngine, InsightKind, modified_z, narrate
from .prompts import SYSTEM_PROMPT
from .proposals import Proposal, ProposalLedger
from .tools import OpsContext, Toolbox, ToolSpec

__all__ = [
    "MAX_TURNS", "AgentRun", "AgentTurn", "CrowdOpsAgent",
    "AnthropicClient", "FakeModelClient", "Message", "ModelClient", "ModelRequest",
    "ModelResponse", "ScriptExhausted", "ToolCall", "ToolResult",
    "Insight", "InsightEngine", "InsightKind", "modified_z", "narrate",
    "SYSTEM_PROMPT",
    "Proposal", "ProposalLedger",
    "OpsContext", "Toolbox", "ToolSpec",
]

__version__ = "0.1.0"
