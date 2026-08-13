"""Contract tests.

These exist to protect four things the project will otherwise lose:

  1. The LOS boundaries stay Fruin's, not ours.
  2. Simulator telemetry and phone telemetry stay indistinguishable.
  3. Population is derived from measured participation, never a constant.
  4. A malformed circuit pack fails at load, not as a NaN in the router.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from pydantic import ValidationError

import crowdflow_contracts as c


# --------------------------------------------------------------------------
# Standards — the numbers must stay the published ones
# --------------------------------------------------------------------------

def test_los_boundaries_are_fruins():
    assert (c.LOS_A_MAX, c.LOS_B_MAX, c.LOS_C_MAX, c.LOS_D_MAX, c.LOS_E_MAX) == (
        23.0, 33.0, 49.0, 66.0, 82.0
    )


def test_operational_bands_sit_on_los_boundaries():
    """The three bands must collapse LOS on its own boundaries, not on invented ones."""
    assert c.BAND_NOMINAL_MAX == c.LOS_C_MAX
    assert c.BAND_BUILDING_MAX == c.LOS_E_MAX


@pytest.mark.parametrize(
    "flow,band",
    [
        (0.0, c.LOSBand.NOMINAL),
        (48.9, c.LOSBand.NOMINAL),
        (49.0, c.LOSBand.BUILDING),   # boundary belongs to the higher band
        (81.9, c.LOSBand.BUILDING),
        (82.0, c.LOSBand.CRITICAL),
        (500.0, c.LOSBand.CRITICAL),
    ],
)
def test_band_classification(flow, band):
    assert c.band_for_flow(flow) is band


def test_building_band_is_the_intervention_window():
    """Below it nothing to do; above it too late. The product lives in between."""
    assert c.band_for_flow(c.BAND_NOMINAL_MAX - 0.1) is c.LOSBand.NOMINAL
    assert c.band_for_flow(c.BAND_NOMINAL_MAX) is c.LOSBand.BUILDING
    assert c.band_for_flow(c.BAND_BUILDING_MAX) is c.LOSBand.CRITICAL


@pytest.mark.parametrize("flow,grade", [(10, "A"), (30, "B"), (40, "C"), (60, "D"), (70, "E"), (90, "F")])
def test_fruin_grades(flow, grade):
    assert c.los_grade_for_flow(flow) == grade


# --------------------------------------------------------------------------
# The invariant: the core cannot tell simulator from phone
# --------------------------------------------------------------------------

def _simulator_node() -> dict:
    return {
        "node_id": "sim-8f3a", "epoch": 412, "timestamp": 1786633200.0,
        "position": {"x": 431.2, "y": 817.5},
        "speed_ms": 1.24, "heading_deg": 72.0, "accuracy_m": 4.5,
    }


def _phone_node() -> dict:
    return {
        "node_id": "a91c", "epoch": 412, "timestamp": 1786633200.4,
        "position": {"x": 428.9, "y": 812.1},
        "speed_ms": 1.31, "heading_deg": 74.5, "accuracy_m": 9.2,
        "zone_id": None,
    }


def test_simulator_and_phone_payloads_are_indistinguishable():
    """If this ever fails, the core has two input paths and one is untested."""
    sim = c.CrowdNode.model_validate(_simulator_node())
    phone = c.CrowdNode.model_validate(_phone_node())
    assert type(sim) is type(phone)
    assert set(sim.model_dump()) == set(phone.model_dump())


def test_crowdnode_rejects_impossible_values():
    with pytest.raises(ValidationError):
        c.CrowdNode.model_validate({**_phone_node(), "heading_deg": 360})
    with pytest.raises(ValidationError):
        c.CrowdNode.model_validate({**_phone_node(), "speed_ms": -1})
    with pytest.raises(ValidationError):
        c.CrowdNode.model_validate({**_phone_node(), "accuracy_m": 0})


def test_trace_fragment_must_record_the_privacy_actually_applied():
    """A fragment without its epsilon is unauditable — refuse it."""
    base = {
        "fragment_id": "f-01",
        "points": [{"x": 0, "y": 0}, {"x": 10, "y": 4}],
        "t_start": 0.0, "t_end": 12.0,
    }
    with pytest.raises(ValidationError):
        c.TraceFragment.model_validate(base)

    frag = c.TraceFragment.model_validate({**base, "epsilon": 0.4, "noise_radius_m": 25.0})
    assert frag.duration_s == 12.0


def test_trace_fragment_needs_at_least_two_points():
    with pytest.raises(ValidationError):
        c.TraceFragment.model_validate({
            "fragment_id": "f", "points": [{"x": 0, "y": 0}],
            "t_start": 0, "t_end": 1, "epsilon": 0.4, "noise_radius_m": 25,
        })


def test_crowdnode_and_tracefragment_share_no_linking_field():
    """Conflating them would leak the trace through the state path."""
    node = set(c.CrowdNode.model_fields)
    frag = set(c.TraceFragment.model_fields)
    assert not (node & frag), f"linkable fields: {node & frag}"


# --------------------------------------------------------------------------
# Mesh
# --------------------------------------------------------------------------

def _msg(ttl: int = 4) -> c.MeshMessage:
    return c.MeshMessage(
        type=c.MeshMessageType.STATE_UPDATE, traffic_class=c.MeshClass.STATE,
        source="8f3a", sequence=183, ttl=ttl, timestamp=1786633200.0,
        payload={"zone": "C17", "flow": 61.2},
    )


def test_ttl_decrements_and_stops_at_zero():
    m = _msg(ttl=2)
    assert not m.expired
    m = m.hop()
    assert m.ttl == 1
    m = m.hop().hop()
    assert m.ttl == 0 and m.expired


def test_hop_does_not_mutate_the_original():
    original = _msg(ttl=4)
    original.hop()
    assert original.ttl == 4


def test_traffic_class_is_explicit():
    """Routing protocol is chosen per class; an unclassified message has no policy."""
    with pytest.raises(ValidationError):
        c.MeshMessage.model_validate({
            "type": "state_update", "source": "x", "sequence": 1,
            "ttl": 4, "timestamp": 0.0,
        })


# --------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------

def _conf(nodes: int = 120, value: float = 0.9) -> c.Confidence:
    return c.Confidence(
        value=value, observed_nodes=nodes, freshness_s=0.8,
        mean_accuracy_m=6.0, stability=0.9,
    )


def _zone(zone_id: str, density: float, nodes: int = 120,
          participation: float = 0.18) -> c.ZoneState:
    """Build a zone from a DENSITY — that is what the band is classified on."""
    speed = c.FREE_FLOW_SPEED_MS * max(0.0, 1 - density / c.JAM_DENSITY_PERSONS_M2)
    return c.ZoneState(
        zone_id=zone_id, timestamp=1786633200.0,
        observed_nodes=nodes, participation_rate=participation,
        density_persons_m2=density, flow_ped_m_min=density * speed * 60,
        mean_speed_ms=round(speed, 3),
        inflow_per_min=91, outflow_per_min=42, confidence=_conf(nodes),
    )


def test_population_scales_by_measured_participation():
    assert _zone("z", 1.0, nodes=120, participation=0.20).estimated_population == 600


def test_participation_rate_cannot_be_zero_or_above_one():
    for bad in (0.0, 1.5, -0.2):
        with pytest.raises(ValidationError):
            _zone("z", 1.0, participation=bad)


def test_net_flow_is_the_early_warning():
    assert _zone("z", 1.0).net_flow_per_min == pytest.approx(49.0)


def test_band_derives_from_density_not_flow():
    """The bug this guards: flow is non-monotonic, so a jammed zone and an empty
    one show similar flow. Only density separates them."""
    jammed = _zone("club", 3.5)      # past capacity: flow is LOW but state is critical
    empty = _zone("quiet", 0.2)
    assert jammed.band is c.LOSBand.CRITICAL
    assert jammed.over_capacity
    assert empty.band is c.LOSBand.NOMINAL
    # ... and their flow rates are genuinely similar, which is the whole point
    assert abs(jammed.flow_ped_m_min - empty.flow_ped_m_min) < 25


def test_capacity_density_is_the_critical_boundary():
    assert c.DENSITY_BUILDING_MAX == c.CAPACITY_DENSITY
    assert _zone("z", c.CAPACITY_DENSITY - 0.01).band is c.LOSBand.BUILDING
    assert _zone("z", c.CAPACITY_DENSITY).band is c.LOSBand.CRITICAL


def test_fruin_82_is_unreachable_under_this_fundamental_diagram():
    """Why CRITICAL is defined at capacity density rather than at 82 ped/m/min."""
    assert c.density_for_flow(c.LOS_E_MAX) is None
    assert c.density_for_flow(c.LOS_C_MAX) == pytest.approx(0.75, abs=0.01)


def test_low_confidence_is_not_reportable():
    sparse = c.Confidence(value=0.2, observed_nodes=2, freshness_s=40,
                          mean_accuracy_m=30, stability=0.3)
    assert not sparse.is_reportable
    assert _conf().is_reportable


def test_unobserved_zones_are_tracked_not_dropped():
    """Under D7 uplinks are opportunistic — a silent region is unknown, not empty."""
    v = c.VenueState(
        circuit_id="silverstone", timestamp=0.0,
        zones={"a": _zone("a", 0.3), "b": _zone("b", 3.5)},
        unobserved_zones=["c", "d"],
    )
    assert v.coverage == pytest.approx(0.5)
    assert [z.zone_id for z in v.in_band(c.LOSBand.CRITICAL)] == ["b"]
    assert v.total_observed_nodes == 240


# --------------------------------------------------------------------------
# Decisions and safety
# --------------------------------------------------------------------------

def test_forecast_is_actionable_only_when_it_can_be_acted_on():
    common = dict(zone_id="club", issued_at=0.0, horizon_s=300,
                  target_band=c.LOSBand.CRITICAL, projected_peak_density_persons_m2=118.0,
                  model_id="baseline-v1")
    assert c.Forecast(**common, probability=0.91, time_to_threshold_s=167, confidence=0.87).is_actionable
    # already happened
    assert not c.Forecast(**common, probability=0.91, time_to_threshold_s=None, confidence=0.87).is_actionable
    # too uncertain to act on
    assert not c.Forecast(**common, probability=0.3, time_to_threshold_s=167, confidence=0.87).is_actionable
    assert not c.Forecast(**common, probability=0.91, time_to_threshold_s=167, confidence=0.2).is_actionable


def test_reroute_command_expires():
    cmd = c.RerouteCommand(
        command_id="r17", issued_at=100.0, expires_at=400.0,
        source_zone="vale", destination_zone="gate_4", avoid=["crossing_club"],
        prefer=["wellington"], target_fraction=0.3,
        reason="Club Crossing is about to back up", expected_cost_s=90.0,
    )
    assert cmd.is_valid_at(200.0)
    assert not cmd.is_valid_at(400.0)
    assert cmd.expected_cost_s == 90.0  # cost is stated, never hidden


def test_rejected_command_cannot_dispatch():
    rejected = c.SafetyVerdict(
        command_id="r17", outcome=c.SafetyOutcome.REJECTED,
        reason="would route through marshal_post_7",
        violated_constraints=["never_route_through"],
    )
    assert not rejected.may_dispatch
    approved = c.SafetyVerdict(command_id="r17", outcome=c.SafetyOutcome.APPROVED, reason="clear")
    assert approved.may_dispatch


# --------------------------------------------------------------------------
# Venue
# --------------------------------------------------------------------------

def _pack(**overrides) -> c.CircuitPack:
    frame = c.CoordinateFrame(
        origin_lat=52.063513, origin_lon=-1.024286,
        track_bounds_m=(1028.0, 1705.0), venue_bounds_m=(-900.0, -700.0, 1900.0, 2400.0),
    )
    w = c.Sourced(value=8.0, provenance=c.Provenance.OSM)
    base = dict(
        id="silverstone", name="Silverstone Circuit", geometry_source="gb-1948",
        track_length_m=5891.0, altitude_m=196.0, frame=frame,
        zones={
            "gate_4": c.Zone(id="gate_4", kind=c.ZoneKind.GATE, position=c.Position(x=0, y=0)),
            "vale": c.Zone(id="vale", kind=c.ZoneKind.VIEWING, position=c.Position(x=100, y=50)),
        },
        edges={
            "e1": c.Edge(id="e1", source="gate_4", destination="vale",
                         length_m=360.0, width_m=w),
        },
    )
    base.update(overrides)
    return c.CircuitPack(**base)


def test_valid_pack_has_no_integrity_problems():
    assert _pack().validate_integrity() == []


def test_edge_to_unknown_zone_is_caught():
    w = c.Sourced(value=8.0, provenance=c.Provenance.OSM)
    pack = _pack(edges={
        "e1": c.Edge(id="e1", source="gate_4", destination="nowhere", length_m=10.0, width_m=w)
    })
    problems = pack.validate_integrity()
    assert any("unknown destination" in p for p in problems)
    assert any("orphaned" in p for p in problems)


def test_emergency_exit_must_be_a_real_zone():
    pack = _pack(constraints=c.SafetyConstraints(emergency_exits=["exit_e9"]))
    assert any("emergency exit" in p for p in pack.validate_integrity())


def test_edge_requires_width_because_flow_is_per_metre():
    """LOS is pedestrians per metre of width — an edge without width has no band."""
    with pytest.raises(ValidationError):
        c.Edge(id="e", source="a", destination="b", length_m=10.0)


def test_provenance_distinguishes_measured_from_assumed():
    assumed = c.Sourced(value=900, provenance=c.Provenance.ASSUMED)
    thin = c.Sourced(value=900, provenance=c.Provenance.MEASURED, samples=4)
    solid = c.Sourced(value=900, provenance=c.Provenance.MEASURED, samples=800)
    assert not assumed.is_trustworthy
    assert not thin.is_trustworthy
    assert solid.is_trustworthy


def test_at_grade_crossing_closes_while_cars_run():
    av = c.Availability(always_open=False, open_when=["between_sessions"],
                        closed_when=["session_live"], close_lead_s=600)
    assert av.is_open_during("between_sessions")
    assert not av.is_open_during("session_live")
    assert not av.is_open_during(None)
    assert c.Availability().is_open_during("session_live")  # bridges stay open


# --------------------------------------------------------------------------
# Generated artefacts
# --------------------------------------------------------------------------

def test_generated_schema_is_current():
    """Byte-compare every generated artefact against the Pydantic source.

    Checking that two definitions merely existed let arbitrarily large drift
    survive.  This test exercises the same pure render functions as codegen and
    also rejects obsolete schema files left behind by a rename.
    """
    root = Path(__file__).resolve().parents[1]
    script = root / "scripts" / "generate.py"
    spec = importlib.util.spec_from_file_location("crowdflow_contract_codegen", script)
    assert spec is not None and spec.loader is not None
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)

    models = generator.exported_models()
    expected_schemas = {
        name: generator.schema_text(document)
        for name, document in generator.schema_documents(models).items()
    }
    actual_names = {path.name for path in (root / "schema").glob("*.json")}
    assert actual_names == set(expected_schemas), (
        "generated schema file set drifted; run "
        "uv run python packages/contracts/scripts/generate.py"
    )
    for name, expected in expected_schemas.items():
        assert (root / "schema" / name).read_text() == expected, (
            f"{name} is stale; run packages/contracts/scripts/generate.py"
        )

    expected_ts = generator.typescript_text(models)
    assert (root / "ts" / "index.ts").read_text() == expected_ts, (
        "generated TypeScript is stale; run packages/contracts/scripts/generate.py"
    )
