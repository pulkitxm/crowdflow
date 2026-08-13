"""Venue import tests.

The defects these guard against are the ones that produce a graph which *looks*
fine and routes people into fences or down footpaths that do not exist.
"""

from __future__ import annotations

import math

import pytest
from crowdflow_contracts import Provenance

from crowdflow_core.venue import (
    Frame,
    ElementKind,
    OsmNode,
    OsmWay,
    build_pack,
    parse,
    point_to_segment_distance,
    segments_intersect,
    width_for,
)



# ------------------------------------------------------------------ frame --

def test_projection_round_trips():
    f = Frame(52.063513, -1.024286)
    for lat, lon in [(52.07, -1.01), (52.0635, -1.0243), (52.088, -0.998)]:
        x, y = f.to_xy(lat, lon)
        back = f.to_latlon(x, y)
        assert back[0] == pytest.approx(lat, abs=1e-9)
        assert back[1] == pytest.approx(lon, abs=1e-9)


def test_origin_is_the_zero_point():
    f = Frame(52.0, -1.0)
    assert f.to_xy(52.0, -1.0) == (0.0, 0.0)


def test_a_degree_of_latitude_is_about_111km():
    f = Frame(52.0, -1.0)
    _, y = f.to_xy(53.0, -1.0)
    assert y == pytest.approx(111_133, rel=0.001)


def test_longitude_degrees_shrink_with_latitude():
    """If this is wrong, every east-west distance at a European circuit is ~60% too big."""
    equator = Frame(0.0, 0.0).to_xy(0.0, 1.0)[0]
    silverstone = Frame(52.0, 0.0).to_xy(52.0, 1.0)[0]
    assert silverstone < equator
    assert silverstone / equator == pytest.approx(math.cos(math.radians(52.0)), rel=1e-6)


def test_point_to_segment_uses_the_perpendicular_not_the_endpoints():
    assert point_to_segment_distance((5, 3), (0, 0), (10, 0)) == pytest.approx(3.0)
    assert point_to_segment_distance((-5, 0), (0, 0), (10, 0)) == pytest.approx(5.0)


def test_segment_intersection():
    assert segments_intersect((0, 0), (10, 10), (0, 10), (10, 0))
    assert not segments_intersect((0, 0), (1, 1), (5, 5), (6, 6))
    assert not segments_intersect((0, 0), (10, 0), (0, 1), (10, 1))


# -------------------------------------------------------------------- osm --

def test_barriers_beat_highways():
    """A way tagged both must be treated as a barrier, or the graph leaks through it."""
    assert ElementKind.BARRIER.value == "barrier"
    from crowdflow_core.venue.osm import classify_way
    assert classify_way({"barrier": "fence", "highway": "footway"}) is ElementKind.BARRIER
    assert classify_way({"barrier": "gate", "highway": "footway"}) is ElementKind.GATE
    assert classify_way({"highway": "footway"}) is ElementKind.WALKABLE
    assert classify_way({"building": "grandstand"}) is ElementKind.GRANDSTAND
    assert classify_way({"building": "house"}) is ElementKind.IGNORED


def test_width_records_whether_it_was_tagged_or_assumed():
    tagged = width_for({"highway": "footway", "width": "3.5"})
    assert tagged.value == 3.5 and tagged.provenance is Provenance.OSM

    assumed = width_for({"highway": "footway"})
    assert assumed.provenance is Provenance.ASSUMED
    assert not assumed.is_trustworthy

    junk = width_for({"highway": "footway", "width": "about 3"})
    assert junk.provenance is Provenance.ASSUMED


def test_parse_skips_geometryless_elements():
    ways, nodes = parse([
        {"type": "way", "id": 1, "tags": {"highway": "footway"}},                # no geometry
        {"type": "way", "id": 2, "tags": {"highway": "footway"},
         "geometry": [{"lat": 52.0, "lon": -1.0}, {"lat": 52.001, "lon": -1.0}]},
        {"type": "node", "id": 3, "tags": {"barrier": "gate"}},                  # no coords
    ])
    assert [w.osm_id for w in ways] == [2]
    assert nodes == []


# ------------------------------------------------------------------ build --

TRACK = [(52.0635 + i * 0.0004, -1.0243 + i * 0.0003) for i in range(30)]


def _way(osm_id, coords, tags):
    from crowdflow_core.venue.osm import classify_way
    return OsmWay(osm_id=osm_id, kind=classify_way(tags), coords=coords, tags=tags)


def _build(ways, nodes=(), **kw):
    return build_pack(
        circuit_id="test", name="Test", geometry_source="xx-0000",
        track_length_m=5000.0, altitude_m=100.0,
        track_latlon=TRACK, ways=list(ways), nodes=list(nodes), **kw,
    )


def test_a_path_becomes_edges():
    path = [(52.0640, -1.0240), (52.0645, -1.0235), (52.0650, -1.0230)]
    pack, stats = _build([_way(1, path, {"highway": "footway"})])
    assert stats.raw_edges == 2
    assert len(pack.edges) >= 1
    assert pack.validate_integrity() == []


def test_edge_crossing_a_fence_is_removed():
    """The defect this catches: a router confidently sending people through a fence."""
    path = [(52.0640, -1.0240), (52.0660, -1.0240)]
    fence = [(52.0650, -1.0245), (52.0650, -1.0235)]
    _, stats = _build([
        _way(1, path, {"highway": "footway"}),
        _way(2, fence, {"barrier": "fence"}),
    ])
    assert stats.barrier_removed == 1
    assert stats.gate_preserved == 0


def test_a_gate_reopens_a_barrier_crossing():
    path = [(52.0640, -1.0240), (52.0660, -1.0240)]
    fence = [(52.0650, -1.0245), (52.0650, -1.0235)]
    gate = OsmNode(osm_id=9, kind=ElementKind.GATE, coord=(52.0650, -1.0240),
                   tags={"barrier": "gate"})
    _, stats = _build(
        [_way(1, path, {"highway": "footway"}), _way(2, fence, {"barrier": "fence"})],
        nodes=[gate],
    )
    assert stats.gate_preserved == 1
    assert stats.barrier_removed == 0


def test_ways_far_from_the_track_are_clipped():
    near = [(52.0640, -1.0240), (52.0645, -1.0235)]
    far = [(52.5000, -1.5000), (52.5005, -1.4995)]
    _, stats = _build([
        _way(1, near, {"highway": "footway"}),
        _way(2, far, {"highway": "footway"}),
    ])
    assert stats.ways_clipped == 1


def test_degree_two_chains_collapse_into_corridors():
    """Every OSM vertex as a zone is geometrically faithful and operationally useless."""
    chain = [(52.0640 + i * 0.0002, -1.0240) for i in range(6)]
    pack, stats = _build([_way(1, chain, {"highway": "footway"})])
    assert stats.simplified_away > 0
    assert len(pack.zones) == 2  # only the two ends survive
    assert len(pack.edges) == 1


def test_merged_width_is_length_weighted_and_keeps_the_weakest_provenance():
    from crowdflow_contracts import Edge, Position, Sourced, Zone, ZoneKind
    from crowdflow_core.venue.build import simplify

    zones = {
        z: Zone(id=z, kind=ZoneKind.CONCOURSE, position=Position(x=i * 10.0, y=0.0))
        for i, z in enumerate(["a", "b", "c"])
    }
    edges = {
        "e1": Edge(id="e1", source="a", destination="b", length_m=100.0,
                   width_m=Sourced(value=2.0, provenance=Provenance.OSM)),
        "e2": Edge(id="e2", source="b", destination="c", length_m=300.0,
                   width_m=Sourced(value=6.0, provenance=Provenance.ASSUMED)),
    }
    zones, edges, collapsed = simplify(zones, edges, protected=set())
    assert collapsed == 1
    merged = next(iter(edges.values()))
    assert merged.length_m == 400.0
    assert merged.width_m.value == pytest.approx(5.0)          # (2*100 + 6*300)/400
    assert merged.width_m.provenance is Provenance.ASSUMED     # weakest wins


def test_semantic_zones_are_never_collapsed():
    """A gate is a place even when only two paths meet there."""
    chain = [(52.0640 + i * 0.0002, -1.0240) for i in range(6)]
    gate = OsmNode(osm_id=9, kind=ElementKind.GATE, coord=(52.0644, -1.02401),
                   tags={"barrier": "gate", "name": "Gate 2"})
    pack, _ = _build([_way(1, chain, {"highway": "footway"})], nodes=[gate])
    gates = [z for z in pack.zones.values() if z.kind.value == "gate"]
    assert len(gates) == 1
    assert gates[0].name == "Gate 2"


def test_distant_semantic_zones_are_dropped_not_stubbed():
    """An invented 900 m footpath is worse than an absent car park."""
    path = [(52.0640, -1.0240), (52.0645, -1.0235)]
    far_stand = [(52.0700, -1.0100), (52.0701, -1.0101), (52.0700, -1.0100)]
    pack, stats = _build([
        _way(1, path, {"highway": "footway"}),
        _way(2, far_stand, {"building": "grandstand"}),
    ])
    assert stats.unattached == 1
    assert not any(z.kind.value == "viewing" for z in pack.zones.values())


def test_a_nearby_stand_attaches_and_stays_connected():
    """The stub itself may be merged away by simplification — what must survive is
    the zone and its connectivity, not the intermediate edge."""
    path = [(52.0640, -1.0240), (52.0645, -1.0235)]
    stand = [(52.06405, -1.02395), (52.06406, -1.02396), (52.06405, -1.02395)]
    pack, stats = _build([
        _way(1, path, {"highway": "footway"}),
        _way(2, stand, {"building": "grandstand"}),
    ])
    assert stats.unattached == 0
    stands = [z for z in pack.zones.values() if z.kind.value == "viewing"]
    assert len(stands) == 1

    connected = {e.source for e in pack.edges.values()} | {
        e.destination for e in pack.edges.values()
    }
    assert stands[0].id in connected
    assert pack.validate_integrity() == []


def test_built_pack_passes_its_own_integrity_check():
    path = [(52.0640 + i * 0.0003, -1.0240 + i * 0.0002) for i in range(8)]
    pack, _ = _build([_way(1, path, {"highway": "footway"})])
    assert pack.validate_integrity() == []
