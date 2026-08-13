"""The simulator: seeded, forkable, and honest about who is carrying a phone.

The simulator's only job is to be a crowd the rest of the system cannot tell from
a real one. Two properties make that true rather than merely claimed:

  * the same seed produces the same run, so an A/B differs in the intervention
    and in nothing else (invariant 6);
  * participation is a property of a device, decided once. Resampling it per tick
    would make the union of observed devices over any window approach the whole
    crowd, and every population estimate downstream would inflate by roughly
    1/participation while looking perfectly reasonable.
"""

from __future__ import annotations

import pytest

from crowdflow_core.routing import VenueGraph
from crowdflow_core.simulation import SimConfig, Simulation

from conftest import edge, make_pack, zone

PARTICIPATION = 0.2
CROWD = 500


@pytest.fixture
def world_pack():
    return make_pack(
        [zone("stand", 0.0, 0.0), zone("hall", 100.0, 0.0), zone("exit", 200.0, 0.0)],
        [
            edge("e_stand_hall", "stand", "hall", 100.0, width_m=5.0),
            edge("e_hall_exit", "hall", "exit", 100.0, width_m=5.0),
        ],
    )


def build(world_pack, seed: int = 11, **config) -> Simulation:
    graph = VenueGraph(world_pack, "race")
    sim = Simulation(graph, SimConfig(seed=seed, participation=PARTICIPATION, **config))
    sim.add_agents(CROWD, "stand", "exit", spread_s=120.0)
    return sim


def _trace(sim: Simulation, ticks: int = 60) -> list[tuple]:
    out = []
    for _ in range(ticks):
        sim.step()
        out.append((sim.time_s, sim.active, sim.arrived, tuple(sorted(sim.zone_occupancy().items()))))
    return out


# --------------------------------------------------------------- seeding ----

def test_the_same_seed_produces_the_same_crowd(world_pack):
    assert _trace(build(world_pack, seed=11)) == _trace(build(world_pack, seed=11))


def test_a_different_seed_produces_a_different_crowd(world_pack):
    """Otherwise the seed is decorative and the reproducibility claim is empty."""
    assert _trace(build(world_pack, seed=11)) != _trace(build(world_pack, seed=12))


def test_everyone_eventually_arrives(world_pack):
    sim = build(world_pack)
    sim.run(2000.0)
    assert sim.arrived == CROWD
    assert sim.active == 0
    assert len(sim.arrived_walk_times) == CROWD
    assert min(sim.arrived_walk_times) > 0


# ---------------------------------------------------------- participation ---

def test_participation_is_a_property_of_a_device_not_of_a_tick(world_pack):
    """The bug this guards against inflates every population estimate.

    If participation were resampled each tick, the set of devices seen over a
    window would grow toward the whole crowd — so a 20% sample would look like a
    census after enough ticks, and the state engine would then scale it up by
    another factor of five.
    """
    sim = build(world_pack)
    seen: set[str] = set()
    for _ in range(200):  # long enough for every agent to have walked the venue
        sim.step()
        seen.update(n.node_id for n in sim.emit())

    participants = {f"{a.id:x}" for a in sim.agents if a.participates}
    assert len(participants) == pytest.approx(CROWD * PARTICIPATION, rel=0.25)

    # node_id is "<agent id in hex>-<epoch>". The union over the WHOLE run is the
    # participating set — it does not grow toward the crowd.
    emitters = {nid.split("-")[0] for nid in seen}
    assert emitters <= participants, "a non-participating device must never emit"
    assert emitters == participants, "and every participant reports at some point"
    assert len(emitters) < CROWD * 0.3


def test_emitted_telemetry_is_indistinguishable_from_a_phone_s(world_pack):
    """The state engine must not be able to tell the simulator from the mesh."""
    sim = build(world_pack)
    for _ in range(20):
        sim.step()
    nodes = sim.emit()

    assert nodes
    for n in nodes:
        assert n.zone_id in sim.graph.pack.zones
        assert n.accuracy_m > 0
        assert 0 <= n.speed_ms <= 2.0
        assert n.timestamp == sim.time_s


def test_a_denser_edge_slows_the_walkers_on_it(world_pack):
    """Speed comes from the same fundamental diagram the state engine measures
    with — if it did not, every prediction validated here would be fiction."""
    sparse = Simulation(
        VenueGraph(world_pack, "race"), SimConfig(seed=3, participation=PARTICIPATION)
    )
    sparse.add_agents(10, "stand", "exit")
    dense = Simulation(
        VenueGraph(world_pack, "race"), SimConfig(seed=3, participation=PARTICIPATION)
    )
    dense.add_agents(3000, "stand", "exit")

    for _ in range(20):
        sparse.step()
        dense.step()

    assert max(n.speed_ms for n in dense.emit()) < min(n.speed_ms for n in sparse.emit())


# ---------------------------------------------------------------- forking ---

def test_a_fork_starts_where_the_world_is_and_then_diverges(world_pack):
    sim = build(world_pack)
    for _ in range(30):
        sim.step()

    fork = sim.fork()
    assert fork.time_s == sim.time_s
    assert fork.arrived == sim.arrived
    assert [a.at for a in fork.agents] == [a.at for a in sim.agents]

    fork.step()
    assert fork.time_s > sim.time_s
    assert [a.at for a in sim.agents] != [] and sim.time_s == 30 * sim.config.tick_s


def test_a_fork_does_not_share_agent_state_with_its_parent(world_pack):
    """Aliased agents would make every counterfactual mutate the live world."""
    sim = build(world_pack)
    for _ in range(30):
        sim.step()
    snapshot = [(a.at, a.edge_id, a.progress_m, list(a.path)) for a in sim.agents]

    fork = sim.fork()
    for _ in range(30):
        fork.step()
    fork.avoid = {"hall"}

    assert [(a.at, a.edge_id, a.progress_m, list(a.path)) for a in sim.agents] == snapshot
    assert sim.avoid == set()
    assert sim.arrived_walk_times is not fork.arrived_walk_times


# ------------------------------------------------------------- compliance ---

def test_not_everyone_follows_a_reroute(world_pack):
    """Assuming total compliance would flatter every intervention result."""
    sim = build(world_pack, compliance=0.7)
    complying = sum(1 for a in sim.agents if a.complies)
    assert 0 < complying < CROWD
    assert complying == pytest.approx(CROWD * 0.7, rel=0.15)
