"""The live spectator adapter sends conclusions and keeps unknown honest."""

from __future__ import annotations

from crowdflow_api.session import ScenarioSession
from crowdflow_api.spectator import build_spectator_view
from crowdflow_api.wire import (
    CoverageReport,
    MetricsSnapshot,
    NodeMark,
    PopulationSnapshot,
    TickEnvelope,
)
from crowdflow_contracts import (
    Confidence,
    RerouteCommand,
    SafetyOutcome,
    SafetyVerdict,
    VenueState,
    ZoneState,
)
from crowdflow_core.simulation.scenario import Cohort, Scenario


def session_for(circuit, option) -> ScenarioSession:
    scenario = Scenario(
        name="toy",
        description="toy walk",
        cohorts=[Cohort(count=20, origin="stand", destination="park")],
        duration_s=60.0,
        seed=7,
    )
    return ScenarioSession(
        circuit,
        scenario,
        option,
        population=20,
        participation=1.0,
        tick_s=2.0,
        intervene=False,
    )


def state(zone_id: str, density: float) -> ZoneState:
    return ZoneState(
        zone_id=zone_id,
        timestamp=2.0,
        observed_nodes=20,
        participation_rate=1.0,
        density_persons_m2=density,
        flow_ped_m_min=20.0,
        mean_speed_ms=1.0,
        inflow_per_min=0.0,
        outflow_per_min=0.0,
        confidence=Confidence(
            value=0.8,
            observed_nodes=20,
            freshness_s=0.0,
            mean_accuracy_m=5.0,
            stability=1.0,
        ),
    )


def envelope(circuit_id: str, *, zones=None, command=None, verdict=None, dispatched=False):
    zones = zones or {}
    return TickEnvelope(
        tick=1,
        time_s=2.0,
        compute_ms=1.0,
        state=VenueState(
            circuit_id=circuit_id,
            timestamp=2.0,
            zones=zones,
            unobserved_zones=[],
        ),
        command=command,
        verdict=verdict,
        dispatched=dispatched,
        coverage=CoverageReport(
            zones_total=4,
            observed=len(zones),
            unknown=4 - len(zones),
            silent=0,
            low_confidence=0,
            fraction_observed=len(zones) / 4,
        ),
        population=PopulationSnapshot(
            total=20,
            waiting=0,
            active=20,
            arrived=0,
            observed_nodes=20,
            estimated_present=20,
        ),
        metrics=MetricsSnapshot(
            peak_density=0.0,
            critical_zone_seconds=0.0,
            building_zone_seconds=0.0,
            peak_critical_zones=0,
            total_queue_peak=0.0,
            arrived=0,
            mean_walk_s=0.0,
            p95_walk_s=0.0,
            interventions=0,
            rejected_by_safety=0,
            samples=1,
        ),
        nodes=[NodeMark(x=0.0, y=0.0, speed_ms=1.0, accuracy_m=5.0)],
    )


def test_unknown_route_legs_are_not_rendered_clear(toy_circuit, toy_option):
    session = session_for(toy_circuit, toy_option)
    session.last_envelope = envelope(toy_circuit.pack.id)

    view = build_spectator_view(session, origin="stand", destination="park").root

    assert view.kind == "walk"
    assert view.route.steps
    assert {step.way_ahead.value for step in view.route.steps} == {"unknown"}


def test_route_uses_the_state_engines_served_band(toy_circuit, toy_option):
    session = session_for(toy_circuit, toy_option)
    session.last_envelope = envelope(
        toy_circuit.pack.id,
        zones={"pinch": state("pinch", 3.0)},
    )

    view = build_spectator_view(session, origin="stand", destination="park").root

    assert any(step.way_ahead.value == "critical" for step in view.route.steps)


def test_offline_is_a_transport_fact_not_a_calm_fallback(toy_circuit, toy_option):
    session = session_for(toy_circuit, toy_option)
    session.last_envelope = envelope(toy_circuit.pack.id)

    view = build_spectator_view(
        session,
        origin="stand",
        destination="park",
        online=False,
        mesh_peers=3,
    ).root

    assert view.kind == "offline"
    assert view.link.mesh_peers == 3
    assert all(step.way_ahead.value == "unknown" for step in view.route.steps)


def test_only_the_exact_dispatched_command_becomes_an_offer(toy_circuit, toy_option):
    session = session_for(toy_circuit, toy_option)
    command = RerouteCommand(
        command_id="cmd-1",
        issued_at=0.0,
        expires_at=60.0,
        source_zone="pinch",
        destination_zone="park",
        avoid=["pinch"],
        prefer=["quiet"],
        target_fraction=0.3,
        reason="The quieter way keeps moving.",
        expected_cost_s=20.0,
    )
    approved = SafetyVerdict(
        command_id=command.command_id,
        outcome=SafetyOutcome.APPROVED,
        reason="reviewed",
    )

    session.last_envelope = envelope(
        toy_circuit.pack.id,
        command=command,
        verdict=approved,
        dispatched=False,
    )
    held = build_spectator_view(session, origin="stand", destination="park").root
    assert held.kind == "walk"

    session.last_envelope = envelope(
        toy_circuit.pack.id,
        command=command,
        verdict=approved,
        dispatched=True,
    )
    offered = build_spectator_view(session, origin="stand", destination="park").root
    assert offered.kind == "ahead"
    assert offered.offer.command.command_id == approved.command_id
    assert offered.offer.verdict.dispatchable is True
