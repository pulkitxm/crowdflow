"""Export Pydantic models to JSON Schema, then to TypeScript.

Python is the source of truth; TypeScript is generated and committed. That is the
whole payoff of the monorepo (D1): the app and backend cannot silently drift on a
schema, because drift shows up as a diff in review.

Run:  uv run python packages/contracts/scripts/generate.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from pydantic import BaseModel

import crowdflow_contracts as contracts

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "schema"
TS_DIR = ROOT / "ts"

BANNER = "// GENERATED FROM packages/contracts — DO NOT EDIT.\n// Regenerate: uv run python packages/contracts/scripts/generate.py\n"


def exported_models() -> dict[str, type[BaseModel]]:
    out: dict[str, type[BaseModel]] = {}
    for name in contracts.__all__:
        obj = getattr(contracts, name)
        if isinstance(obj, type) and issubclass(obj, BaseModel):
            out[name] = obj
    return out


def write_schemas(models: dict[str, type[BaseModel]]) -> Path:
    SCHEMA_DIR.mkdir(parents=True, exist_ok=True)
    for name, model in models.items():
        schema = model.model_json_schema(mode="serialization")
        (SCHEMA_DIR / f"{name}.json").write_text(json.dumps(schema, indent=2) + "\n")

    bundle = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "CrowdFlow contracts",
        "description": "Generated from packages/contracts. Do not edit.",
        "$defs": {
            name: model.model_json_schema(
                mode="serialization", ref_template="#/$defs/{model}"
            )
            for name, model in models.items()
        },
    }
    path = SCHEMA_DIR / "crowdflow.json"
    path.write_text(json.dumps(bundle, indent=2) + "\n")
    return path


def write_typescript(models: dict[str, type[BaseModel]]) -> bool:
    """Prefer json-schema-to-typescript; fall back to a minimal emitter offline."""
    TS_DIR.mkdir(parents=True, exist_ok=True)
    bundle = SCHEMA_DIR / "crowdflow.json"
    out = TS_DIR / "index.ts"

    try:
        result = subprocess.run(
            ["npx", "--yes", "json-schema-to-typescript@15", str(bundle),
             "--no-additionalProperties", "--bannerComment", ""],
            capture_output=True, text=True, timeout=180,
        )
        if result.returncode == 0 and result.stdout.strip():
            out.write_text(BANNER + "\n" + result.stdout)
            return True
        print(f"  json-schema-to-typescript unavailable ({result.returncode}); "
              f"using built-in emitter", file=sys.stderr)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        print(f"  npx unavailable ({exc.__class__.__name__}); using built-in emitter",
              file=sys.stderr)

    out.write_text(BANNER + "\n" + _emit_ts(models))
    return False


_PRIM = {"string": "string", "integer": "number", "number": "number", "boolean": "boolean"}


def _ts_type(prop: dict, defs: dict) -> str:
    if "$ref" in prop:
        return prop["$ref"].rsplit("/", 1)[-1]
    if "anyOf" in prop:
        return " | ".join(_ts_type(p, defs) for p in prop["anyOf"])
    if "enum" in prop:
        return " | ".join(json.dumps(v) for v in prop["enum"])
    t = prop.get("type")
    if t == "array":
        items = prop.get("items", {})
        return f"{_ts_type(items, defs)}[]" if items else "unknown[]"
    if t == "object":
        extra = prop.get("additionalProperties")
        if isinstance(extra, dict):
            return f"Record<string, {_ts_type(extra, defs)}>"
        return "Record<string, unknown>"
    if t == "null":
        return "null"
    return _PRIM.get(t, "unknown")


def _emit_ts(models: dict[str, type[BaseModel]]) -> str:
    lines: list[str] = []
    emitted: set[str] = set()

    for name, model in models.items():
        schema = model.model_json_schema(mode="serialization", ref_template="#/$defs/{model}")
        defs = schema.pop("$defs", {})
        for dname, dschema in defs.items():
            if dname not in emitted:
                emitted.add(dname)
                lines.append(_emit_one(dname, dschema, defs))
        if name not in emitted:
            emitted.add(name)
            lines.append(_emit_one(name, schema, defs))

    return "\n".join(lines)


def _emit_one(name: str, schema: dict, defs: dict) -> str:
    if "enum" in schema:
        members = " | ".join(json.dumps(v) for v in schema["enum"])
        return f"export type {name} = {members};\n"

    required = set(schema.get("required", []))
    body = []
    if desc := schema.get("description"):
        body.append(f"/** {desc.splitlines()[0]} */")
    body.append(f"export interface {name} {{")
    for prop, spec in (schema.get("properties") or {}).items():
        opt = "" if prop in required else "?"
        if pdesc := spec.get("description"):
            body.append(f"  /** {pdesc.splitlines()[0]} */")
        body.append(f"  {prop}{opt}: {_ts_type(spec, defs)};")
    body.append("}\n")
    return "\n".join(body)


def main() -> int:
    models = exported_models()
    bundle = write_schemas(models)
    print(f"schema  {len(models)} models -> {bundle.relative_to(ROOT.parents[1])}")
    used_npx = write_typescript(models)
    print(f"ts      {'json-schema-to-typescript' if used_npx else 'built-in emitter'} "
          f"-> {(TS_DIR / 'index.ts').relative_to(ROOT.parents[1])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
