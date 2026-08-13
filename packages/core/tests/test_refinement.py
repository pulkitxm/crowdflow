"""Venue refinement tests.

The defects these guard against all have the same shape: refinement inventing a
fact. A path across a fence because two people's GNSS drifted, a "measured"
width that is really the privacy noise, a capacity set by one busy minute, a
real footpath deleted because the phones in that corner had flat batteries.
Every one of them produces a map that looks better than the import and routes
people worse.
"""

from __future__ import annotations

import math
import random

import pytest
from crowdflow_contracts import (
    CircuitPack,
    CoordinateFrame,
    Edge,
    MEASURED_SAMPLE_FLOOR,
    Position,
    Provenance,
    Sourced,
    TraceFragment,
    Zone,
    ZoneKind,
)

from crowdflow_core.refinement import (
    Traversal,
    UsageVerdict,
    audit,
    discover,
    match_all,
    measure_capacity,
    measure_edges,
    measure_width,
    propose_edges,
    refine,
)
from crowdflow_core.state.flow import capacity_flow

PARTICIPATION = 0.2
"""Stands in for a measured participation rate. The tests care that it is
applied, not what it is."""


# ------------------------------------------------------------------ fixtures --

def _pack(
    zones: dict[str, tuple[float, float]],
    edges: list[tuple[str, str, str]],
    *,
    width: float = 4.0,
    provenance: Provenance = Provenance.ASSUMED,
) -> CircuitPack:
    zone_models = {
        zid: Zone(id=zid, kind=ZoneKind.CONCOURSE, position=Position(x=x, y=y))
        for zid, (x, y) in zones.items()
    }
    edge_models = {}
    for eid, a, b in edges:
        length = math.dist(zones[a], zones[b])
        edge_models[eid] = Edge(
            id=eid,
            source=a,
            destination=b,
            length_m=length,
            width_m=Sourced(value=width, provenance=provenance),
        )
    return CircuitPack(
        id="test",
        name="Test Circuit",
        geometry_source="test",
        track_length_m=1000.0,
        altitude_m=0.0,
        frame=CoordinateFrame(
            origin_lat=52.0,
            origin_lon=-1.0,
            track_bounds_m=(500.0, 500.0),
            venue_bounds_m=(-500.0, -500.0, 500.0, 500.0),
        ),
        zones=zone_models,
        edges=edge_models,
    )


def _fragment(
    fid: str,
    points: list[tuple[float, float]],
    *,
    t_start: float = 0.0,
    t_end: float = 60.0,
    noise: float = 1.0,
) -> TraceFragment:
    return TraceFragment(
        fragment_id=fid,
        points=[Position(x=x, y=y) for x, y in points],
        t_start=t_start,
        t_end=t_end,
        # Keep the synthetic radius/epsilon internally consistent with the
        # contract's privacy level; real fragments always carry both.
        epsilon=1.3862943611198906 / noise,
        noise_radius_m=noise,
    )


def _walk(
    a: tuple[float, float],
    b: tuple[float, float],
    *,
    steps: int,
    offset: float,
    trim: float = 0.0,
) -> list[tuple[float, float]]:
    """Points along a->b, displaced `offset` metres perpendicular to it.

    `trim` keeps the walk clear of the endpoints so the anchors are found by
    proximity rather than by landing exactly on a zone.
    """
    dx, dy = b[0] - a[0], b[1] - a[1]
    span = math.hypot(dx, dy)
    nx, ny = -dy / span, dx / span
    out = []
    for i in range(steps):
        t = trim + (1 - 2 * trim) * i / (steps - 1)
        out.append((a[0] + dx * t + nx * offset, a[1] + dy * t + ny * offset))
    return out


def _corridor_pack() -> CircuitPack:
    """A right-angled walk with an obvious diagonal nobody mapped."""
    return _pack(
        {"a": (0.0, 0.0), "b": (200.0, 0.0), "c": (200.0, 200.0)},
        [("e-ab", "a", "b"), ("e-bc", "b", "c")],
    )


def _diagonal_fragments(
    count: int, *, noise: float = 1.0, spread: float = 3.0, seed: int = 7
) -> list[TraceFragment]:
    rng = random.Random(seed)
    return [
        _fragment(
            f"frag-{i}",
            _walk((0.0, 0.0), (200.0, 200.0), steps=12, offset=rng.uniform(-spread, spread),
                  trim=0.08),
            t_start=float(i * 10),
            t_end=float(i * 10 + 200),
            noise=noise,
        )
        for i in range(count)
    ]


# -------------------------------------------------------------------- match --

def test_a_walk_along_a_mapped_edge_matches_that_edge():
    pack = _corridor_pack()
    matched = match_all(
        pack, [_fragment("f", _walk((0, 0), (200, 0), steps=10, offset=0.5, trim=0.05))]
    )
    assert all(m.on_graph for m in matched[0].matches)
    assert {t.edge_id for t in matched[0].traversals} == {"e-ab"}


def test_match_tolerance_is_read_off_the_fragment_not_tuned():
    """A fragment that declares more noise is given more slack — and a tight one
    is not. Tuning a single tolerance would make one of these two wrong."""
    pack = _corridor_pack()
    offset = 6.0  # beyond half of the 4 m width, within 2 + 6 of a noisy fragment
    walk = _walk((0, 0), (200, 0), steps=8, offset=offset, trim=0.05)
    tight = match_all(pack, [_fragment("tight", walk, noise=1.0)])[0]
    noisy = match_all(pack, [_fragment("noisy", walk, noise=6.0)])[0]
    assert not any(m.on_graph for m in tight.matches)
    assert all(m.on_graph for m in noisy.matches)


def test_traversal_speed_comes_from_distance_over_time():
    pack = _corridor_pack()
    matched = match_all(
        pack, [_fragment("f", _walk((0, 0), (200, 0), steps=11, offset=0.0, trim=0.05),
                         t_start=0.0, t_end=180.0)]
    )
    traversal = matched[0].traversals[0]
    assert traversal.distance_m == pytest.approx(180.0, rel=0.01)
    assert traversal.speed_ms == pytest.approx(1.0, rel=0.01)


# ------------------------------------------------------------- desire lines --

def test_discovers_a_repeatedly_walked_shortcut():
    pack = _corridor_pack()
    fragments = _diagonal_fragments(40)
    lines = discover(pack, fragments)

    assert len(lines) == 1
    line = lines[0]
    assert line.key == ("a", "c")
    assert line.support == 40
    assert line.is_trustworthy
    # The imported walk is the two sides of the triangle; the shortcut is the
    # hypotenuse, so the saving is the difference and the ratio is about sqrt(2).
    assert line.observed_length_m == pytest.approx(2 * 200 * math.sqrt(2) / 2, rel=0.1)
    assert line.graph_walk_m == pytest.approx(400.0, rel=0.01)
    assert line.detour_ratio == pytest.approx(math.sqrt(2), rel=0.1)


def test_a_shortcut_two_people_took_is_not_a_desire_line():
    """Repeatedly is the whole word. Two crossings is an anecdote, and building
    an edge from it puts a corridor on the map that may not exist."""
    pack = _corridor_pack()
    lines = discover(pack, _diagonal_fragments(2))
    assert lines == []

    below = discover(pack, _diagonal_fragments(MEASURED_SAMPLE_FLOOR - 1))
    assert below == []


def test_support_below_the_sample_floor_is_reported_but_never_proposed():
    pack = _corridor_pack()
    lines = discover(pack, _diagonal_fragments(9), min_support=5)
    assert len(lines) == 1
    assert lines[0].support == 9
    assert not lines[0].is_trustworthy
    assert propose_edges(lines) == {}, "nine traces must not become a mapped corridor"


def test_a_single_stray_point_is_jitter_not_a_discovery():
    """One point off the path between two on it is GNSS drift. A desire line
    built from it would cut a corridor through whatever it drifted over."""
    pack = _corridor_pack()
    points = _walk((0, 0), (200, 0), steps=9, offset=0.0)
    points[4] = (points[4][0], 60.0)  # one point flung sideways
    lines = discover(pack, [_fragment(f"f{i}", points) for i in range(40)])
    assert lines == []


def test_a_pair_the_map_already_connects_is_not_a_discovery():
    """Walking beside a mapped edge is a matching miss, not an unmapped path."""
    pack = _corridor_pack()
    far = [
        _fragment(f"f{i}", _walk((0, 0), (200, 0), steps=10, offset=40.0, trim=0.05))
        for i in range(40)
    ]
    lines = discover(pack, far)
    assert all(line.key != ("a", "b") for line in lines)


def test_a_shortcut_within_the_noise_is_not_a_saving():
    """If the imported walk is longer only by less than the privacy noise, the
    'saving' is indistinguishable from the noise that produced it."""
    # Anchors almost in line, so the diagonal barely beats the imported walk.
    pack = _pack(
        {"a": (0.0, 0.0), "b": (100.0, 0.0), "c": (200.0, 1.0)},
        [("e-ab", "a", "b"), ("e-bc", "b", "c")],
    )
    fragments = [
        _fragment(
            f"f{i}",
            _walk((0.0, 0.0), (200.0, 1.0), steps=12, offset=8.0, trim=0.1),
            noise=20.0,
        )
        for i in range(40)
    ]
    assert discover(pack, fragments) == []


def test_an_unmeasurable_width_is_never_proposed_as_an_edge():
    """A corridor whose spread is inside its own privacy noise has no measured
    width. Proposing it anyway would launder a guess into the evidence."""
    pack = _corridor_pack()
    fragments = _diagonal_fragments(40, noise=25.0, spread=0.2)
    lines = discover(pack, fragments)
    assert lines and lines[0].support == 40
    assert lines[0].width is None
    assert propose_edges(lines) == {}


def test_a_proposed_edge_carries_a_measured_width_and_its_sample_count():
    pack = _corridor_pack()
    lines = discover(pack, _diagonal_fragments(40))
    proposed = propose_edges(lines)
    assert len(proposed) == 1
    edge = next(iter(proposed.values()))
    assert edge.width_m.provenance is Provenance.MEASURED
    assert edge.width_m.samples == 40
    assert edge.width_m.is_trustworthy


# ---------------------------------------------------------------- capacity --

def _corridor_traffic(
    count: int,
    *,
    span_s: float = 600.0,
    duration_s: float = 150.0,
    noise: float = 1.0,
    spread: float = 2.5,
) -> list[TraceFragment]:
    """Walkers along the mapped a->b corridor, trimmed clear of the junctions.

    A point sitting exactly on zone b is genuinely on both incident edges, so
    the fixture keeps away from the ends; that ambiguity is the matcher being
    right, not a bug to design around.
    """
    rng = random.Random(3)
    out = []
    for i in range(count):
        start = span_s * i / count
        out.append(
            _fragment(
                f"t{i}",
                _walk((0, 0), (200, 0), steps=10, offset=rng.uniform(-spread, spread),
                      trim=0.05),
                t_start=start,
                t_end=start + duration_s,
                noise=noise,
            )
        )
    return out


def test_the_width_estimator_converts_privacy_radius_to_axis_sigma():
    """Radius is not sigma.

    Uniform offsets over +/-3 m have sigma 1.732. A one-metre
    geo-indistinguishability radius at privacy level ln(4) implies planar-Laplace
    axis sigma sqrt(3)/ln(4) = 1.249 m, leaving a corrected corridor width near
    4.14 m. Subtracting the radius directly produced a different, unjustified
    4.9 m answer.
    """
    offsets = [-3.0 + 6.0 * i / 199 for i in range(200)]
    traversals = [
        Traversal(
            edge_id="e", fragment_id=f"f{i}", t_start=0.0, t_end=0.0,
            distance_m=10.0, noise_radius_m=1.0,
            signed_offsets_m=offsets[i * 4 : i * 4 + 4],
        )
        for i in range(50)
    ]
    width, note = measure_width(traversals, imported=None)
    assert note is None
    assert width.value == pytest.approx(4.14, abs=0.2)
    assert width.value < 6.0, "the raw spread must not be reported as the width"


def test_planar_laplace_epsilon_is_used_when_available():
    offsets = [-3.0 + 6.0 * i / 199 for i in range(200)]
    traversals = [
        Traversal(
            edge_id="e",
            fragment_id=f"f{i}",
            t_start=0.0,
            t_end=0.0,
            distance_m=10.0,
            noise_radius_m=50.0,
            epsilon=1.0,
            signed_offsets_m=offsets[i * 4 : i * 4 + 4],
        )
        for i in range(50)
    ]
    width, note = measure_width(traversals, imported=None)
    assert note is None
    assert width.value > 0


def test_measurement_replaces_an_assumed_width_with_a_measured_one():
    pack = _corridor_pack()
    matched = match_all(pack, _corridor_traffic(40))
    measurements = measure_edges(pack, matched, PARTICIPATION)

    m = measurements["e-ab"]
    assert pack.edges["e-ab"].width_m.provenance is Provenance.ASSUMED
    assert m.width.provenance is Provenance.MEASURED
    assert m.width.samples == 40
    assert m.improves_width
    assert m.width.value > 0
    assert "de-biased" in (m.width.note or "")


def test_nine_traces_are_not_nine_thousand():
    """Sample count is fragments, not points. Counting points would make nine
    walkers sampled at 1 Hz look like a settled measurement."""
    pack = _corridor_pack()
    fragments = _corridor_traffic(9)
    matched = match_all(pack, fragments)
    total_points = sum(len(m.matches) for m in matched)
    m = measure_edges(pack, matched, PARTICIPATION)["e-ab"]

    assert total_points > 50
    assert m.fragments == 9
    assert m.width.samples == 9
    assert not m.width.is_trustworthy
    assert not m.improves_width
    assert any("below the" in note for note in m.notes)


def test_an_untrustworthy_measurement_does_not_overwrite_the_import():
    """A measurement below the sample floor is a second guess with better
    manners, not an upgrade. The imported width stands."""
    pack = _corridor_pack()
    report = refine(pack, _corridor_traffic(9), PARTICIPATION)

    assert report.measurements["e-ab"].width.provenance is Provenance.MEASURED
    assert report.refined_edges == {}
    assert report.apply(pack).edges["e-ab"].width_m is pack.edges["e-ab"].width_m


def test_capacity_is_sustained_flow_not_one_busy_minute():
    pack = _corridor_pack()
    matched = match_all(pack, _corridor_traffic(60))
    m = measure_edges(pack, matched, PARTICIPATION)["e-ab"]

    assert m.capacity_flow_ped_m_min is not None
    assert m.capacity_flow_ped_m_min.provenance is Provenance.MEASURED
    assert m.capacity_flow_ped_m_min.value <= m.peak_bin_flow_ped_m_min


def test_trusted_capacity_is_written_back_to_the_edge():
    pack = _corridor_pack()
    report = refine(pack, _corridor_traffic(60), PARTICIPATION)
    measurement = report.measurements["e-ab"].capacity_flow_ped_m_min
    assert measurement is not None and measurement.is_trustworthy
    applied = report.apply(pack)
    assert applied.edges["e-ab"].capacity_flow_ped_m_min == measurement


def test_too_short_an_observation_yields_no_capacity_at_all():
    """A minute of data cannot establish what a corridor sustains. Saying so
    beats publishing a number that will be exceeded quietly."""
    pack = _corridor_pack()
    matched = match_all(pack, _corridor_traffic(20, span_s=20.0, duration_s=20.0))
    m = measure_edges(pack, matched, PARTICIPATION)["e-ab"]
    assert m.capacity_flow_ped_m_min is None
    assert any("sustained" in note for note in m.notes)


def test_a_capacity_above_the_physical_maximum_is_refused():
    """Flow beyond the peak of the fundamental diagram cannot happen. Measuring
    one means the width or the participation rate is wrong, and the measurement
    must say that rather than propagate a fiction into routing."""
    pack = _corridor_pack()
    matched = match_all(pack, _corridor_traffic(300))
    traversals = [t for m in matched for t in m.traversals]
    _, max_flow = capacity_flow()

    capacity, peak, notes = measure_capacity(traversals, width_m=1.0, participation_rate=0.001)
    assert capacity is None
    assert peak > max_flow
    assert any("physical maximum" in note for note in notes)


def test_participation_rate_must_be_measured():
    with pytest.raises(ValueError):
        measure_capacity([], width_m=4.0, participation_rate=0.0)


def test_width_inside_the_privacy_noise_is_not_measurable():
    pack = _corridor_pack()
    matched = match_all(pack, _corridor_traffic(40, noise=30.0, spread=0.1))
    traversals = [t for m in matched for t in m.traversals]
    width, note = measure_width(traversals, pack.edges["e-ab"].width_m)
    assert width is pack.edges["e-ab"].width_m
    assert note is not None and "privacy radius" in note


# --------------------------------------------------------------- staleness --

def test_an_unwalked_edge_beside_busy_ones_is_a_removal_candidate():
    pack = _pack(
        {"a": (0.0, 0.0), "b": (200.0, 0.0), "c": (200.0, 200.0)},
        [("e-ab", "a", "b"), ("e-bc", "b", "c")],
    )
    usage = {u.edge_id: u for u in audit(pack, match_all(pack, _corridor_traffic(30)))}
    assert usage["e-ab"].verdict is UsageVerdict.USED
    assert usage["e-bc"].verdict is UsageVerdict.UNUSED
    assert usage["e-bc"].removal_candidate
    assert usage["e-bc"].neighbourhood_traversals > 0


def test_an_edge_nobody_could_see_is_unobserved_not_unused():
    """Invariant 5 applied to geometry. Zero traversals in a coverage hole is an
    absence of data, and deleting a real footpath on that basis is the worst
    outcome refinement can produce."""
    pack = _pack(
        {
            "a": (0.0, 0.0), "b": (200.0, 0.0),
            "far-1": (5000.0, 5000.0), "far-2": (5200.0, 5000.0),
        },
        [("e-ab", "a", "b"), ("e-far", "far-1", "far-2")],
    )
    usage = {u.edge_id: u for u in audit(pack, match_all(pack, _corridor_traffic(30)))}
    assert usage["e-far"].verdict is UsageVerdict.UNOBSERVED
    assert not usage["e-far"].removal_candidate
    assert "not evidence of absence" in usage["e-far"].describe()


def test_staleness_reports_and_never_deletes():
    pack = _pack(
        {"a": (0.0, 0.0), "b": (200.0, 0.0), "c": (200.0, 200.0)},
        [("e-ab", "a", "b"), ("e-bc", "b", "c")],
    )
    report = refine(pack, _corridor_traffic(40), PARTICIPATION)
    assert [u.edge_id for u in report.removal_candidates] == ["e-bc"]

    applied = report.apply(pack)
    assert "e-bc" in applied.edges, "a removal candidate must survive until a human says so"


# ------------------------------------------------------------------ report --

def test_refinement_never_mutates_the_imported_pack():
    pack = _corridor_pack()
    before = pack.model_dump_json()
    report = refine(pack, _diagonal_fragments(40) + _corridor_traffic(40), PARTICIPATION)

    assert pack.model_dump_json() == before
    assert report.desire_lines
    assert report.off_graph_share > 0


def test_proposed_edges_are_adopted_only_when_asked():
    pack = _corridor_pack()
    report = refine(pack, _diagonal_fragments(40) + _corridor_traffic(40), PARTICIPATION)
    assert report.proposed_edges

    default = report.apply(pack)
    assert set(default.edges) == set(pack.edges), "new geometry is an operator decision"

    adopted = report.apply(pack, adopt_proposals=True)
    assert set(adopted.edges) > set(pack.edges)
    assert not adopted.validate_integrity()


def test_summary_is_readable_and_counts_what_it_claims():
    pack = _corridor_pack()
    report = refine(pack, _diagonal_fragments(40) + _corridor_traffic(40), PARTICIPATION)
    text = "\n".join(report.summary())
    assert "desire lines" in text
    assert "unobserved" in text
