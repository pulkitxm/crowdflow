"""Export the API's wire models to TypeScript.

Same rule as the contracts package: Python is the source of truth, TypeScript is
generated and committed, and drift shows up as a diff in review rather than as a
console quietly rendering a field the server stopped sending.

Two differences from `packages/contracts/scripts/generate.py`, which this script
reuses rather than reimplements:

  * Contract types are **imported, not re-emitted.** `TickEnvelope` embeds a
    `VenueState`; emitting a second copy of that interface here would give the
    dashboard two definitions of a zone, and one of them would eventually be
    wrong. The generated file opens with an import from the contracts package.
  * Only the API's own envelopes are declared, in the order `wire.EXPORTED`
    gives, because the emitter does not sort.

Run:  uv run python packages/api/scripts/generate.py
"""

from __future__ import annotations

import importlib.util
import json
import sys
from enum import Enum
from pathlib import Path

import crowdflow_contracts as contracts
from crowdflow_api import wire
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
CONTRACTS_GENERATOR = REPO / "packages" / "contracts" / "scripts" / "generate.py"
OUT = ROOT / "ts" / "index.ts"

BANNER = (
    "// GENERATED FROM packages/api/src/crowdflow_api/wire.py — DO NOT EDIT.\n"
    "// Regenerate: uv run python packages/api/scripts/generate.py\n"
)


def _load_emitter():
    """Borrow the contracts emitter so both packages map types identically."""
    spec = importlib.util.spec_from_file_location("_contracts_gen", CONTRACTS_GENERATOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def contract_type_names() -> set[str]:
    """Every type the contracts package already exports to TypeScript."""
    names = set()
    for name in contracts.__all__:
        obj = getattr(contracts, name)
        if isinstance(obj, type) and issubclass(obj, (BaseModel, Enum)):
            names.add(name)
    return names


def render() -> str:
    """The generated file's contents. Separate from writing it so a test can
    assert the committed copy is current without touching the tree."""
    emitter = _load_emitter()
    from_contracts = contract_type_names()

    emitted: set[str] = set()
    used_contract_types: set[str] = set()
    blocks: list[str] = []

    for model in wire.EXPORTED:
        if issubclass(model, Enum) and not issubclass(model, BaseModel):
            # A bare enum has no schema of its own until something references it;
            # emit it directly from its members.
            if model.__name__ not in emitted:
                emitted.add(model.__name__)
                members = " | ".join(json.dumps(m.value) for m in model)
                blocks.append(f"export type {model.__name__} = {members};\n")
            continue

        schema = model.model_json_schema(
            mode="serialization", ref_template="#/$defs/{model}"
        )
        defs = schema.pop("$defs", {})
        for name, definition in defs.items():
            if name in from_contracts:
                used_contract_types.add(name)
                continue
            if name in emitted:
                continue
            emitted.add(name)
            blocks.append(emitter._emit_one(name, definition, defs))
        if model.__name__ not in emitted:
            emitted.add(model.__name__)
            blocks.append(emitter._emit_one(model.__name__, schema, defs))

    header = BANNER
    if used_contract_types:
        names = ", ".join(sorted(used_contract_types))
        header += (
            "\n// Contract types are imported, never restated: one definition of a\n"
            "// ZoneState exists and it is generated from the Pydantic model.\n"
            f'import type {{ {names} }} from "../../contracts/ts/index";\n'
            f"export type {{ {names} }};\n"
        )

    return header + "\n" + "\n".join(blocks)


def main() -> int:
    text = render()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"ts      {text.count('export ')} api types -> {OUT.relative_to(REPO)}",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
