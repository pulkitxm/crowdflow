"""Tool layer tests.

Two failure modes dominate here, and both are quiet ones. A tool that raises on
malformed model output kills the run instead of letting the agent correct
itself. And a tool that lets a number originate in the model rather than an
engine puts an unreproducible figure in front of an operator with the system's
authority behind it.
"""

from __future__ import annotations

from conftest import PARTICIPATION, build_context, build_pack, build_state, zone_state
from crowdflow_agent import OpsContext, Toolbox
from crowdflow_core.intervention import InterventionEngine
from crowdflow_core.simulation.model import SimConfig, Simulation

REQUIRED_TOOLS = {
    "get_venue_state",
    "get_zone_state",
    "get_predictions",
    "simulate_intervention",
    "find_alternative_route",
    "get_event_schedule",
    "create_reroute",
    "generate_insight",
}


def test_the_tool_surface_is_exactly_what_was_specified(toolbox: Toolbox):
    assert set(toolbox.names) == REQUIRED_TOOLS


def test_every_tool_publishes_a_schema_a_model_can_use(toolbox: Toolbox):
    for schema in toolbox.schemas():
        assert schema["name"] in REQUIRED_TOOLS
        assert schema["description"].strip()
        assert schema["input_schema"]["type"] == "object"


# ------------------------------------------------------ untrusted arguments --

def test_an_unknown_tool_returns_an_error_the_model_can_read(toolbox: Toolbox):
    result = toolbox.invoke("open_the_gates", {})
    assert "error" in result
    assert sorted(result["available"]) == sorted(REQUIRED_TOOLS)


def test_malformed_arguments_do_not_raise(toolbox: Toolbox):
    """A model will eventually emit a fraction of 4.0. That must be a result the
    agent can recover from, not an exception that ends the run."""
    result = toolbox.invoke("create_reroute", {
        "source_zone": "gate-1", "destination_zone": "gate-2",
        "avoid": [], "prefer": [], "target_fraction": 4.0, "reason": "everyone",
    })
    assert result["error"] == "invalid arguments"
    assert result["detail"]


def test_unexpected_arguments_are_refused_rather_than_ignored(toolbox: Toolbox):
    """Silently dropping an argument the model thought it was passing produces a
    correct-looking answer to a different question."""
    result = toolbox.invoke("get_zone_state", {"zone_id": "gate-1", "at_time": 900})
    assert result["error"] == "invalid arguments"


def test_an_unknown_zone_is_an_error_not_a_guess(toolbox: Toolbox):
    assert "error" in toolbox.invoke("get_zone_state", {"zone_id": "paddock-club"})
    assert "error" in toolbox.invoke(
        "find_alternative_route", {"origin": "gate-1", "destination": "nowhere"}
    )


# ------------------------------------------------------------- venue state --

def test_venue_state_reports_unobserved_zones_as_unknown(toolbox: Toolbox):
    """Invariant 5, at the tool boundary. If the agent is handed a state that
    silently omits unobserved zones, it will describe them as quiet."""
    result = toolbox.invoke("get_venue_state", {})
    assert result["unobserved_zones"] == 1
    assert "not empty" in result["unobserved_note"].lower()
    assert 0.0 < result["coverage"] < 1.0


def test_a_zone_nobody_is_reporting_from_says_so(toolbox: Toolbox):
    result = toolbox.invoke("get_zone_state", {"zone_id": "marshal-post"})
    assert result["observed"] is False
    assert "not known to be empty" in result["note"]
    assert "density_persons_m2" not in result


def test_zone_state_carries_its_confidence_and_whether_it_is_reportable():
    pack = build_pack()
    thin = zone_state("gate-1", nodes=2, confidence=0.1)
    context = build_context(pack, state=build_state(pack, overrides={"gate-1": thin}))
    result = Toolbox(context).invoke("get_zone_state", {"zone_id": "gate-1"})
    assert result["confidence"] == 0.1
    assert result["reportable"] is False


def test_venue_state_ranks_and_truncates_rather_than_dumping(toolbox: Toolbox):
    result = toolbox.invoke("get_venue_state", {"limit": 2})
    worst = result["worst_zones"]
    assert len(worst) == 2
    assert worst[0]["density_persons_m2"] >= worst[1]["density_persons_m2"]
    assert result["observed_zones"] > len(worst), "the full count must still be stated"


def test_bands_come_from_density_not_flow():
    """Invariant 3 at the tool boundary: a zone past capacity density must read
    CRITICAL even though its flow rate has collapsed back to a healthy-looking
    number. Classifying on flow would call this one nominal."""
    pack = build_pack()
    jammed = zone_state("concourse", density=3.6, speed=0.1)
    context = build_context(pack, state=build_state(pack, overrides={"concourse": jammed}))
    result = Toolbox(context).invoke("get_zone_state", {"zone_id": "concourse"})
    assert result["band"] == "critical"
    assert result["flow_ped_m_min"] < 49.0, "flow alone would have said nominal"


# ------------------------------------------------------------------ routing --

def test_routing_is_computed_by_the_engine(toolbox: Toolbox):
    result = toolbox.invoke(
        "find_alternative_route", {"origin": "gate-1", "destination": "exit-a"}
    )
    assert result["found"] is True
    assert result["path"] == ["gate-1", "concourse", "gate-2", "exit-a"]
    assert result["distance_m"] > 0
    assert result["walk_time_s"] > 0


def test_an_impossible_route_says_why_rather_than_inventing_one():
    pack = build_pack(island=True)
    result = Toolbox(build_context(pack, state=build_state(pack))).invoke(
        "find_alternative_route", {"origin": "gate-1", "destination": "campsite-a"}
    )
    assert result["found"] is False
    assert result["reason"]


def test_avoiding_a_zone_discourages_it_without_forbidding_it():
    """`avoid` is a heavy cost multiplier in the routing engine, not a wall — a
    graph with no path at all is worse than a bad path. The hard prohibition
    lives in the safety engine, which is a different question and a different
    module."""
    toolbox = Toolbox(build_context())
    direct = toolbox.invoke(
        "find_alternative_route", {"origin": "gate-1", "destination": "exit-a"}
    )
    avoided = toolbox.invoke(
        "find_alternative_route",
        {"origin": "gate-1", "destination": "exit-a", "avoid": ["concourse"]},
    )
    assert avoided["found"] is True
    assert avoided["path"] == direct["path"], "no alternative exists, so it says so"


def test_the_reroute_cost_is_measured_off_the_graph_not_supplied_by_the_model(
    toolbox: Toolbox,
):
    """The model has no way to state a walking-time cost: the tool's schema has
    no field for one. A language model quoting an added walking time is a
    language model computing a route."""
    schema = next(s for s in toolbox.schemas() if s["name"] == "create_reroute")
    properties = schema["input_schema"]["properties"]
    assert "expected_cost_s" not in properties
    assert not any("cost" in name for name in properties)

    result = toolbox.invoke("create_reroute", {
        "source_zone": "gate-1", "destination_zone": "gate-2",
        "avoid": [], "prefer": ["gate-2"], "target_fraction": 0.2,
        "reason": "Gate 2 has headroom",
    })
    assert isinstance(result["expected_cost_s"], float)
    assert result["expected_cost_s"] == toolbox.proposals[0].command.expected_cost_s


def test_a_reroute_that_cannot_be_costed_is_not_proposed():
    """No computable baseline means no honest cost, and a reroute whose cost is
    unknown is not one to put in front of an operator."""
    pack = build_pack(island=True)
    toolbox = Toolbox(build_context(pack, state=build_state(pack)))
    result = toolbox.invoke("create_reroute", {
        "source_zone": "gate-1", "destination_zone": "campsite-a",
        "avoid": [], "prefer": [], "target_fraction": 0.2,
        "reason": "send them to the campsite",
    })
    assert "error" in result
    assert toolbox.proposals == [], "an uncostable reroute never reaches the ledger"


# ------------------------------------------------------------ what-if, etc. --

def test_simulate_intervention_without_a_simulation_says_so(toolbox: Toolbox):
    result = toolbox.invoke(
        "simulate_intervention", {"from_zone": "concourse", "to_zone": "gate-2"}
    )
    assert "error" in result
    assert "unavailable" in result["error"]


def test_simulate_intervention_returns_the_seeded_sweep_including_doing_nothing():
    pack = build_pack()
    context = build_context(pack)
    sim = Simulation(context.graph, SimConfig(seed=7, tick_s=2.0))
    sim.add_agents(60, "gate-1", "exit-a", spread_s=30.0)
    sim.run(20.0)
    context.simulation = sim
    context.intervention = InterventionEngine(horizon_s=20.0)

    result = Toolbox(context).invoke(
        "simulate_intervention", {"from_zone": "concourse", "to_zone": "gate-2"}
    )
    assert result["seeded"] is True
    fractions = [c["divert_fraction"] for c in result["candidates"]]
    assert 0.0 in fractions, "the do-nothing baseline must always be evaluated"
    for candidate in result["candidates"]:
        assert "projected_walk_time_delta_s" in candidate, (
            "the cost must travel beside the benefit, never separately"
        )


def test_the_same_seed_gives_the_same_sweep():
    """Invariant 6: every simulation run is seeded and reproducible, including
    the ones an agent triggers."""
    def sweep() -> list[float]:
        context = build_context()
        sim = Simulation(context.graph, SimConfig(seed=11, tick_s=2.0))
        sim.add_agents(40, "gate-1", "exit-a", spread_s=20.0)
        sim.run(10.0)
        context.simulation = sim
        context.intervention = InterventionEngine(horizon_s=20.0)
        result = Toolbox(context).invoke(
            "simulate_intervention", {"from_zone": "concourse", "to_zone": "gate-2"}
        )
        return [c["projected_peak_density"] for c in result["candidates"]]

    assert sweep() == sweep()


def test_predictions_are_passed_through_with_their_model_id(toolbox: Toolbox):
    """A dashboard must never be able to imply a learned model produced a
    baseline number, and neither must the agent."""
    result = toolbox.invoke("get_predictions", {})
    assert result["total"] == 1
    forecast = result["forecasts"][0]
    assert forecast["model_id"] == "baseline-v1"
    assert forecast["time_to_threshold_s"] == 167.0
    assert forecast["causes"]


def test_the_event_schedule_is_available_and_names_the_current_session(toolbox: Toolbox):
    result = toolbox.invoke("get_event_schedule", {})
    assert result["current_session_id"] == "quali"
    assert [s["id"] for s in result["sessions"]] == ["fp1", "quali"]


def test_missing_optional_engines_degrade_to_errors_not_crashes():
    context = OpsContext(
        pack=build_pack(),
        graph=build_context().graph,
        safety=build_context().safety,
        state=build_state(build_pack()),
        now=1000.0,
    )
    toolbox = Toolbox(context)
    assert "error" in toolbox.invoke("generate_insight", {})
    assert "error" in toolbox.invoke("get_event_schedule", {})
    assert toolbox.invoke("get_venue_state", {})["observed_zones"] > 0


def test_population_estimates_are_scaled_by_measured_participation(toolbox: Toolbox):
    result = toolbox.invoke("get_zone_state", {"zone_id": "gate-1"})
    assert result["estimated_population"] == round(40 / PARTICIPATION)
