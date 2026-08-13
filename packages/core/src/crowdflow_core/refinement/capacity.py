"""Measured corridor width and measured capacity.

The imported graph guesses widths. `build_pack` tags those guesses ASSUMED, and
routing already taxes them — but a guess is only a placeholder for a measurement
that has not happened yet. This module makes the measurement.

**Width comes from the lateral spread of traces**, which is what
`standards.MEASURED_NOT_ASSUMED` says corridor_width must come from. People
distribute themselves across the usable width of a corridor, so if their offsets
from the centreline have standard deviation s, and a uniform spread across a
width w has standard deviation w/sqrt(12), then

    w = sqrt(12) * s

That is a derivation from an assumed *shape* of the distribution, not a tuned
coefficient. The assumption is stated rather than hidden: pedestrians do bunch
toward the middle in practice, which makes this estimate conservative — it will
under-report a wide corridor before it over-reports a narrow one, and
under-reporting width raises the computed density, which errs toward caution.

**The noise must be removed first.** The observed spread is the real spread
convolved with the privacy noise each fragment declares. Variances add, so the
de-biased spread is sqrt(s_obs^2 - s_noise^2) — and when that is not positive,
the corridor is narrower than the noise and the width is simply not measurable
from this data. That case returns the imported width untouched, with a note.
Producing a confident number there would be the worst outcome available.

**A known limitation, stated because it is not obvious.** Only points that
matched the edge contribute offsets, and a point matches within half the
*imported* width plus the noise radius. So a single pass can widen an edge by at
most twice the declared noise: a 3 m footpath the map has as 3 m cannot be shown
to be 12 m in one go. Refinement is iterative by construction — each adopted
width widens the window the next pass may observe through. The alternative,
matching with an unbounded tolerance, would attach every point to whichever edge
happened to be nearest and measure the gap between corridors as corridor.

**Capacity is observed peak sustained flow**, in the same ped/m/min unit the LOS
bands use, scaled from observed devices by the measured participation rate.
Sustained, not instantaneous: a single minute's spike is a sampling artefact,
and a capacity set by an artefact is a capacity that will be exceeded silently.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median

from crowdflow_contracts import (
    CircuitPack,
    Edge,
    MEASURED_SAMPLE_FLOOR,
    Provenance,
    Sourced,
)

from ..state.flow import capacity_flow
from .trace import MatchedFragment, Traversal

BIN_S = 60.0
"""Flow is defined per minute, so the counting bin is a minute. Definitional,
not a tuning parameter: any other bin would need converting back to this one."""

SUSTAINED_BINS = 3
"""How many consecutive minutes a flow must hold to count as sustained.

ASSUMED, with reasoning: a corridor's capacity is the load it carries without
breaking down, and one minute of arrivals can exceed that transiently while the
queue absorbs it. Three minutes is long enough that the queue would have shown,
short enough to sit inside a single egress surge. It is a judgement about
timescale and is exposed so it can be argued with; results carry the bin count
so a reader can see how much averaging happened.
"""

UNIFORM_SPREAD_TO_WIDTH = math.sqrt(12.0)
"""Standard deviation of a uniform distribution over width w is w/sqrt(12).
Derived, not chosen — see the module docstring for the assumption it rests on."""

PLANAR_LAPLACE_AXIS_SIGMA_FACTOR = math.sqrt(3.0)
"""Per-axis standard deviation of planar Laplace noise is sqrt(3)/epsilon.

Derived from the mechanism used in ``mesh.privacy``: the radial density is
``epsilon² r exp(-epsilon r)``, so E[r²] = 6/epsilon²; isotropy gives half that
variance on each axis. ``TraceFragment.noise_radius_m`` stores privacy radius
``l/epsilon``, not sigma, hence sigma = sqrt(3) * radius / l.
"""


@dataclass(frozen=True)
class EdgeMeasurement:
    """What the traces say about one imported edge."""

    edge_id: str
    fragments: int
    """Distinct trace fragments, NOT points. Nine traces sampled at 1 Hz make
    hundreds of points and still only nine independent observations."""

    width: Sourced
    capacity_flow_ped_m_min: Sourced | None
    free_speed: Sourced | None
    peak_bin_flow_ped_m_min: float = 0.0
    notes: list[str] = field(default_factory=list)

    @property
    def improves_width(self) -> bool:
        """Whether adopting this width is an upgrade on what the pack holds.

        A measurement that is not yet trustworthy is not an upgrade on an
        imported guess — it is a second guess with better manners.
        """
        return self.width.provenance is Provenance.MEASURED and self.width.is_trustworthy


def _stdev(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (n - 1))


def measure_width(
    traversals: list[Traversal], imported: Sourced | None, *, samples: int | None = None
) -> tuple[Sourced | None, str | None]:
    """Corridor width from the lateral spread of traces across it.

    Returns the width and a note when the measurement could not be made. The
    `imported` value is handed straight back in that case: refinement improves
    the map or leaves it alone, and never replaces a stated guess with a worse
    one. Pass None where there is no imported value to fall back to — a proposed
    corridor that cannot be measured should not exist at all.
    """
    offsets = [o for t in traversals for o in t.signed_offsets_m]
    count = samples if samples is not None else len({t.fragment_id for t in traversals})
    if len(offsets) < 2:
        return imported, "too few matched points to estimate lateral spread"

    observed = _stdev(offsets)
    # Each fragment declares its own noise; the population's noise scale is the
    # median of what contributed, so one heavily noised fragment cannot inflate
    # the correction for everyone else.
    privacy_radius = median([t.noise_radius_m for t in traversals])
    # Radius and standard deviation are different quantities. The old code
    # subtracted the geo-indistinguishability radius as if it were sigma, which
    # over-corrected width and could turn a measurable corridor into "unknown".
    # Epsilon is attached to every real fragment, so prefer it directly; the
    # radius/level conversion is only for manually constructed traversals.
    from crowdflow_contracts import GEOIND_PRIVACY_LEVEL

    epsilons = [t.epsilon for t in traversals if t.epsilon is not None]
    noise_sigma = (
        PLANAR_LAPLACE_AXIS_SIGMA_FACTOR / median(epsilons)
        if epsilons
        else PLANAR_LAPLACE_AXIS_SIGMA_FACTOR
        * privacy_radius
        / GEOIND_PRIVACY_LEVEL
    )
    corrected_var = observed * observed - noise_sigma * noise_sigma
    if corrected_var <= 0:
        return imported, (
            f"lateral spread ({observed:.2f} m) is within the planar-Laplace "
            f"axis sigma ({noise_sigma:.2f} m, from {privacy_radius:.2f} m privacy "
            "radius); width is not measurable from these traces"
        )

    width = UNIFORM_SPREAD_TO_WIDTH * math.sqrt(corrected_var)
    return (
        Sourced(
            value=round(width, 2),
            provenance=Provenance.MEASURED,
            samples=count,
            note=(
                f"lateral spread of {count} trace fragments, de-biased for "
                f"{privacy_radius:.1f} m declared privacy radius "
                f"({noise_sigma:.1f} m axis sigma)"
            ),
        ),
        None,
    )


def measure_free_speed(traversals: list[Traversal]) -> Sourced | None:
    """Median observed walking speed over an edge, or None if unmeasurable."""
    speeds = [s for s in (t.speed_ms for t in traversals) if s is not None and s > 0]
    if not speeds:
        return None
    return Sourced(
        value=round(median(speeds), 3),
        provenance=Provenance.MEASURED,
        samples=len(speeds),
        note="median observed traversal speed",
    )


def measure_capacity(
    traversals: list[Traversal],
    width_m: float,
    participation_rate: float,
) -> tuple[Sourced | None, float, list[str]]:
    """Observed peak sustained flow across an edge, in ped/m/min.

    Returns (capacity, peak_single_bin, notes). Both are reported because their
    difference is informative: a peak far above the sustained figure means the
    corridor was hit by a burst it did not carry for long.
    """
    if not 0 < participation_rate <= 1:
        raise ValueError("participation_rate must be measured and in (0, 1]")
    if not traversals:
        return None, 0.0, ["no traversals observed"]

    # A traversal occupies every minute-bin it overlaps: a walker present for
    # part of a minute contributed to that minute's flow.
    start = min(t.t_start for t in traversals)
    per_bin: dict[int, set[str]] = {}
    for t in traversals:
        first = int((t.t_start - start) // BIN_S)
        last = int((t.t_end - start) // BIN_S)
        for b in range(first, last + 1):
            per_bin.setdefault(b, set()).add(t.fragment_id)

    span = max(per_bin) + 1
    counts = [len(per_bin.get(b, ())) for b in range(span)]
    # Devices are not people: scale by the measured participation rate, exactly
    # as the state engine does, so the two never disagree about crowd size.
    flows = [c / participation_rate / max(width_m, 1e-6) for c in counts]
    peak_bin = max(flows)

    notes: list[str] = []
    if span < SUSTAINED_BINS:
        notes.append(
            f"only {span} minute(s) of observation; cannot establish a "
            f"{SUSTAINED_BINS}-minute sustained flow"
        )
        return None, round(peak_bin, 2), notes

    sustained = max(
        sum(flows[i : i + SUSTAINED_BINS]) / SUSTAINED_BINS
        for i in range(span - SUSTAINED_BINS + 1)
    )

    # Sanity ceiling from the fundamental diagram. A measured flow above the
    # physical maximum is not a fast corridor, it is a wrong width or a wrong
    # participation rate, and it must say so rather than propagate.
    _, max_flow = capacity_flow()
    if sustained > max_flow:
        notes.append(
            f"measured sustained flow {sustained:.1f} exceeds the physical maximum "
            f"{max_flow:.1f} ped/m/min; width or participation rate is wrong"
        )
        return None, round(peak_bin, 2), notes

    return (
        Sourced(
            value=round(sustained, 2),
            provenance=Provenance.MEASURED,
            samples=len({t.fragment_id for t in traversals}),
            note=(
                f"peak flow sustained over {SUSTAINED_BINS} consecutive minutes, "
                f"scaled by participation {participation_rate:.3f}"
            ),
        ),
        round(peak_bin, 2),
        notes,
    )


def measure_edges(
    pack: CircuitPack,
    matched: list[MatchedFragment],
    participation_rate: float,
) -> dict[str, EdgeMeasurement]:
    """Measure every edge the traces actually touched."""
    by_edge: dict[str, list[Traversal]] = {}
    for m in matched:
        for t in m.traversals:
            by_edge.setdefault(t.edge_id, []).append(t)

    out: dict[str, EdgeMeasurement] = {}
    for edge_id, traversals in by_edge.items():
        edge = pack.edges[edge_id]
        fragments = len({t.fragment_id for t in traversals})
        measured, note = measure_width(traversals, edge.width_m, samples=fragments)
        width = measured or edge.width_m
        notes = [note] if note else []

        # Capacity is per metre of width, so it must use the best width known —
        # the measured one where it is trustworthy, the imported one otherwise.
        width_for_flow = width.value if width.is_trustworthy else edge.width_m.value
        capacity, peak_bin, cap_notes = measure_capacity(
            traversals, width_for_flow, participation_rate
        )
        notes.extend(cap_notes)
        if fragments < MEASURED_SAMPLE_FLOOR:
            notes.append(
                f"{fragments} fragments is below the {MEASURED_SAMPLE_FLOOR}-sample "
                "floor; reported but not trusted"
            )

        out[edge_id] = EdgeMeasurement(
            edge_id=edge_id,
            fragments=fragments,
            width=width,
            capacity_flow_ped_m_min=capacity,
            free_speed=measure_free_speed(traversals),
            peak_bin_flow_ped_m_min=peak_bin,
            notes=notes,
        )
    return out


def apply_measurements(
    pack: CircuitPack, measurements: dict[str, EdgeMeasurement]
) -> dict[str, Edge]:
    """Return refined copies of the edges whose measurements are an upgrade.

    Returns edges, not a pack: adopting them is the caller's decision, and the
    caller is the only one who knows whether an operator has reviewed them.
    Nothing here mutates the imported structure.
    """
    refined: dict[str, Edge] = {}
    for edge_id, m in measurements.items():
        edge = pack.edges[edge_id]
        update: dict[str, object] = {}
        # Only a value the pack does not already trust is replaced. A width read
        # off a surveyed venue map is corroborated geometry; overwriting it with
        # a trace-derived estimate would be trading evidence for inference. The
        # target here is the ASSUMED width, which is a placeholder by definition.
        if m.improves_width and not edge.width_m.is_trustworthy:
            update["width_m"] = m.width
        if m.free_speed is not None and m.free_speed.is_trustworthy:
            update["free_speed_ms"] = m.free_speed
        if (
            m.capacity_flow_ped_m_min is not None
            and m.capacity_flow_ped_m_min.is_trustworthy
        ):
            update["capacity_flow_ped_m_min"] = m.capacity_flow_ped_m_min
        if update:
            refined[edge_id] = edge.model_copy(update=update)
    return refined
