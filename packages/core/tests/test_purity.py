"""The no-I/O rule, enforced rather than asserted.

D2 makes crowdflow_core a pure library so that the CLI and the API can be equal
adapters over it. That only holds if nothing in core reaches for the network, a
socket, a database or a model provider. This test walks the AST of every module
in the package and fails on the first violation, naming it.

It is deliberately a test rather than a lint rule: it must fail the build, and it
must be obvious why.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

CORE = Path(__file__).resolve().parents[1] / "src" / "crowdflow_core"

FORBIDDEN = {
    # web / transport
    "fastapi": "core must not know about HTTP; that is packages/api",
    "starlette": "core must not know about HTTP; that is packages/api",
    "uvicorn": "core must not serve; that is packages/api",
    "flask": "core must not know about HTTP",
    "socket": "core must not open sockets",
    "socketio": "core must not open sockets",
    "websockets": "core must not open sockets",
    "requests": "core must not make network calls; pass data in",
    "httpx": "core must not make network calls; pass data in",
    "urllib": "core must not make network calls; pass data in",
    # persistence
    "sqlite3": "core must not persist; adapters own storage",
    "psycopg": "core must not persist; adapters own storage",
    "sqlalchemy": "core must not persist; adapters own storage",
    "redis": "core must not persist; adapters own storage",
    # model providers — the LLM never computes a route, density or prediction
    "anthropic": "the LLM never computes a route, a density or a prediction",
    "openai": "the LLM never computes a route, a density or a prediction",
    "langchain": "the LLM never computes a route, a density or a prediction",
    # direction of dependency
    "crowdflow_agent": (
        "the agent depends on core, never the reverse — core is why the agent's "
        "numbers are trustworthy, and a cycle would put a model client inside it"
    ),
}


def _modules() -> list[Path]:
    return sorted(CORE.rglob("*.py"))


def _imported_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                roots.add(node.module.split(".")[0])
    return roots


def test_core_has_modules():
    assert _modules(), "core package is empty — did the layout change?"


@pytest.mark.parametrize("path", _modules(), ids=lambda p: p.stem)
def test_module_is_pure(path: Path):
    violations = [
        f"{path.relative_to(CORE)} imports {root!r}: {FORBIDDEN[root]}"
        for root in _imported_roots(path)
        if root in FORBIDDEN
    ]
    assert not violations, "\n".join(violations)


def test_core_does_not_read_or_write_files():
    """Loading is an adapter's job. Core receives parsed objects."""
    offenders: list[str] = []
    for path in _modules():
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                if node.func.id == "open":
                    offenders.append(f"{path.relative_to(CORE)}:{node.lineno} calls open()")
    assert not offenders, "\n".join(offenders)
