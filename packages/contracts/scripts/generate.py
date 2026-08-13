"""Export Pydantic models to JSON Schema and deterministic TypeScript.

Python is the source of truth; generated artefacts are committed.  Generation is
intentionally self-contained: the old implementation silently selected a
completely different emitter when ``npx`` happened to be on ``PATH``, which made
the same command rewrite the repository differently on two machines.

Run:  uv run python packages/contracts/scripts/generate.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import crowdflow_contracts as contracts
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "schema"
TS_DIR = ROOT / "ts"

BANNER = (
    "// GENERATED FROM packages/contracts — DO NOT EDIT.\n"
    "// Regenerate: uv run python packages/contracts/scripts/generate.py\n"
)


def exported_models() -> dict[str, type[BaseModel]]:
    """Every exported Pydantic model, in the package's stable export order."""
    out: dict[str, type[BaseModel]] = {}
    for name in contracts.__all__:
        obj = getattr(contracts, name)
        if isinstance(obj, type) and issubclass(obj, BaseModel):
            out[name] = obj
    return out


def schema_documents(models: dict[str, type[BaseModel]]) -> dict[str, dict[str, Any]]:
    """All schema documents as data, so tests can compare without writing files."""
    documents = {
        f"{name}.json": model.model_json_schema(mode="serialization")
        for name, model in models.items()
    }
    documents["crowdflow.json"] = {
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
    return documents


def schema_text(document: dict[str, Any]) -> str:
    return json.dumps(document, indent=2) + "\n"


def typescript_text(models: dict[str, type[BaseModel]]) -> str:
    return BANNER + "\n" + _emit_ts(models)


def write_schemas(models: dict[str, type[BaseModel]]) -> Path:
    SCHEMA_DIR.mkdir(parents=True, exist_ok=True)
    documents = schema_documents(models)

    # Removing obsolete generated schemas is part of generation. Otherwise a
    # renamed contract leaves a plausible-looking stale file behind forever.
    expected = set(documents)
    for path in SCHEMA_DIR.glob("*.json"):
        if path.name not in expected:
            path.unlink()
    for name, document in documents.items():
        (SCHEMA_DIR / name).write_text(schema_text(document))
    return SCHEMA_DIR / "crowdflow.json"


def write_typescript(models: dict[str, type[BaseModel]]) -> Path:
    TS_DIR.mkdir(parents=True, exist_ok=True)
    out = TS_DIR / "index.ts"
    out.write_text(typescript_text(models))
    return out


_PRIMITIVES = {
    "string": "string",
    "integer": "number",
    "number": "number",
    "boolean": "boolean",
}


def _union(parts: list[str]) -> str:
    unique = list(dict.fromkeys(parts))
    return " | ".join(unique) if unique else "unknown"


def _ts_type(schema: dict[str, Any], defs: dict[str, Any]) -> str:
    if "$ref" in schema:
        return schema["$ref"].rsplit("/", 1)[-1]
    if "const" in schema:
        return json.dumps(schema["const"])
    if "enum" in schema:
        return _union([json.dumps(value) for value in schema["enum"]])
    if "anyOf" in schema:
        return _union([_ts_type(part, defs) for part in schema["anyOf"]])
    if "oneOf" in schema:
        return _union([_ts_type(part, defs) for part in schema["oneOf"]])
    if "allOf" in schema:
        return " & ".join(_ts_type(part, defs) for part in schema["allOf"])

    kind = schema.get("type")
    if kind == "array":
        item = _ts_type(schema.get("items", {}), defs)
        if " | " in item or " & " in item:
            item = f"({item})"
        return f"{item}[]"
    if kind == "object" or "properties" in schema:
        properties = schema.get("properties") or {}
        if properties:
            required = set(schema.get("required", []))
            fields = [
                f"{json.dumps(name)}{'?' if name not in required else ''}: "
                f"{_ts_type(spec, defs)}"
                for name, spec in properties.items()
            ]
            return "{ " + "; ".join(fields) + " }"
        extra = schema.get("additionalProperties")
        if isinstance(extra, dict):
            return f"Record<string, {_ts_type(extra, defs)}>"
        return "Record<string, unknown>"
    if kind == "null":
        return "null"
    return _PRIMITIVES.get(kind, "unknown")


def _doc(description: str, indent: str = "") -> list[str]:
    """A complete JSDoc block; load-bearing second lines must not be truncated."""
    safe = description.replace("*/", "*\\/").strip()
    if not safe:
        return []
    lines = [f"{indent}/**"]
    lines.extend(f"{indent} * {line}" if line else f"{indent} *" for line in safe.splitlines())
    lines.append(f"{indent} */")
    return lines


def _emit_one(name: str, schema: dict[str, Any], defs: dict[str, Any]) -> str:
    description = schema.get("description", "")

    # RootModel unions and ordinary aliases have no object properties. Preserve
    # the union instead of emitting an empty interface.
    if any(key in schema for key in ("enum", "const", "oneOf", "anyOf")) and not schema.get(
        "properties"
    ):
        return "\n".join([*_doc(description), f"export type {name} = {_ts_type(schema, defs)};", ""])

    lines = _doc(description)
    lines.append(f"export interface {name} {{")
    required = set(schema.get("required", []))
    for prop, spec in (schema.get("properties") or {}).items():
        lines.extend(_doc(spec.get("description", ""), "  "))
        optional = "" if prop in required else "?"
        # JSON quoting handles aliases such as Route's `from` and any future key
        # that is not a legal TypeScript identifier.
        rendered_name = prop if prop.isidentifier() else json.dumps(prop)
        lines.append(f"  {rendered_name}{optional}: {_ts_type(spec, defs)};")
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def _emit_ts(models: dict[str, type[BaseModel]]) -> str:
    chunks: list[str] = []
    emitted: set[str] = set()

    for name, model in models.items():
        schema = model.model_json_schema(
            mode="serialization", ref_template="#/$defs/{model}"
        )
        defs = schema.pop("$defs", {})
        for definition_name, definition in defs.items():
            if definition_name not in emitted:
                emitted.add(definition_name)
                chunks.append(_emit_one(definition_name, definition, defs))
        if name not in emitted:
            emitted.add(name)
            chunks.append(_emit_one(name, schema, defs))

    return "\n".join(chunks)


def main() -> int:
    models = exported_models()
    bundle = write_schemas(models)
    output = write_typescript(models)
    print(f"schema  {len(models)} models -> {bundle.relative_to(ROOT.parents[1])}")
    print(f"ts      deterministic built-in emitter -> {output.relative_to(ROOT.parents[1])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
