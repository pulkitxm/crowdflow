"""Private unique counting and capture–recapture participation estimation."""

from __future__ import annotations

import pytest

from crowdflow_core.participation import (
    PrivateBottomK,
    PrivateCountConfig,
    estimate_participation,
)

SECRET = b"one-release-epoch-secret"
EPOCH = "british-gp-race"
CONFIG = PrivateCountConfig(k=64, epsilon=2.0)


def sketch(items, *, reverse=False):
    result = PrivateBottomK.create(SECRET, epoch=EPOCH, config=CONFIG)
    values = list(items)
    if reverse:
        values.reverse()
    for value in values:
        result.add(SECRET, str(value))
    return result


def test_sketch_is_order_and_duplicate_invariant():
    items = list(range(500))
    forward = sketch(items + items)
    backward = sketch(items, reverse=True)
    assert forward.hashes == backward.hashes
    assert forward.estimate == backward.estimate


def test_merge_is_associative_commutative_and_idempotent():
    a = sketch(range(0, 300))
    b = sketch(range(200, 500))
    c = sketch(range(450, 700))

    assert a.merge(b).hashes == b.merge(a).hashes
    assert a.merge(a).hashes == a.hashes
    assert a.merge(b).merge(c).hashes == a.merge(b.merge(c)).hashes


def test_sketch_retains_only_k_hashes_and_no_identifiers():
    ids = [f"person-{index}-recognisable" for index in range(10_000)]
    result = sketch(ids)
    assert len(result.hashes) <= CONFIG.k
    rendered = repr(result) + repr(result.hashes)
    assert all(identifier not in rendered for identifier in ids[:10])


def test_different_epoch_secret_cannot_be_merged_or_used_accidentally():
    first = sketch(range(100))
    other_secret = b"different-secret"
    second = PrivateBottomK.create(other_secret, epoch=EPOCH, config=CONFIG)
    second.add(other_secret, "person")
    with pytest.raises(ValueError, match="different epochs"):
        first.merge(second)
    with pytest.raises(ValueError, match="secret"):
        first.add(other_secret, "person")


def test_unique_estimate_is_close_on_a_seeded_population():
    result = sketch(range(5_000))
    # Bottom-k's expected relative error at k=64 is about 13%; this broad
    # statistical check catches broken scaling/downsampling without fitting the
    # implementation to one hash draw.
    assert result.estimate == pytest.approx(5_000, rel=0.35)


def test_intersection_comes_from_sketch_union_not_stored_ids():
    first = sketch(range(0, 1_000))
    second = sketch(range(600, 1_600))
    assert first.intersection_estimate(second) == pytest.approx(400, rel=0.6)


def test_capture_recapture_recovers_population_and_participation():
    # Deterministic independent-ish captures from a 2,000-device population.
    population = range(2_000)
    first_ids = [person for person in population if person % 2 == 0]
    second_ids = [person for person in population if person % 3 != 0]
    app_ids = [person for person in population if person % 5 == 0]

    estimate = estimate_participation(
        sketch(first_ids),
        sketch(second_ids),
        app_nodes=sketch(app_ids),
    )
    assert estimate is not None
    assert estimate.population == pytest.approx(2_000, rel=0.6)
    assert estimate.participation_rate == pytest.approx(0.2, rel=0.7)
    assert "private-bottom-k" in estimate.method


def test_no_overlap_returns_unknown_not_a_percentage():
    first = sketch(range(0, 100))
    second = sketch(range(10_000, 10_100))
    assert estimate_participation(first, second, app_nodes=10.0) is None


def test_config_rejects_an_invalid_privacy_budget():
    with pytest.raises(ValueError):
        PrivateCountConfig(epsilon=0)
    with pytest.raises(ValueError):
        PrivateCountConfig(k=1)
