"""Routing: the ETA gate, closed crossings, advisories, and the route cache.

Two failure modes dominate here, and both look fine on a static map: routing
someone at a crossing that has already shut, and routing someone at one that
will have shut by the time they arrive. The second is the interesting one — it
manufactures exactly the queue the reroute was issued to prevent — and it is
what the deadline argument exists for.

The cache tests are the same argument in a different register: a memo that
outlives a `rebuild` would serve a path through a closed crossing with no search
involved at all.
"""

from __future__ import annotations

import pytest
from conftest import edge, make_pack, zone
from crowdflow_contracts import (
    ASSUMED_ROUTE_CACHE_ENTRIES,
    FREE_FLOW_SPEED_MS,
    LOSBand,
    ZoneState,
)
from crowdflow_contracts.state import Confidence
from crowdflow_core.routing import VenueGraph
from crowdflow_core.routing.graph import AVOID_PENALTY, PREFER_DISCOUNT


def _zone_state(zone_id: str, density: float, speed: float = 0.5) -> ZoneState:
    """A ZoneState carrying only what edge_cost reads: density (via band) and speed."""
    return ZoneState(
        zone_id=zone_id,
        timestamp=0.0,
        observed_nodes=50,
        participation_rate=0.2,
        density_persons_m2=density,
        flow_ped_m_min=density * speed * 60.0,
        mean_speed_ms=speed,
        inflow_per_min=0.0,
        outflow_per_min=0.0,
        confidence=Confidence(
            value=0.8, observed_nodes=50, freshness_s=1.0,
            mean_accuracy_m=8.0, stability=0.9,
        ),
    )


# --------------------------------------------------------------- basics ------

def test_the_short_route_wins_when_everything_is_open(diamond: VenueGraph):
    r = diamond.route("gate", "exit")
    assert r.found
    assert r.path == ["gate", "exit"]
    assert r.distance_m == pytest.approx(200.0)


def test_unknown_zones_are_rejected_with_a_reason(diamond: VenueGraph):
    assert diamond.route("nowhere", "exit").rejected_reason == "unknown origin 'nowhere'"
    assert diamond.route("gate", "nowhere").rejected_reason == (
        "unknown destination 'nowhere'"
    )
    assert not diamond.route("nowhere", "exit").found


def test_a_disconnected_destination_is_no_path_not_a_crash():
    pack = make_pack(
        [zone("a", 0, 0), zone("b", 100, 0), zone("island", 500, 500)],
        [edge("e_ab", "a", "b", 100.0), edge("e_ba", "island", "island", 1.0)],
    )
    graph = VenueGraph(pack)
    r = graph.route("a", "island")
    assert not r.found
    assert r.rejected_reason == "no path under current conditions"


# ------------------------------------------------------------- the ETA gate --

def test_the_eta_gate_refuses_a_crossing_that_shuts_before_arrival(diamond: VenueGraph):
    """The deadline is per edge, measured from departure, and it is a refusal.

    The direct link is 200 m — about 149 s at free-flow. Given 60 s of remaining
    availability the walker cannot make it, so the router must send them the
    long way rather than into a crossing that will be closed on arrival.
    """
    open_path = diamond.route("gate", "exit")
    assert open_path.path == ["gate", "exit"]

    gated = diamond.route("gate", "exit", crossing_deadlines={"e_direct": 60.0})
    assert gated.found
    assert "e_direct" not in _edges_of(diamond, gated.path)
    assert gated.path == ["gate", "north", "exit"]


def test_the_eta_gate_allows_a_crossing_the_walker_reaches_in_time(diamond: VenueGraph):
    generous = diamond.route("gate", "exit", crossing_deadlines={"e_direct": 600.0})
    assert generous.path == ["gate", "exit"]


def test_the_eta_gate_is_about_arrival_time_not_departure_time(diamond: VenueGraph):
    """A crossing two hops in has to be judged on when the walker gets *there*.

    The deadline on the second arm is comfortable for someone leaving now and
    impossible for someone who must walk the first arm first — which is the
    whole reason elapsed time is carried through the search.
    """
    reached_in_time = diamond.route("north", "exit", crossing_deadlines={"e_north_exit": 500.0})
    assert reached_in_time.path == ["north", "exit"]

    from_further_back = diamond.route(
        "gate", "exit", crossing_deadlines={"e_direct": 1.0, "e_north_exit": 500.0}
    )
    # 600 m to north is ~448 s, and the second arm would then be reached at
    # ~896 s — past its deadline. The long south arm is the only path left.
    assert from_further_back.path == ["gate", "south", "exit"]


def test_a_closed_crossing_is_not_in_the_graph_at_all(diamond: VenueGraph):
    """D5: availability removes the edge; it is not merely expensive."""
    diamond.rebuild("race")
    assert "e_direct" in diamond.closed_edges
    r = diamond.route("gate", "exit")
    assert r.path == ["gate", "north", "exit"]
    assert all(dest != "exit" for dest, _ in diamond.neighbours("gate"))


def test_reopening_restores_the_short_route(diamond: VenueGraph):
    diamond.rebuild("race")
    assert diamond.route("gate", "exit").path == ["gate", "north", "exit"]
    diamond.rebuild("practice")
    assert diamond.route("gate", "exit").path == ["gate", "exit"]


def test_a_barrier_with_no_alternative_leaves_no_path():
    """A fence is not a slow edge. If the only link closes, routing says so."""
    pack = make_pack(
        [zone("a", 0, 0), zone("b", 100, 0)],
        [edge("e_ab", "a", "b", 100.0)],
        crossings=[_at_grade("x", "e_ab")],
    )
    graph = VenueGraph(pack, "practice")
    assert graph.route("a", "b").found
    graph.rebuild("race")
    assert not graph.route("a", "b").found


def test_an_unknown_session_closes_every_time_limited_edge(diamond_pack):
    """Fail-safe, and the right way round: not knowing whether cars are running
    must not be read as 'the crossing is open'."""
    unknown = VenueGraph(diamond_pack, None)
    assert "e_direct" in unknown.closed_edges
    assert unknown.route("gate", "exit").path == ["gate", "north", "exit"]


def _at_grade(cid: str, edge_id: str):
    from conftest import measured
    from crowdflow_contracts import Availability, Crossing, CrossingKind

    return Crossing(
        id=cid, kind=CrossingKind.AT_GRADE, edge_id=edge_id,
        throughput_per_min=measured(80.0),
        availability=Availability(always_open=False, closed_when=["race"]),
    )


def _edges_of(graph: VenueGraph, path: list[str]) -> set[str]:
    out = set()
    for a, b in zip(path, path[1:]):
        out.update(eid for dest, eid in graph.neighbours(a) if dest == b)
    return out


# ------------------------------------------------------------- advisories ----

def test_avoid_pushes_the_route_off_a_zone_without_forbidding_it(diamond: VenueGraph):
    """An advisory is a penalty, not a closure — invariant 4 lives at safety, not here."""
    assert diamond.route("gate", "exit", avoid={"north"}).path == ["gate", "exit"]

    # With the direct link shut, avoiding north costs 25x on both its edges, so
    # the 2x-longer south arm wins.
    diamond.rebuild("race")
    assert diamond.route("gate", "exit", avoid={"north"}).path == ["gate", "south", "exit"]

    # ...but if the avoided zone is the only way through, a path is still returned.
    stranded = diamond.route("gate", "exit", avoid={"north", "south"})
    assert stranded.found
    assert AVOID_PENALTY > 1


def test_prefer_discounts_a_route_without_forcing_it(diamond: VenueGraph):
    diamond.rebuild("race")
    assert diamond.route("gate", "exit").path == ["gate", "north", "exit"]
    # South is twice as long; a 0.6 discount is not enough to win it, and should
    # not be: an advisory that overrides distance is a diversion nobody chose.
    assert diamond.route("gate", "exit", prefer={"south"}).path == ["gate", "north", "exit"]
    assert PREFER_DISCOUNT < 1


def test_prefer_discount_cannot_make_the_search_return_a_suboptimal_path():
    """Regression for the inadmissible free-flow A* heuristic.

    A preferred edge can cost less than straight-line free-flow time. Dijkstra's
    zero heuristic must therefore still find the genuinely cheapest path.
    """
    pack = make_pack(
        [
            zone("s", 0, 0),
            zone("near", 90, 0),
            zone("far", 0, 100),
            zone("x", 100, 0),
        ],
        [
            edge("e-s-near", "s", "near", 90),
            edge("e-near-x", "near", "x", 90),
            edge("e-s-far", "s", "far", 100),
            edge("e-far-x", "far", "x", 100),
        ],
    )
    graph = VenueGraph(pack)
    result = graph.route("s", "x", prefer={"far"})
    assert result.path == ["s", "far", "x"]
    expected = (
        100 / FREE_FLOW_SPEED_MS * PREFER_DISCOUNT
        + 100 / FREE_FLOW_SPEED_MS
    )
    assert result.cost_s == pytest.approx(expected)


def test_a_critical_zone_costs_more_than_a_nominal_one(diamond: VenueGraph):
    """Cost is time under current conditions, not distance."""
    clear = diamond.edge_cost(
        "e_direct", {"exit": _zone_state("exit", 0.1, FREE_FLOW_SPEED_MS)}
    )[0]
    jammed = diamond.edge_cost("e_direct", {"exit": _zone_state("exit", 3.9, 0.1)})[0]
    assert _zone_state("exit", 3.9, 0.1).band is LOSBand.CRITICAL
    assert jammed > clear * 10


# ------------------------------------------------------------ the route cache --

def test_the_cache_returns_the_same_answer_the_search_would(diamond: VenueGraph):
    first = diamond.route("gate", "exit")
    second = diamond.route("gate", "exit")
    direct = diamond._search("gate", "exit", None, None, None, None)

    assert diamond.cache_hits == 1 and diamond.cache_misses == 1
    for r in (second, direct):
        assert r.path == first.path
        assert r.cost_s == pytest.approx(first.cost_s)
        assert r.distance_m == pytest.approx(first.distance_m)
        assert r.eta_s == pytest.approx(first.eta_s)


def test_the_cache_is_keyed_on_the_advisory_sets(diamond: VenueGraph):
    """Avoid and prefer change the answer, so they must change the key."""
    diamond.rebuild("race")
    plain = diamond.route("gate", "exit")
    avoided = diamond.route("gate", "exit", avoid={"north"})
    assert plain.path != avoided.path
    assert diamond.route("gate", "exit").path == plain.path
    assert diamond.route("gate", "exit", avoid={"north"}).path == avoided.path
    assert diamond.route_cache_size == 2

    # Set identity, not object identity: the same request built twice is one entry.
    first_ask = {"north"}
    diamond.route("gate", "exit", avoid=first_ask)
    diamond.route("gate", "exit", avoid=set(first_ask))
    assert diamond.route_cache_size == 2


def test_rebuild_invalidates_the_cache(diamond: VenueGraph):
    """THE failure this cache could cause: a path through a shut crossing.

    Without invalidation the pre-closure answer survives the rebuild and is
    served without a search — no ETA gate, no closed-edge check, nothing.
    """
    assert diamond.route("gate", "exit").path == ["gate", "exit"]

    diamond.rebuild("race")
    assert diamond.route_cache_size == 0

    after = diamond.route("gate", "exit")
    assert after.path == ["gate", "north", "exit"]
    assert "e_direct" not in _edges_of(diamond, after.path)


def test_a_state_bearing_call_is_neither_cached_nor_served_from_cache(diamond: VenueGraph):
    """Per-tick density is not in the key, so it must not touch the cache."""
    jammed = {"exit": _zone_state("exit", 3.9, 0.1)}

    diamond.route("gate", "exit")  # miss, populates the cache
    baseline_cost = diamond.route("gate", "exit").cost_s
    hits_before, size_before = diamond.cache_hits, diamond.route_cache_size

    dynamic = diamond.route("gate", "exit", states=jammed)
    assert diamond.cache_hits == hits_before, "a dynamic call must not count as a hit"
    assert diamond.route_cache_size == size_before, "a dynamic answer must not be stored"
    assert dynamic.cost_s > baseline_cost, "the dynamic call must have re-costed"

    # And the static answer is untouched by the dynamic one.
    assert diamond.route("gate", "exit").cost_s == pytest.approx(baseline_cost)


def test_a_deadline_bearing_call_is_not_cached(diamond: VenueGraph):
    """The deadline changes the answer and is not in the key. Same treatment."""
    gated = diamond.route("gate", "exit", crossing_deadlines={"e_direct": 60.0})
    assert gated.path == ["gate", "north", "exit"]
    assert diamond.route_cache_size == 0

    assert diamond.route("gate", "exit").path == ["gate", "exit"]
    assert diamond.route("gate", "exit", crossing_deadlines={"e_direct": 60.0}).path == [
        "gate", "north", "exit"
    ], "a cached open path must never satisfy a deadline-bearing request"


def test_a_caller_cannot_corrupt_the_cache_by_mutating_its_path(diamond: VenueGraph):
    """The simulator consumes paths destructively (`path.pop(0)`)."""
    first = diamond.route("gate", "exit")
    first.path.pop(0)
    first.path.append("nowhere")

    again = diamond.route("gate", "exit")
    assert again.path == ["gate", "exit"]


def test_the_cache_hits_where_a_crowd_would_hit_it(diamond: VenueGraph):
    """Many walkers, few distinct requests — the property the speedup rests on."""
    for _ in range(500):
        diamond.route("gate", "exit")
        diamond.route("north", "exit", avoid={"south"})
    assert diamond.route_cache_size == 2
    assert diamond.cache_misses == 2
    assert diamond.cache_hits == 998


def test_static_route_cache_is_bounded_and_lru(diamond: VenueGraph, monkeypatch):
    monkeypatch.setattr(
        "crowdflow_core.routing.graph.ASSUMED_ROUTE_CACHE_ENTRIES", 2
    )
    first = ("gate", "exit", frozenset(), frozenset())
    second = ("north", "exit", frozenset(), frozenset())
    third = ("south", "exit", frozenset(), frozenset())

    diamond.route(first[0], first[1])
    diamond.route(second[0], second[1])
    diamond.route(first[0], first[1])  # first is most recently used
    diamond.route(third[0], third[1])

    assert diamond.route_cache_size == 2
    assert first in diamond._route_cache
    assert second not in diamond._route_cache
    assert third in diamond._route_cache
    assert ASSUMED_ROUTE_CACHE_ENTRIES > 702, "the seeded gate measured 702 entries"
