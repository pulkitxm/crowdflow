"""Anonymous participation estimation without a central identity database.

Two independent observation channels produce mergeable, order-invariant
Bottom-k sketches.  The sketch never stores a node id: each identifier is fed to
a keyed cryptographic hash on the device/mesh region and only the smallest hash
values survive.  Union is set union followed by the same k-minimum operation, so
arrival order, duplicates and mesh topology cannot change the result.

Privacy follows the black-box construction in Dickens, Thaler & Ting,
*Order-Invariant Cardinality Estimators Are Differentially Private* (NeurIPS
2022), Algorithms 1c/2a:

* independently downsample each real item with probability ``1-exp(-epsilon)``;
* initialize with enough disjoint phantom items to satisfy the minimum
  cardinality condition;
* estimate the sampled union, divide by the sampling probability, and subtract
  the phantom count.

The guarantee assumes the keyed hash remains secret for the release epoch. A new
epoch uses a new key; sketches from different epochs cannot be linked or merged.
Repeated releases consume privacy budget and are an adapter/policy concern, not
something this pure primitive hides.

Capture–recapture then estimates total attendance from two channel sketches and
their overlap using the Chapman correction. Participation is unique app nodes
divided by that estimate. If the channels have no overlap, or are not independent,
the honest answer is ``None`` rather than a plausible percentage.
"""

from __future__ import annotations

import hashlib
import heapq
import math
from dataclasses import dataclass, field

from crowdflow_contracts import (
    ASSUMED_PRIVATE_SKETCH_EPSILON,
    ASSUMED_PRIVATE_SKETCH_K,
    CAPTURE_RECAPTURE_MIN_OVERLAP,
    CAPTURE_RECAPTURE_MIN_SAMPLE,
)

_HASH_BITS = 64
_HASH_SPACE = 1 << _HASH_BITS
_PERSONALISATION = b"cf-count"
_PHANTOM_PREFIX = b"crowdflow-private-count-phantom:"


def _hash64(secret: bytes, value: bytes, *, purpose: bytes) -> int:
    """Keyed, domain-separated 64-bit hash suitable for KMV ordering."""
    digest = hashlib.blake2b(
        value,
        key=secret,
        digest_size=_HASH_BITS // 8,
        person=_PERSONALISATION,
        salt=purpose.ljust(16, b"\0")[:16],
    ).digest()
    return int.from_bytes(digest, "big")


@dataclass(frozen=True)
class PrivateCountConfig:
    """One release epoch's public sketch parameters."""

    k: int = ASSUMED_PRIVATE_SKETCH_K
    epsilon: float = ASSUMED_PRIVATE_SKETCH_EPSILON

    def __post_init__(self) -> None:
        if self.k < CAPTURE_RECAPTURE_MIN_SAMPLE:
            raise ValueError("k must retain at least two hashes")
        if self.epsilon <= 0:
            raise ValueError("epsilon must be positive")

    @property
    def sample_probability(self) -> float:
        return 1.0 - math.exp(-self.epsilon)

    @property
    def phantom_count(self) -> int:
        # Bottom-k has k_max = k. Algorithm 2a takes ceil(k / pi_0).
        return math.ceil(self.k / self.sample_probability)


@dataclass
class PrivateBottomK:
    """Mergeable pure-DP Bottom-k state for one secret release epoch.

    Internally ``_values`` is a max-heap encoded with negatives so adding an item
    is O(log k). The serialised state is only sorted hash values plus public
    parameters; raw identifiers and the secret never enter it.
    """

    config: PrivateCountConfig = field(default_factory=PrivateCountConfig)
    epoch: str = "default"
    _values: list[int] = field(default_factory=list, repr=False)
    _seen: set[int] = field(default_factory=set, repr=False)
    _phantom_hashes: set[int] = field(default_factory=set, repr=False)
    _key_id: bytes = field(default=b"", repr=False)

    @classmethod
    def create(
        cls,
        secret: bytes,
        *,
        epoch: str,
        config: PrivateCountConfig | None = None,
    ) -> PrivateBottomK:
        if not secret:
            raise ValueError("a non-empty per-epoch sketch secret is required")
        sketch = cls(
            config=config or PrivateCountConfig(),
            epoch=epoch,
            _key_id=hashlib.sha256(secret).digest()[:8],
        )
        # Phantom universe is domain-disjoint from real identifiers. It is
        # independently downsampled exactly like the real stream.
        for index in range(sketch.config.phantom_count):
            item = _PHANTOM_PREFIX + epoch.encode() + b":" + str(index).encode()
            ranked = sketch._add_identifier(secret, item, phantom=True)
            if ranked is not None:
                sketch._phantom_hashes.add(ranked)
        return sketch

    def _add_hash(self, value: int) -> None:
        if value in self._seen:
            return
        if len(self._values) < self.config.k:
            heapq.heappush(self._values, -value)
            self._seen.add(value)
            return
        largest = -self._values[0]
        if value >= largest:
            return
        removed = -heapq.heapreplace(self._values, -value)
        self._seen.remove(removed)
        self._seen.add(value)

    def _add_identifier(
        self, secret: bytes, identifier: bytes, *, phantom: bool
    ) -> int | None:
        domain = b"phantom" if phantom else b"real"
        sampling = _hash64(secret, identifier, purpose=b"sample-" + domain)
        if sampling / _HASH_SPACE >= self.config.sample_probability:
            return None
        ranked = _hash64(secret, identifier, purpose=b"rank-" + domain)
        self._add_hash(ranked)
        return ranked

    def add(self, secret: bytes, identifier: str | bytes) -> None:
        """Add one ephemeral identifier without retaining it."""
        if hashlib.sha256(secret).digest()[:8] != self._key_id:
            raise ValueError("secret does not belong to this sketch epoch")
        raw = identifier.encode() if isinstance(identifier, str) else identifier
        self._add_identifier(secret, raw, phantom=False)

    @property
    def hashes(self) -> tuple[int, ...]:
        return tuple(sorted(self._seen))

    @property
    def sampled_estimate(self) -> float:
        """KMV estimate of sampled real+phantom cardinality."""
        count = len(self._seen)
        if count < self.config.k:
            return float(count)
        threshold = max(self._seen) / _HASH_SPACE
        return (self.config.k - 1) / threshold

    @property
    def estimate(self) -> float:
        corrected = self.sampled_estimate / self.config.sample_probability
        return max(0.0, corrected - self.config.phantom_count)

    def merge(self, other: PrivateBottomK) -> PrivateBottomK:
        """Order-invariant union. Epoch and privacy parameters must match."""
        if (
            self.config != other.config
            or self.epoch != other.epoch
            or self._key_id != other._key_id
        ):
            raise ValueError("private sketches from different epochs/configs cannot merge")
        merged = PrivateBottomK(
            config=self.config,
            epoch=self.epoch,
            _phantom_hashes=self._phantom_hashes | other._phantom_hashes,
            _key_id=self._key_id,
        )
        for value in self._seen | other._seen:
            merged._add_hash(value)
        return merged

    def intersection_estimate(self, other: PrivateBottomK) -> float:
        """Coordinated-KMV Jaccard estimate of real-item overlap.

        Inclusion-exclusion of three noisy cardinality estimates produces a
        positive overlap even for disjoint sets. Instead, compare the coordinated
        retained hashes below the smaller sketch threshold. A cryptographic hash
        collision aside, disjoint captures have zero shared real samples and
        therefore return unknown rather than a fabricated recapture. Shared
        phantom initialization is removed before the Jaccard ratio.
        """
        merged = self.merge(other)  # validates compatibility too
        if not self._seen or not other._seen:
            return 0.0
        threshold = min(max(self._seen), max(other._seen))
        phantoms = self._phantom_hashes | other._phantom_hashes
        left = {value for value in self._seen if value <= threshold and value not in phantoms}
        right = {
            value for value in other._seen if value <= threshold and value not in phantoms
        }
        sampled_union = left | right
        if not sampled_union:
            return 0.0
        jaccard = len(left & right) / len(sampled_union)
        return jaccard * merged.estimate


@dataclass(frozen=True)
class ParticipationEstimate:
    population: float
    participation_rate: float
    first_capture: float
    second_capture: float
    overlap: float
    app_nodes: float
    method: str = "chapman-capture-recapture/private-bottom-k"


def estimate_participation(
    first: PrivateBottomK,
    second: PrivateBottomK,
    *,
    app_nodes: PrivateBottomK | float,
) -> ParticipationEstimate | None:
    """Chapman capture–recapture estimate, or None when evidence is insufficient.

    Channel independence and equal catchability are assumptions of the method,
    not properties code can infer. Callers must choose genuinely independent
    channels (for example, two disjoint gate/time samples) and surface the method
    alongside the result.
    """
    n1 = first.estimate
    n2 = second.estimate
    overlap = first.intersection_estimate(second)
    if (
        n1 < CAPTURE_RECAPTURE_MIN_SAMPLE
        or n2 < CAPTURE_RECAPTURE_MIN_SAMPLE
        or overlap < CAPTURE_RECAPTURE_MIN_OVERLAP
    ):
        return None

    # Chapman estimator: ((n1 + 1)(n2 + 1)/(m + 1)) - 1. It reduces the small
    # sample bias of Lincoln–Petersen and remains finite for sparse overlap.
    population = ((n1 + 1.0) * (n2 + 1.0) / (overlap + 1.0)) - 1.0
    app_count = app_nodes.estimate if isinstance(app_nodes, PrivateBottomK) else app_nodes
    if population <= 0 or app_count < 0:
        return None
    participation = min(1.0, app_count / population)
    return ParticipationEstimate(
        population=population,
        participation_rate=participation,
        first_capture=n1,
        second_capture=n2,
        overlap=overlap,
        app_nodes=app_count,
    )
