"""Published constants, each with its source.

No magic numbers. Every threshold here cites a standard; anything that cannot be
cited must be measured at runtime instead. See plan/standards.md for the registry
and the reasoning.

The governing framework is Fruin's Level of Service for walkways, expressed as a
flow rate in pedestrians per metre of width per minute. It is the basis of most
crowd-safety practice, and its boundaries are the ones safety practitioners use --
which is why the system's alert thresholds are Fruin's numbers rather than ours.
"""

from __future__ import annotations

from enum import Enum

# --------------------------------------------------------------------------
# Fruin Level of Service, walkways.
# Source: Fruin, "Pedestrian Planning and Design" (1971).
# Boundaries via https://docs.idigitaltwin.org/docs/peddesign/service-level-analysis/
# Units: pedestrians per metre of width per minute.
# --------------------------------------------------------------------------

LOS_A_MAX = 23.0
"""Free flow; slower pedestrians can be bypassed."""

LOS_B_MAX = 33.0
"""Normal walking speed; bypassing possible in one-way flow."""

LOS_C_MAX = 49.0
"""Some speeds restricted; two-way flow needs frequent adjustment."""

LOS_D_MAX = 66.0
"""Majority of walking speeds restricted; frequent conflicts."""

LOS_E_MAX = 82.0
"""Frequent stoppages and interruptions to flow. Above this, flow breaks down.

Commonly cited as the UK Green Guide flow figure for level surfaces, which would
make this the same number the safety regulator uses. That correspondence is
UNVERIFIED against the current edition -- do not claim it publicly until someone
has read it. See plan/standards.md section 2.
"""

# --------------------------------------------------------------------------
# The three operational bands.
#
# Operators act on three states, so the six LOS grades collapse to three -- but
# on Fruin's boundaries, not ones we chose. The middle band is the entire
# product: below BUILDING there is nothing to do, above it it is already too late.
# --------------------------------------------------------------------------

BAND_NOMINAL_MAX = LOS_C_MAX   # 49.0 -- people walk at their chosen speed
BAND_BUILDING_MAX = LOS_E_MAX  # 82.0 -- restricted but flowing: the intervention window


class LOSBand(str, Enum):
    """Operational density band. Always rendered with its word and its number."""

    NOMINAL = "nominal"
    BUILDING = "building"
    CRITICAL = "critical"

    @property
    def label(self) -> str:
        return self.value.upper()

    @property
    def los_grades(self) -> str:
        return {"nominal": "A-C", "building": "D-E", "critical": "F"}[self.value]


def band_for_flow(flow_ped_m_min: float) -> LOSBand:
    """Classify a flow rate into an operational band.

    Args:
        flow_ped_m_min: pedestrians per metre of width per minute.

    The only place these boundaries are applied. If a band appears anywhere else
    in the codebase, it is a bug.
    """
    if flow_ped_m_min < BAND_NOMINAL_MAX:
        return LOSBand.NOMINAL
    if flow_ped_m_min < BAND_BUILDING_MAX:
        return LOSBand.BUILDING
    return LOSBand.CRITICAL


def los_grade_for_flow(flow_ped_m_min: float) -> str:
    """Full Fruin grade A-F, for the operator console. The app never shows this."""
    for grade, upper in (
        ("A", LOS_A_MAX),
        ("B", LOS_B_MAX),
        ("C", LOS_C_MAX),
        ("D", LOS_D_MAX),
        ("E", LOS_E_MAX),
    ):
        if flow_ped_m_min < upper:
            return grade
    return "F"


# --------------------------------------------------------------------------
# Pedestrian movement.
# Source: standard pedestrian planning figures; Fruin and subsequent replication.
# --------------------------------------------------------------------------

FREE_FLOW_SPEED_MS = 1.34
"""Free-flow walking speed, m/s. Used only as a prior -- per-zone observed speed
supersedes it wherever enough samples exist (plan/standards.md section 3)."""

JAM_DENSITY_PERSONS_M2 = 4.0
"""Jam density: ~0.25 m^2 per person. Flow approaches zero here."""

OBSERVED_HIGH_DENSITY_PERSONS_M2 = 4.7
"""Reported around large stadium events. Sanity ceiling for density estimates."""


# --------------------------------------------------------------------------
# Values that must be MEASURED, never assumed.
#
# Listed so that a reviewer can grep for them. Any literal standing in for one of
# these is a defect, not a default.
# --------------------------------------------------------------------------

MEASURED_NOT_ASSUMED = (
    "participation_rate",     # unique nodes / attendance, or capture-recapture
    "zone_capacity",          # observed peak sustained flow
    "corridor_width",         # lateral spread of traces
    "walking_speed",          # per-zone observed distribution
    "time_to_congestion",     # fitted to observed onset-to-saturation
    "prediction_confidence",  # node count, freshness, accuracy, stability
)


# --------------------------------------------------------------------------
# Evidence and inference.
#
# How many observations make a measurement, and how far from its own history a
# reading must sit before it is worth waking someone for. Both were previously
# bare literals inside the code that used them; a threshold nobody can find is a
# threshold nobody can argue with.
# --------------------------------------------------------------------------

MEASURED_SAMPLE_FLOOR = 30
"""Observations below which a MEASURED value is not yet trustworthy.

ASSUMED, with reasoning: thirty is the conventional point at which the sampling
distribution of a mean is treated as approximately normal, so it is the smallest
count at which quoting a mean and a spread is defensible. It is a convention, not
a measurement, which is exactly why it is named here rather than typed inline —
an edge refined by nine traces is not an edge refined by nine thousand, and the
line between them should be visible.
"""

MAD_TO_SIGMA = 1.4826
"""Scale factor making the median absolute deviation a consistent estimator of
the standard deviation for normally distributed data (1 / Phi^-1(3/4)).

Source: standard robust-statistics result; see Rousseeuw & Croux (1993)."""

MODIFIED_Z_OUTLIER = 3.5
"""Modified z-score above which a point is labelled an outlier.

Source: Iglewicz and Hoaglin, "How to Detect and Handle Outliers" (1993), as
carried in the NIST/SEMATECH e-Handbook section 1.3.5.17. Chosen over a mean and
standard deviation because a crowd series contains the very spikes being looked
for, and they drag a mean-based threshold up behind them."""


# --------------------------------------------------------------------------
# Density thresholds, DERIVED from the flow thresholds above.
#
# Fruin's LOS is stated as a flow rate, but flow is not monotonic in density:
# it rises, peaks at capacity, then collapses. A jammed corridor and an empty
# one both show low flow. So flow alone cannot classify a zone -- and worse, the
# LOS E/F boundary of 82 ped/m/min sits ABOVE the physical maximum of ~80.4,
# making a flow-defined CRITICAL band unreachable in principle.
#
# The fix is to classify on density, using the densities that produce Fruin's
# flow boundaries on the free-flow branch. Inverting the Greenshields relation
#
#     flow = 60 * v_free * d * (1 - d / jam)
#
# for a target flow F gives the quadratic
#
#     d^2 - jam*d + (F * jam) / (60 * v_free) = 0
#
# whose lower root is the free-flow-branch density. These are computed, not
# typed: change a source constant and the boundaries move with it.
# --------------------------------------------------------------------------

def density_for_flow(
    flow_ped_m_min: float,
    free_speed_ms: float = FREE_FLOW_SPEED_MS,
    jam_density: float = JAM_DENSITY_PERSONS_M2,
) -> float | None:
    """Free-flow-branch density that produces a given flow rate.

    Returns None if the flow is above the physical maximum — which is itself a
    useful answer, and how the 82 ped/m/min discrepancy was found.
    """
    import math

    c = (flow_ped_m_min * jam_density) / (60.0 * free_speed_ms)
    disc = jam_density * jam_density - 4.0 * c
    if disc < 0:
        return None
    return (jam_density - math.sqrt(disc)) / 2.0


CAPACITY_DENSITY = JAM_DENSITY_PERSONS_M2 / 2.0
"""Density at maximum flow. Beyond it, more people means LESS throughput —
the counter-intuitive fact the whole product rests on, and the reason a zone at
capacity is already critical however healthy its flow rate looks."""

DENSITY_NOMINAL_MAX = density_for_flow(BAND_NOMINAL_MAX) or 0.75
"""Density equivalent of the LOS C/D boundary, on the free-flow branch."""

DENSITY_BUILDING_MAX = CAPACITY_DENSITY
"""CRITICAL starts at capacity, not at a flow number.

Fruin's 82 ped/m/min is unreachable under this fundamental diagram (max 80.4),
so the boundary is taken at the flow maximum instead — which is the same event
the LOS E/F boundary was describing: the point at which flow stops improving and
begins to collapse."""


def band_for_density(persons_per_m2: float) -> LOSBand:
    """Classify by density. This is the authoritative classifier.

    `band_for_flow` remains valid for a zone known to be on the free-flow branch,
    but anything measured from real occupancy should use this one: it is
    single-valued, whereas flow is not.
    """
    if persons_per_m2 < DENSITY_NOMINAL_MAX:
        return LOSBand.NOMINAL
    if persons_per_m2 < DENSITY_BUILDING_MAX:
        return LOSBand.BUILDING
    return LOSBand.CRITICAL
