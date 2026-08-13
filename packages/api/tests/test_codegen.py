"""The committed TypeScript must match the Pydantic models.

Generated-and-committed only works if something checks. Without this, the
dashboard compiles happily against a type that stopped describing the payload
three commits ago — and TypeScript will confidently tell you the field is there.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "generate.py"
GENERATED = ROOT / "ts" / "index.ts"


def _generator():
    spec = importlib.util.spec_from_file_location("_api_gen", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_generated_typescript_is_current():
    if not GENERATED.exists():
        pytest.fail(f"{GENERATED} missing — run: uv run python {SCRIPT}")
    assert GENERATED.read_text() == _generator().render(), (
        "packages/api/ts/index.ts is stale. Regenerate:\n"
        "  uv run python packages/api/scripts/generate.py"
    )


def test_contract_types_are_imported_not_redeclared():
    """One definition of a ZoneState. Two would eventually disagree."""
    text = GENERATED.read_text()
    assert 'from "../../contracts/ts/index"' in text
    for contract_type in ("ZoneState", "VenueState", "Forecast", "InterventionCandidate"):
        assert f"export interface {contract_type} " not in text


def test_contracts_typescript_exposes_the_density_field():
    """The dashboard classifies on nothing, but it must be able to *show* the
    number the classification was made from. A generated file without
    `density_persons_m2` is the stale one that made this test necessary."""
    contracts_ts = ROOT.parents[0] / "contracts" / "ts" / "index.ts"
    text = contracts_ts.read_text()
    assert "density_persons_m2" in text
    assert "over_capacity" in text
    assert "band_for_density" in text, "the band comment must not still cite the flow classifier"
