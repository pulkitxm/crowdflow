"""Geo-indistinguishability, applied on the device before anything is stored.

Andres et al. (CCS 2013): a mechanism is eps-geo-indistinguishable if any two
true locations within distance d produce reported locations whose distributions
differ by at most a factor e^(eps*d). Equivalently, at radius r the report is
l-private with l = eps*r — an adversary who sees the report cannot tell where in
that radius the user actually was, no matter what else they know.

The planar Laplace mechanism achieves it: draw an angle uniformly, and a radius
from the polar Laplace whose inverse CDF is

    r(p) = -(1/eps) * (W_{-1}((p - 1) / e) + 1)

where W_{-1} is the lower branch of the Lambert W function.

Two things about WHERE this runs, which are the whole design:

  * **Before storage, not before transmission.** Noise added on the way out
    protects nothing: the true trace was on disk, and disks are seized, backed up
    and subpoenaed. The unnoised position exists only as a local variable.
  * **The fragment records the epsilon it was built with.** A privacy claim
    detached from the data it describes cannot be checked, and a pipeline that
    silently lowers epsilon looks identical to one that does not.

And the claim this makes possible, which the tests have to demonstrate rather
than assert: strong per-user privacy is not traded against an accurate map. The
noise is zero-mean and independent per fragment, so an aggregate over n fragments
recovers the true density with error falling as 1/sqrt(n). One person is deniable
AND ten thousand people are measurable — because the map was never a function of
any one of them.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from crowdflow_contracts import (
    ASSUMED_FRAGMENT_MAX_DURATION_S,
    GEOIND_EPSILON_VENUE,
    GEOIND_PRIVACY_LEVEL,
    Position,
    TraceFragment,
)

_W_LOWER_BOUND = -800.0
"""Search floor for the lower Lambert branch. W_{-1}(x) reaches -800 only as x
approaches zero from below by e^-800, which is many hundreds of orders of
magnitude below any double a uniform sample can produce. Not a tolerance: a
bracket."""


def lambert_w_minus1(x: float) -> float:
    """Lower branch of Lambert W: the w <= -1 solving w*e^w = x, for x in [-1/e, 0).

    Bisection rather than Newton on purpose. On this branch g(w) = ln(-w) + w is
    strictly monotonic, so bisection cannot diverge, and the alternative — a
    Newton iteration seeded by an asymptotic expansion — fails near the branch
    point at -1/e, which is exactly where p is small and the noise is small, i.e.
    the common case. A hundred halvings of an 800-wide bracket is far below
    double precision; the cost is irrelevant beside sampling itself.
    """
    if not -1 / math.e <= x < 0:
        raise ValueError(f"W_-1 is defined on [-1/e, 0), got {x}")
    if x == -1 / math.e:
        return -1.0

    target = math.log(-x)
    low, high = _W_LOWER_BOUND, -1.0
    for _ in range(100):
        mid = (low + high) / 2.0
        if math.log(-mid) + mid < target:
            low = mid
        else:
            high = mid
    return (low + high) / 2.0


def noise_radius_for(epsilon: float, privacy_level: float = GEOIND_PRIVACY_LEVEL) -> float:
    """Radius r at which the mechanism is `privacy_level`-private: r = l / eps."""
    return privacy_level / epsilon


def expected_displacement_m(epsilon: float) -> float:
    """Mean distance the planar Laplace moves a point: E[r] = 2 / eps.

    Derived, not measured — it is the mean of the polar Laplace density
    eps^2 * r * e^(-eps*r). Stated here because it is the honest answer to "how
    wrong is one fragment", and it is much larger than people expect."""
    return 2.0 / epsilon


def planar_laplace(
    point: Position, epsilon: float, rng: random.Random
) -> Position:
    """Perturb one point. Independent draw per point: no shared secret, no state.

    Independence is what keeps the aggregate unbiased. It is also, deliberately,
    what makes a long correlated sequence leak more than a short one — which is
    why fragments are capped in duration rather than being trusted to epsilon
    alone.
    """
    theta = rng.uniform(0.0, 2.0 * math.pi)
    p = rng.random()
    radius = -(lambert_w_minus1((p - 1.0) / math.e) + 1.0) / epsilon
    return Position(
        x=point.x + radius * math.cos(theta),
        y=point.y + radius * math.sin(theta),
    )


@dataclass(frozen=True)
class FragmentPolicy:
    """The privacy parameters a device is configured with.

    A dataclass rather than arguments so that there is exactly one object to log,
    to show in the app's privacy screen, and to compare against what the
    fragments actually claim.
    """

    epsilon: float = GEOIND_EPSILON_VENUE
    max_duration_s: float = ASSUMED_FRAGMENT_MAX_DURATION_S
    privacy_level: float = GEOIND_PRIVACY_LEVEL

    @property
    def radius_m(self) -> float:
        return noise_radius_for(self.epsilon, self.privacy_level)


def noise_fragment(
    points: list[Position],
    t_start: float,
    t_end: float,
    rng: random.Random,
    policy: FragmentPolicy | None = None,
    fragment_id: str | None = None,
) -> TraceFragment:
    """Build a TraceFragment from a true path. The true path does not survive.

    Raises rather than truncating when the span exceeds the policy: a fragment
    longer than the cap is a linkability risk, and quietly trimming it would hide
    a caller that is accumulating a trace it should not have.
    """
    policy = policy or FragmentPolicy()
    if len(points) < 2:
        raise ValueError("a fragment needs at least two points to be a path")
    if t_end - t_start > policy.max_duration_s:
        raise ValueError(
            f"fragment spans {t_end - t_start:.0f}s, over the {policy.max_duration_s:.0f}s "
            "cap: epsilon bounds what one point reveals, not what a long "
            "correlated sequence reveals"
        )

    noised = [planar_laplace(p, policy.epsilon, rng) for p in points]
    return TraceFragment(
        fragment_id=fragment_id or f"frag-{rng.getrandbits(64):016x}",
        points=noised,
        t_start=t_start,
        t_end=t_end,
        epsilon=policy.epsilon,
        noise_radius_m=policy.radius_m,
    )


def aggregate_density(
    fragments: list[TraceFragment], cell_m: float
) -> dict[tuple[int, int], int]:
    """Count noised points per square cell — the map refinement estimator.

    This is the function the privacy claim is about. It never looks at a fragment
    individually and never needs to: every fragment contributes a vote whose error
    is zero-mean, so the cell counts converge on the true ones at 1/sqrt(n) while
    no single vote says anything reliable about the person who cast it.
    """
    counts: dict[tuple[int, int], int] = {}
    for fragment in fragments:
        for point in fragment.points:
            cell = (math.floor(point.x / cell_m), math.floor(point.y / cell_m))
            counts[cell] = counts.get(cell, 0) + 1
    return counts
