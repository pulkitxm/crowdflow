"""Simulator refinement telemetry stays private, separate and reproducible."""

from __future__ import annotations

from conftest import edge, make_pack, zone
from crowdflow_core.routing import VenueGraph
from crowdflow_core.simulation import SimConfig, Simulation


def world(seed=7):
    pack = make_pack(
        [zone("gate", 0, 0), zone("hall", 100, 0), zone("exit", 200, 0)],
        [edge("e1", "gate", "hall", 100), edge("e2", "hall", "exit", 100)],
    )
    sim = Simulation(VenueGraph(pack), SimConfig(seed=seed, participation=1.0))
    sim.add_agents(5, "gate", "exit")
    return sim


def collect(seed=7):
    sim = world(seed)
    for _ in range(10):
        sim.step()
        sim.emit()
    return sim.emit_trace_fragments()


def test_simulator_emits_real_trace_fragment_contracts():
    fragments = collect()
    assert fragments
    assert all(len(fragment.points) >= 2 for fragment in fragments)
    assert all(fragment.epsilon > 0 and fragment.noise_radius_m > 0 for fragment in fragments)


def test_trace_ids_rotate_and_do_not_share_crowdnode_ids():
    sim = world()
    for _ in range(5):
        sim.step()
        nodes = sim.emit()
    first = sim.emit_trace_fragments()
    for _ in range(5):
        sim.step()
        nodes = sim.emit()
    second = sim.emit_trace_fragments()

    node_ids = {node.node_id for node in nodes}
    first_ids = {fragment.fragment_id for fragment in first}
    second_ids = {fragment.fragment_id for fragment in second}
    assert first_ids.isdisjoint(second_ids)
    assert node_ids.isdisjoint(first_ids | second_ids)


def test_same_seed_produces_identical_private_fragments():
    a = [fragment.model_dump() for fragment in collect(42)]
    b = [fragment.model_dump() for fragment in collect(42)]
    assert a == b
