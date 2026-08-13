"""Mesh transport tests.

Written against the failure modes, because every one of them produces a system
that looks like it is working:

  * a message that loops forever because dedupe only ran at the destination
  * a copy bound that silently stops holding, so battery cost is unbounded
  * a predictability metric that saturates, so PRoPHET is epidemic in disguise
  * a dashboard that counts one observation N times, once per uplink
  * an observation with no age, presented as if it were current
  * a region with no uplink, rendered as quiet rather than unheard
  * noise added after storage, which protects nobody
"""

from __future__ import annotations

import itertools
import math
import random

import pytest
from crowdflow_contracts import (
    ASSUMED_GEOIND_RADIUS_M,
    GEOIND_EPSILON_VENUE,
    GEOIND_PRIVACY_LEVEL,
    MESH_TTL_MAX,
    MeshClass,
    MeshMessage,
    MeshMessageType,
    Position,
    dedupe_retention_s,
    spray_copies_for,
)
from crowdflow_core.mesh import (
    UPLINK_DESTINATION,
    AcceptOutcome,
    Carried,
    ClockSkew,
    DedupeCache,
    DeliveryPredictability,
    FanIn,
    MeshNode,
    MeshSimConfig,
    MeshSimulator,
    MessageBuffer,
    Prophet,
    TokenBucket,
    UplinkReport,
    aggregate_density,
    components,
    coverage,
    elect_uplinks,
    encounter,
    expected_displacement_m,
    key_of,
    lambert_w_minus1,
    noise_fragment,
    planar_laplace,
    radio_neighbours,
)
from crowdflow_core.mesh.privacy import FragmentPolicy


def message(
    source: str = "a",
    sequence: int = 0,
    ttl: int = MESH_TTL_MAX,
    traffic_class: MeshClass = MeshClass.STATE,
    timestamp: float = 0.0,
) -> MeshMessage:
    return MeshMessage(
        type=MeshMessageType.ZONE_UPDATE,
        traffic_class=traffic_class,
        source=source,
        sequence=sequence,
        ttl=ttl,
        timestamp=timestamp,
    )


def node(node_id: str, x: float = 0.0, y: float = 0.0, **kwargs) -> MeshNode:
    return MeshNode(node_id, Position(x=x, y=y), **kwargs)


# ------------------------------------------------------------------- ttl --

def test_ttl_decrements_on_relay_and_stops_at_zero():
    m = message(ttl=2)
    assert m.hop().ttl == 1
    assert m.hop().hop().ttl == 0
    assert m.hop().hop().expired


def test_a_message_never_travels_more_hops_than_its_ttl():
    """The property TTL exists for. Enforced per hop, so a chain cannot exceed it."""
    chain = [node(f"n{i}") for i in range(MESH_TTL_MAX + 4)]
    chain[0].originate(MeshMessageType.ALERT, MeshClass.URGENT, {}, 0.0, ttl=3)
    key = (chain[0].id, 0)

    now = 0.0
    for sender, receiver in itertools.pairwise(chain):
        now += 1.0
        for n in (sender, receiver):
            n.advance(now, set())
        encounter(sender, receiver, now)

    holders = [i for i, n in enumerate(chain) if n.holds(key)]
    # Originator plus at most 3 hops; nothing beyond index 3 can ever have seen it.
    assert holders and max(holders) <= 3


def test_expired_message_is_still_delivered_but_never_relayed():
    """Arrival is arrival. Refusing a delivery on TTL grounds discards a completed
    journey to enforce a rule about journeys not yet taken.

    Asserted on the OUTCOME, not on falsiness. Both calls below were once `is
    False` — identical answers for a completed delivery and a dead message, which
    is exactly how a sender came to treat the best possible result as a failure.
    """
    uplink = node("up", online=True)
    delivered = uplink.accept(message(ttl=0), now=1.0)
    assert delivered is AcceptOutcome.DELIVERED
    assert delivered.held_somewhere        # the sender may release it
    assert not delivered                   # ...though it was not STORED here
    assert len(uplink.uplinked) == 1

    relay = node("relay")
    dropped = relay.accept(message(source="b", ttl=0), now=1.0)
    assert dropped is AcceptOutcome.EXPIRED
    assert not dropped.held_somewhere      # nobody has it now
    assert len(relay.buffer) == 0


# ---------------------------------------------------------------- dedupe --

def test_dedupe_is_per_source_sequence_and_rejects_the_second_sight():
    cache = DedupeCache(retention_s=100.0)
    assert cache.check_and_add(("a", 1), 0.0) is True
    assert cache.check_and_add(("a", 1), 1.0) is False
    assert cache.check_and_add(("a", 2), 1.0) is True
    assert cache.check_and_add(("b", 1), 1.0) is True


def test_dedupe_happens_at_every_hop_not_only_at_the_destination():
    """A relay that accepts a message twice pays for it twice, whether or not it
    is the destination."""
    relay = node("relay")
    m = message()
    assert relay.accept(m, 0.0) is AcceptOutcome.STORED
    second = relay.accept(m, 1.0)
    assert second is AcceptOutcome.DUPLICATE
    assert second.held_somewhere           # the peer has it; custody may pass
    assert len(relay.buffer) == 1


def test_a_cycle_does_not_loop_forever():
    """A gives to B, B walks back past A. Without hop-level dedupe this is a
    message that never stops costing battery."""
    a, b = node("a"), node("b")
    a.originate(MeshMessageType.ZONE_UPDATE, MeshClass.STATE, {}, 0.0)
    for tick in range(1, 8):
        for n in (a, b):
            n.advance(float(tick), {"a", "b"} - {n.id})
        encounter(a, b, float(tick))
    # One transmission each way at most; the rest are refused by dedupe.
    assert a.transmissions + b.transmissions <= 2


def test_dedupe_retention_outlives_the_longest_possible_message():
    """If the cache forgets before the message dies, the loop reopens."""
    assert dedupe_retention_s() >= MESH_TTL_MAX * 1.0
    cache = DedupeCache(retention_s=10.0)
    cache.check_and_add(("a", 1), 0.0)
    cache.expire(5.0)
    assert cache.seen(("a", 1))
    cache.expire(20.0)
    assert not cache.seen(("a", 1))


def test_dedupe_refreshes_on_a_duplicate_so_a_circulating_message_is_not_forgotten():
    cache = DedupeCache(retention_s=10.0)
    cache.check_and_add(("a", 1), 0.0)
    cache.check_and_add(("a", 1), 9.0)
    cache.expire(15.0)
    assert cache.seen(("a", 1))


# ---------------------------------------------------------------- buffer --

def _carried(traffic_class: MeshClass, seq: int, at: float) -> Carried:
    return Carried(
        message=message(sequence=seq, traffic_class=traffic_class, timestamp=at),
        initial_ttl=MESH_TTL_MAX,
        received_at=at,
    )


def test_buffer_evicts_state_before_urgent():
    """STATE is the class defined as loss-tolerant, so STATE is what is lost."""
    buffer = MessageBuffer(capacity=2)
    buffer.add(_carried(MeshClass.STATE, 1, 0.0))
    buffer.add(_carried(MeshClass.URGENT, 2, 1.0))
    buffer.add(_carried(MeshClass.UPLINK, 3, 2.0))

    assert ("a", 1) not in buffer
    assert ("a", 2) in buffer
    assert buffer.evictions_by_class[MeshClass.STATE] == 1


def test_a_full_buffer_refuses_a_message_it_would_rather_keep_what_it_has():
    """The failure mode epidemic routing produces, made observable rather than
    hidden behind an unbounded list."""
    buffer = MessageBuffer(capacity=1)
    buffer.add(_carried(MeshClass.URGENT, 1, 5.0))
    assert buffer.add(_carried(MeshClass.STATE, 2, 6.0)) is False
    assert ("a", 1) in buffer


def test_oldest_of_the_same_class_goes_first():
    buffer = MessageBuffer(capacity=2)
    buffer.add(_carried(MeshClass.STATE, 1, 0.0))
    buffer.add(_carried(MeshClass.STATE, 2, 10.0))
    buffer.add(_carried(MeshClass.STATE, 3, 20.0))
    assert ("a", 1) not in buffer
    assert ("a", 2) in buffer and ("a", 3) in buffer


def test_expired_messages_are_pruned_not_carried_until_something_needs_the_space():
    buffer = MessageBuffer(capacity=4)
    buffer.add(
        Carried(message=message(ttl=0), initial_ttl=MESH_TTL_MAX, received_at=0.0)
    )
    assert buffer.prune_expired() == 1
    assert len(buffer) == 0


# ----------------------------------------------------------- rate limiter --

def test_token_bucket_allows_a_burst_then_makes_you_wait():
    bucket = TokenBucket(rate_per_s=0.5, capacity=3, now=0.0)
    assert [bucket.take(0.0) for _ in range(4)] == [True, True, True, False]
    assert bucket.take(1.0) is False  # 0.5 tokens: not yet one
    assert bucket.take(2.0) is True


def test_the_bucket_never_fills_past_its_burst_capacity():
    bucket = TokenBucket(rate_per_s=1.0, capacity=2, now=0.0)
    assert bucket.take(1_000.0) and bucket.take(1_000.0)
    assert bucket.take(1_000.0) is False


# ------------------------------------------------------------ prophet --

def test_meeting_an_uplink_raises_predictability_toward_connectivity():
    a, up = node("a"), node("up", online=True)
    assert a.predictability(UPLINK_DESTINATION) == 0.0
    a.advance(1.0, {"up"})
    up.advance(1.0, {"a"})
    encounter(a, up, 1.0)
    assert a.predictability(UPLINK_DESTINATION) > 0.0


def test_transitivity_carries_connectivity_two_hops_out():
    """The elegant part, and the one worth a test: B never meets an uplink, but
    learns from A that A does. Routing toward connectivity is not bolted on."""
    a, b, up = node("a"), node("b"), node("up", online=True)
    never_met_anyone = node("c")
    now = 0.0
    for _ in range(3):
        now += 5.0
        a.advance(now, {"up"})
        up.advance(now, {"a"})
        encounter(a, up, now)
        now += 5.0
        a.advance(now, {"b"})
        b.advance(now, {"a"})
        encounter(a, b, now)
    assert b.predictability(UPLINK_DESTINATION) > 0.0
    assert a.predictability(UPLINK_DESTINATION) > b.predictability(UPLINK_DESTINATION)
    assert never_met_anyone.predictability(UPLINK_DESTINATION) == 0.0


def test_a_persisting_contact_does_not_reapply_the_encounter_update():
    """The defect that turns PRoPHET into epidemic routing wearing its name.

    Two people walking together are in range for minutes. A per-tick update
    drives that one relationship to certainty and, through transitivity, drives
    everyone else's estimate there too — after which "is this peer better than
    me" is a coin flip on floating-point noise.
    """
    a, b = node("a"), node("b")
    a.advance(1.0, {"b"})
    b.advance(1.0, {"a"})
    encounter(a, b, 1.0)
    after_first = a.predictability("b")

    for tick in range(2, 12):
        a.advance(float(tick), {"b"})
        b.advance(float(tick), {"a"})
        encounter(a, b, float(tick))

    assert a.predictability("b") <= after_first


def test_predictability_ages_so_a_stale_acquaintance_stops_looking_like_a_route():
    table = DeliveryPredictability("a", now=0.0)
    table.set(UPLINK_DESTINATION, 1.0)
    table.age(600.0)
    assert table.get(UPLINK_DESTINATION) < 0.5


def test_prophet_forwards_up_the_gradient_and_not_down_it():
    policy = Prophet()
    low, high = node("low"), node("high")
    low.predictabilities.set(UPLINK_DESTINATION, 0.2)
    high.predictabilities.set(UPLINK_DESTINATION, 0.9)
    carried = _carried(MeshClass.UPLINK, 1, 0.0)
    carried.copies = 1

    assert policy.consider(carried, low, high, 0.0) is not None
    assert policy.consider(carried, high, low, 0.0) is None


def test_an_online_peer_is_forwarded_to_regardless_of_the_estimate():
    """No predictability estimate beats an observation."""
    policy = Prophet()
    carrier = node("carrier")
    carrier.predictabilities.set(UPLINK_DESTINATION, 1.0)
    up = node("up", online=True)
    up.predictabilities.set(UPLINK_DESTINATION, 0.0)  # deliberately wrong estimate
    assert policy.consider(_carried(MeshClass.UPLINK, 1, 0.0), carrier, up, 0.0) is not None


# ------------------------------------------------------------- copy bounds --

def _single_message_run(
    traffic_class: MeshClass, ticks: int = 120, policy=None
) -> tuple[int, int]:
    sim = MeshSimulator(MeshSimConfig.crowd(seed=3, urgent_every_ticks=0,
                                            state_every_ticks=0, uplink_every_ticks=0))
    if policy is not None:
        for n in sim.nodes:
            n.policies[traffic_class] = policy
    sim.inject(traffic_class)
    for _ in range(ticks):
        sim.tick()
    metrics = sim.finalise().by_class[traffic_class]
    return metrics.transmissions, sim.config.node_count


def test_spray_and_wait_respects_its_copy_bound():
    """The entire reason the STATE class uses this policy. If this stops holding,
    the battery cost of the mesh is unbounded and nobody finds out until a race."""
    transmissions, population = _single_message_run(MeshClass.STATE)
    limit = 2 * spray_copies_for(population)
    assert 0 < transmissions <= limit


def test_prophet_stays_bounded_too_because_of_the_copy_budget():
    """L copies, each moving at most TTL hops, is the analytic ceiling. Without
    the budget there is no ceiling at all: GRTR keeps its copy every time it
    forwards, so an undelivered message duplicates for its whole lifetime."""
    transmissions, population = _single_message_run(MeshClass.UPLINK)
    ceiling = spray_copies_for(population) * MESH_TTL_MAX
    assert 0 < transmissions <= ceiling

    unbounded, _ = _single_message_run(MeshClass.UPLINK, policy=Prophet(copy_budget=False))
    assert unbounded > ceiling


def test_epidemic_costs_far_more_than_the_bounded_policies():
    """The measurement the design rests on. If flooding were cheap there would be
    no reason for three policies."""
    epidemic, _ = _single_message_run(MeshClass.URGENT)
    spray, _ = _single_message_run(MeshClass.STATE)
    assert epidemic > 5 * spray


def test_the_rate_limiter_is_what_makes_epidemic_affordable():
    sim = MeshSimulator(MeshSimConfig.crowd(seed=3, state_every_ticks=0,
                                            uplink_every_ticks=0, urgent_every_ticks=0))
    sim.inject(MeshClass.URGENT)
    for _ in range(40):
        sim.tick()
    busiest = max(n.transmissions_by_class[MeshClass.URGENT] for n in sim.nodes)
    # 40 ticks x 5 s = 200 s at 30 relays/min plus a 15-relay burst.
    assert busiest <= 15 + 200 * (30.0 / 60.0)


# ----------------------------------------------------------------- election --

def test_an_offline_node_is_never_elected():
    nodes = [node("a", online=False), node("b", online=False)]
    adjacency = radio_neighbours(nodes, 100.0)
    election = elect_uplinks(nodes, adjacency)
    assert election.uplinks == []
    assert election.unserved and election.served_fraction == 0.0


def test_a_node_below_the_battery_reserve_is_never_elected():
    """A phone that dies is not a node, and this is a floor rather than a weight
    precisely so that a good connection cannot buy its way past it."""
    flat = node("flat", online=True, battery=0.05)
    flat.radio.uplink_throughput_kbps = 10_000.0
    healthy = node("healthy", x=5.0, online=True, battery=0.9)
    healthy.radio.uplink_throughput_kbps = 100.0
    election = elect_uplinks([flat, healthy], radio_neighbours([flat, healthy], 100.0))
    assert election.uplinks == ["healthy"]


def test_election_prefers_throughput_then_degree_and_is_reproducible():
    fast = node("fast", x=0.0, online=True)
    fast.radio.uplink_throughput_kbps = 900.0
    slow = node("slow", x=5.0, online=True)
    slow.radio.uplink_throughput_kbps = 100.0
    other = node("other", x=10.0)
    nodes = [fast, slow, other]
    adjacency = radio_neighbours(nodes, 100.0)
    assert elect_uplinks(nodes, adjacency).uplinks == ["fast"]
    assert elect_uplinks(list(reversed(nodes)), adjacency).uplinks == ["fast"]


def test_identical_candidates_elect_the_same_winner_every_time():
    """Two nodes with identical facts must not oscillate, each handing the other
    traffic it hands straight back."""
    twins = [node("t1", online=True), node("t2", x=1.0, online=True)]
    adjacency = radio_neighbours(twins, 100.0)
    assert elect_uplinks(twins, adjacency).uplinks == elect_uplinks(twins, adjacency).uplinks


def test_each_radio_island_elects_its_own_uplink():
    """A crowd is not one mesh. An island with no uplink has none, and gets said
    so rather than being quietly attached to a distant one."""
    near = [node("a", online=True), node("b", x=10.0)]
    far = [node("c", x=5_000.0), node("d", x=5_010.0)]
    nodes = near + far
    adjacency = radio_neighbours(nodes, 30.0)
    assert len(components(adjacency)) == 2

    election = elect_uplinks(nodes, adjacency)
    assert election.uplinks == ["a"]
    assert election.assignments == {"a": "a", "b": "a"}
    assert election.unserved == [{"c", "d"}]
    assert election.served_fraction == 0.5


# ----------------------------------------------------------------- coverage --

def test_coverage_is_bounded_by_hops_not_by_connectivity():
    """Being on the same island as an uplink is not the same as reaching it."""
    chain = [node(f"n{i}", x=i * 25.0) for i in range(8)]
    adjacency = radio_neighbours(chain, 30.0)
    report = coverage(adjacency, ["n0"], max_hops=2)
    assert report.covered_nodes == {"n0", "n1", "n2"}
    assert "n7" in report.uncovered_nodes
    assert report.node_fraction == pytest.approx(3 / 8)


def test_an_unreached_zone_is_reported_as_uncovered_not_as_quiet():
    """Invariant 5 at the transport layer: unobserved is not empty."""
    nodes = [node("a"), node("b", x=1_000.0)]
    adjacency = radio_neighbours(nodes, 30.0)
    report = coverage(adjacency, ["a"], zone_of={"a": "z1", "b": "z2"})
    assert report.covered_zones == {"z1"}
    assert report.uncovered_zones == {"z2"}
    assert report.zone_fraction == 0.5


# ------------------------------------------------------------------- fan-in --

def _delivery(source: str, sequence: int, origin: float, hops: int = 1):
    from crowdflow_core.mesh.node import Delivery

    m = message(source=source, sequence=sequence, timestamp=origin)
    return Delivery(
        key=key_of(m),
        traffic_class=m.traffic_class,
        message=m,
        uplink_id="u",
        hops=hops,
        origin_timestamp=origin,
        delivered_at=origin + hops,
    )


def test_the_same_observation_from_two_uplinks_is_counted_once():
    """N uplinks report overlapping views. Counting each report separately
    inflates the crowd by the redundancy factor — worst exactly where coverage is
    best, which is the hardest kind of error to notice."""
    fan = FanIn()
    delivery = _delivery("a", 1, 100.0)
    assert len(fan.receive(UplinkReport("u1", 110.0, [delivery]), 110.0)) == 1
    assert fan.receive(UplinkReport("u2", 111.0, [delivery]), 111.0) == []
    assert len(fan.observations) == 1
    assert fan.duplicates == 1
    assert fan.observations[("a", 1)].reported_by == {"u1", "u2"}
    assert fan.redundancy == 2.0


def test_every_observation_carries_an_age():
    fan = FanIn()
    fan.receive(UplinkReport("u1", 110.0, [_delivery("a", 1, 100.0)]), 110.0)
    observation = fan.observations[("a", 1)]
    assert observation.age_s(120.0) == pytest.approx(20.0)
    assert fan.mean_age_at_receipt_s == pytest.approx(10.0)


def test_lag_varies_with_hop_count_so_the_tail_is_reported_too():
    fan = FanIn()
    for i, hops in enumerate([1, 1, 1, 8]):
        fan.receive(
            UplinkReport("u", 100.0, [_delivery("a", i, 100.0 - hops * 10, hops)]), 100.0
        )
    assert fan.p95_age_at_receipt_s > fan.mean_age_at_receipt_s


def test_clock_skew_is_estimated_by_minimum_filter_and_corrects_the_age():
    """One-way messages cannot separate offset from latency. The minimum bounds
    the error by the VARIATION in latency rather than by its magnitude."""
    skew = ClockSkew()
    for sent, received in [(100.0, 145.0), (200.0, 232.0), (300.0, 338.0)]:
        skew.observe("u", sent, received)
    assert skew.offset("u") == pytest.approx(32.0)
    assert skew.correct("u", 500.0) == pytest.approx(532.0)


def test_an_uplink_whose_clock_runs_slow_does_not_report_stale_data_as_fresh():
    fan = FanIn()
    # This uplink's clock is 60 s behind; its observations must not look 60 s older.
    fan.receive(UplinkReport("slow", 40.0, [_delivery("a", 1, 40.0)]), 100.0)
    assert fan.observations[("a", 1)].age_s(100.0) == pytest.approx(0.0)


def test_an_unknown_uplink_is_assumed_synchronised_rather_than_guessed_at():
    assert ClockSkew().offset("never-seen") == 0.0


# ------------------------------------------------------------------ privacy --

def test_lambert_w_minus1_solves_its_own_equation():
    for x in (-0.3, -0.1, -0.01, -1e-6, -1e-12):
        w = lambert_w_minus1(x)
        assert w <= -1.0
        assert w * math.exp(w) == pytest.approx(x, rel=1e-9)


def test_lambert_w_minus1_is_exact_at_the_branch_point():
    assert lambert_w_minus1(-1 / math.e) == pytest.approx(-1.0)


def test_lambert_w_minus1_rejects_arguments_outside_its_branch():
    with pytest.raises(ValueError):
        lambert_w_minus1(0.1)


def test_planar_laplace_displacement_matches_the_analytic_mean():
    """E[r] = 2/eps for the polar Laplace. If the sampler is wrong, the privacy
    claim and the utility claim are both wrong, in opposite directions."""
    rng = random.Random(11)
    epsilon = 0.05
    origin = Position(x=0.0, y=0.0)
    distances = [
        math.dist((0.0, 0.0), (p.x, p.y))
        for p in (planar_laplace(origin, epsilon, rng) for _ in range(20_000))
    ]
    assert sum(distances) / len(distances) == pytest.approx(
        expected_displacement_m(epsilon), rel=0.05
    )


def test_noise_is_isotropic_so_it_cannot_leak_a_direction():
    rng = random.Random(5)
    points = [planar_laplace(Position(x=0.0, y=0.0), 0.05, rng) for _ in range(20_000)]
    mean_x = sum(p.x for p in points) / len(points)
    mean_y = sum(p.y for p in points) / len(points)
    assert abs(mean_x) < 5.0 and abs(mean_y) < 5.0


def test_a_fragment_records_the_epsilon_actually_applied():
    """A privacy claim detached from the data it describes cannot be checked."""
    rng = random.Random(1)
    fragment = noise_fragment(
        [Position(x=0.0, y=0.0), Position(x=10.0, y=0.0)], 0.0, 30.0, rng
    )
    assert fragment.epsilon == GEOIND_EPSILON_VENUE
    assert fragment.noise_radius_m == pytest.approx(ASSUMED_GEOIND_RADIUS_M)
    assert fragment.epsilon * fragment.noise_radius_m == pytest.approx(
        GEOIND_PRIVACY_LEVEL
    )


def test_a_fragment_that_spans_too_long_is_refused_not_trimmed():
    """Epsilon bounds what one point reveals, not what a long correlated sequence
    reveals. Quietly trimming would hide a caller accumulating a trace."""
    rng = random.Random(1)
    with pytest.raises(ValueError, match="cap"):
        noise_fragment(
            [Position(x=0.0, y=0.0), Position(x=1.0, y=0.0)], 0.0, 10_000.0, rng
        )


def test_a_single_point_is_not_a_path():
    with pytest.raises(ValueError):
        noise_fragment([Position(x=0.0, y=0.0)], 0.0, 1.0, random.Random(1))


def test_one_fragment_says_almost_nothing_about_where_its_owner_was():
    """The privacy half of the claim. If a single fragment localised its author,
    nothing else in this module would matter."""
    rng = random.Random(7)
    truth = Position(x=0.0, y=0.0)
    policy = FragmentPolicy()
    errors = sorted(
        math.dist((0.0, 0.0), (p.x, p.y))
        for p in (planar_laplace(truth, policy.epsilon, rng) for _ in range(2_000))
    )
    assert errors[len(errors) // 2] > policy.radius_m / 2


def test_many_noisy_fragments_recover_the_true_position():
    """The utility half, and the reason strong per-user privacy is not traded
    against an accurate map: the noise is zero-mean and independent, so the error
    of the aggregate falls as 1/sqrt(n) while every individual stays deniable."""
    rng = random.Random(3)
    policy = FragmentPolicy()
    truth = [Position(x=100.0, y=50.0), Position(x=110.0, y=50.0)]
    fragments = [noise_fragment(truth, 0.0, 30.0, rng, policy) for _ in range(4_000)]

    points = [p for f in fragments for p in f.points]
    mean_x = sum(p.x for p in points) / len(points)
    mean_y = sum(p.y for p in points) / len(points)
    assert mean_x == pytest.approx(105.0, abs=5.0)
    assert mean_y == pytest.approx(50.0, abs=5.0)


def test_aggregate_recovers_the_relative_density_of_two_corridors():
    """Map refinement is density estimation, and density ratios are what it
    needs. Three times the traffic must read as roughly three times the traffic
    even though no single fragment can be placed."""
    rng = random.Random(13)
    policy = FragmentPolicy()
    busy = [Position(x=0.0, y=0.0), Position(x=5.0, y=0.0)]
    quiet = [Position(x=2_000.0, y=0.0), Position(x=2_005.0, y=0.0)]

    fragments = [noise_fragment(busy, 0.0, 30.0, rng, policy) for _ in range(3_000)]
    fragments += [noise_fragment(quiet, 0.0, 30.0, rng, policy) for _ in range(1_000)]

    counts = aggregate_density(fragments, cell_m=1_000.0)
    busy_count = sum(v for (cx, _), v in counts.items() if cx == 0)
    quiet_count = sum(v for (cx, _), v in counts.items() if cx == 2)
    assert busy_count / quiet_count == pytest.approx(3.0, rel=0.1)


# ---------------------------------------------------------------- simulator --

def test_the_same_seed_produces_the_same_run():
    """Invariant 6. A protocol comparison that cannot be re-run is an anecdote."""
    a = MeshSimulator(MeshSimConfig.crowd(seed=42)).run(40)
    b = MeshSimulator(MeshSimConfig.crowd(seed=42)).run(40)
    assert a.rows() == b.rows()
    assert a.mean_coverage == b.mean_coverage


def test_different_seeds_produce_different_runs():
    a = MeshSimulator(MeshSimConfig.crowd(seed=1)).run(40)
    b = MeshSimulator(MeshSimConfig.crowd(seed=2)).run(40)
    assert a.rows() != b.rows()


def test_cell_saturation_takes_uplinks_away_where_the_crowd_is_densest():
    """The argument for a floating gateway, as a test: the connectivity a fixed
    gateway would depend on is exactly what disappears under load."""
    from crowdflow_contracts import DENSITY_BUILDING_MAX

    assert MeshSimConfig().cell_capacity_persons_m2 == DENSITY_BUILDING_MAX

    # A cell that gives up at a fifth of jam density. See the scale note on the
    # config field: a few hundred simulated devices do not represent a dense
    # enough crowd to reach the default.
    dense = MeshSimConfig.crowd(
        seed=5, span_m=150.0, node_count=200, cell_capacity_persons_m2=0.05
    )
    saturated = MeshSimulator(dense).run(40)
    healthy = MeshSimulator(
        MeshSimConfig.crowd(seed=5, span_m=150.0, node_count=200, saturating=False)
    ).run(40)
    assert saturated.mean_online_nodes < healthy.mean_online_nodes
    assert saturated.mean_coverage < healthy.mean_coverage


def test_coverage_is_reported_as_partial_rather_than_assumed_complete():
    metrics = MeshSimulator(MeshSimConfig.crowd(seed=9, span_m=800.0)).run(40)
    assert 0.0 < metrics.mean_coverage < 1.0


def test_overlapping_uplinks_are_deduplicated_by_the_dashboard():
    metrics = MeshSimulator(MeshSimConfig.crowd(seed=4)).run(60)
    assert metrics.uplink_redundancy > 1.0
    for class_metrics in metrics.by_class.values():
        assert class_metrics.delivery_ratio <= 1.0


def test_flooding_costs_an_order_of_magnitude_more_than_bounding_copies():
    """The comparison that justifies not flooding, run end to end."""
    metrics = MeshSimulator(MeshSimConfig.crowd(seed=7)).run(120)
    state = metrics.by_class[MeshClass.STATE]
    urgent = metrics.by_class[MeshClass.URGENT]
    assert urgent.copies_per_message > 10 * state.copies_per_message
    assert state.delivery_ratio > 0.8


def test_urgent_that_stops_being_rare_degrades_rather_than_taking_the_mesh_down():
    """URGENT is affordable because it is rare. Nothing enforces the rarity, so
    the failure has to be survivable: the limiter throttles the flood instead of
    letting it exhaust every buffer in the venue."""
    def run_urgent(every: int) -> object:
        return MeshSimulator(
            MeshSimConfig.crowd(seed=6, state_every_ticks=0, uplink_every_ticks=0,
                                urgent_every_ticks=every, buffer_capacity=4)
        ).run(80).by_class[MeshClass.URGENT]

    rare, flooded = run_urgent(20), run_urgent(1)
    assert flooded.created == 80 and rare.created == 4
    # The limiter binds: each message gets a smaller share of the radio.
    assert flooded.copies_per_message < rare.copies_per_message
    # Buffers overrun, which is the cost of flooding made visible...
    assert flooded.evictions > 0
    # ...and it degrades rather than collapsing.
    assert flooded.delivery_ratio > 0.5


# ------------------------------------------------------- custody transfer --

def test_a_refused_message_stays_with_the_sender():
    """The blocker: custody was transferred whatever the receiver did with it.

    `accept` returns a falsy outcome for four unrelated reasons, and the relay
    path ignored which one. On NO_ROOM the sender committed anyway — Prophet
    dropping its last copy, Spray-and-Wait deducting the transferred allowance —
    so the message existed nowhere afterwards. Silently: the transmission counted
    as sent and nothing recorded the deletion.
    """
    sender = node("sender")
    receiver = node("receiver", buffer_capacity=1)

    # Fill the receiver with URGENT, which STATE never displaces: EVICTION_ORDER
    # sacrifices STATE first, so a STATE offer into a full URGENT buffer is the
    # one that genuinely loses the eviction contest. Filling with STATE instead
    # would let the newcomer evict the filler and be stored, and the test would
    # be exercising eviction rather than refusal.
    filler = message(source="filler", sequence=99, traffic_class=MeshClass.URGENT)
    assert receiver.accept(filler, 0.0) is AcceptOutcome.STORED

    m = message(source="sender", sequence=1)
    assert sender.accept(m, 0.0) is AcceptOutcome.STORED
    held_before = sender.holds(key_of(m))
    assert held_before

    sender.advance(1.0, peers={receiver.id})
    receiver.advance(1.0, peers={sender.id})
    encounter(sender, receiver, 1.0)

    assert not receiver.holds(key_of(m)), "receiver had no room, so it cannot hold it"
    assert sender.holds(key_of(m)), (
        "SENDER MUST KEEP IT — the receiver refused, so this is the only copy"
    )
    assert sender.failed_handoffs >= 1, "the refusal must be counted, not swallowed"


def test_a_delivered_message_is_released_by_the_sender():
    """The other half, and the reason a bare bool could not express this.

    Handing a message to an uplink returns falsy — it was not STORED, it was
    DELIVERED. Treating that as a refusal would make the sender go on relaying
    traffic that already reached the internet.
    """
    sender = node("sender")
    uplink = node("uplink", online=True)

    m = message(source="sender", sequence=1)
    assert sender.accept(m, 0.0) is AcceptOutcome.STORED

    sender.advance(1.0, peers={uplink.id})
    uplink.advance(1.0, peers={sender.id})
    encounter(sender, uplink, 1.0)

    assert len(uplink.uplinked) == 1, "it reached the internet"
    assert not sender.holds(key_of(m)), (
        "sender must let go: the journey is over and re-relaying costs battery "
        "spreading a message whose job is done"
    )
    assert sender.failed_handoffs == 0, "a delivery is not a failed handoff"


def test_outcomes_partition_into_safe_and_at_risk():
    """held_somewhere is the whole custody rule, so it is worth asserting directly."""
    safe = {AcceptOutcome.STORED, AcceptOutcome.DUPLICATE, AcceptOutcome.DELIVERED}
    at_risk = {AcceptOutcome.EXPIRED, AcceptOutcome.NO_ROOM}
    assert safe | at_risk == set(AcceptOutcome)
    assert all(o.held_somewhere for o in safe)
    assert not any(o.held_somewhere for o in at_risk)
    # Truthiness is the narrower question and must not be confused with safety.
    assert bool(AcceptOutcome.STORED) and not bool(AcceptOutcome.DELIVERED)
