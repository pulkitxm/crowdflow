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
    "radio_range",            # walk-tested peer range in a standing crowd
    "hop_latency",            # observed discovery-to-transfer time per hop
    "uplink_coverage",        # fraction of nodes within reach of an uplink
)


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


# --------------------------------------------------------------------------
# Mesh transport — delay-tolerant routing parameters.
#
# Cited where the literature gives a number, ASSUMED_-prefixed where it is a
# deployment choice nobody has published. The prefix is greppable on purpose:
# every ASSUMED_ constant below is a claim this project is making, not one it
# is inheriting, and each carries its reasoning.
#
# Source: Lindgren, Doria & Schelen, "Probabilistic Routing in Intermittently
# Connected Networks" (SIGMOBILE MC2R 2003), standardised as RFC 6693.
# Source: Spyropoulos, Psounis & Raghavendra, "Spray and Wait" (WDTN 2005).
# Source: Andres, Bordenabe, Chatzikokolakis & Palamidessi,
#         "Geo-Indistinguishability" (ACM CCS 2013).
# --------------------------------------------------------------------------

ASSUMED_RADIO_RANGE_CROWD_M = 30.0
"""Usable peer-to-peer radio range in a dense standing crowd, metres.

BLE and Wi-Fi Aware are specified around 100 m line of sight. A crowd is not line
of sight: 2.4 GHz is absorbed by bodies, and the phone is in a pocket against
one. 30 m is ASSUMED as the working figure and is a simulator parameter
everywhere it appears, so a single measured walk-test replaces it."""

PROPHET_P_INIT = 0.75
"""Delivery-predictability increment on a direct encounter.

P(a,b) <- P(a,b) + (1 - P(a,b)) * P_INIT. Lindgren et al. section 3.1."""

PROPHET_BETA = 0.25
"""Transitivity scaling: how much of a peer's predictability rubs off.

P(a,c) <- P(a,c) + (1 - P(a,c)) * P(a,b) * P(b,c) * BETA. This term is why
routing toward *connectivity* needs no special case: with the uplink as the
destination, "how likely am I to meet someone who reaches the internet" is
computed by the same recursion as any other destination."""

PROPHET_GAMMA = 0.98
"""Aging factor per time unit: P <- P * GAMMA^k. A node met once an hour ago is
not the node you should hand a message to now."""


def prophet_time_unit_s(
    radio_range_m: float = ASSUMED_RADIO_RANGE_CROWD_M,
    walk_speed_ms: float = FREE_FLOW_SPEED_MS,
    gamma: float = PROPHET_GAMMA,
) -> float:
    """The 'time unit' GAMMA ages per. Derived, and it has to be.

    Lindgren et al. publish GAMMA but leave the unit it applies to unspecified,
    and RFC 6693 makes it configurable — so a literal here would be the one
    number in the protocol that came from nowhere. It is also the number that
    decides whether the protocol works at all: aging is what makes a stale
    acquaintance stop looking like a route, and if the half-life is long compared
    to the encounter rate then aging is a no-op, every node's predictability
    ratchets to 1, and the forwarding test degenerates into a coin flip on
    floating-point noise. Measured here: at a 17-minute half-life the median
    predictability was 0.99 and the interquartile range 0.01.

    The right timescale is how long an encounter stays evidence about who is
    nearby NOW, which is how long it takes a node's radio neighbourhood to turn
    over: range / walking speed. Setting the half-life to that and solving
    GAMMA^(t/unit) = 1/2 gives the unit.
    """
    import math

    half_life_s = radio_range_m / walk_speed_ms
    return half_life_s * math.log(1.0 / gamma) / math.log(2.0)


PROPHET_TIME_UNIT_S = prophet_time_unit_s()
"""~0.65 s at a 30 m range and 1.34 m/s, i.e. a 22-second half-life."""

ASSUMED_SPRAY_COPY_SCALING = 1.0
"""Constant of proportionality in L = k * sqrt(M) for Spray-and-Wait.

Spyropoulos et al. show the copy count needed to stay within a fixed factor of
optimal delay grows as sqrt(M) in the population M; they do not fix k for an
arbitrary deployment, so k is ASSUMED 1 and the resulting L is reported by the
simulator rather than trusted. Getting k wrong costs delay, not correctness."""


def spray_copies_for(reachable_nodes: int) -> int:
    """Spray-and-Wait copy bound L for a population of M reachable nodes.

    Computed, not typed: L = ceil(k * sqrt(M)), floored at 2 because binary
    spray with a single copy degenerates to direct delivery.
    """
    import math

    if reachable_nodes <= 0:
        return 2
    return max(2, math.ceil(ASSUMED_SPRAY_COPY_SCALING * math.sqrt(reachable_nodes)))


MESH_TTL_MAX = 8
"""Hops remaining on a fresh message. Fixed by the MeshMessage contract (ttl<=8).

The consequence is worth stating plainly rather than discovering later: at
ASSUMED_RADIO_RANGE_CROWD_M, eight hops is a few hundred metres, not a circuit. The mesh is
a local harvesting network that feeds whatever uplink is nearby — it is not a
venue-wide backhaul. That is why uplink coverage is a reported metric (a region
with no uplink in range is simply not being heard) instead of an assumption."""

ASSUMED_HOP_LATENCY_S = 5.0
"""Time for one store-carry-forward hop: discovery, connect, transfer, metres.

Seconds, not milliseconds — Wi-Fi Aware/BLE discovery dominates. Used only to
size the dedupe window, where over-estimating is safe (a larger cache) and
under-estimating is not (a message outlives its own dedupe entry and loops)."""


def dedupe_retention_s(ttl: int = MESH_TTL_MAX,
                       hop_latency_s: float = ASSUMED_HOP_LATENCY_S) -> float:
    """How long a (source, sequence) must stay remembered.

    A message can survive at most `ttl` hops, so it cannot reappear later than
    ttl * hop_latency after it was first seen. Remembering for exactly that long
    is the smallest window that cannot loop.
    """
    return ttl * hop_latency_s


ASSUMED_MESH_BUFFER_MESSAGES = 256
"""Per-node store-carry-forward buffer, in messages.

Buffer exhaustion is the failure mode that makes epidemic routing unaffordable,
so the buffer must be bounded for that failure to be observable at all. At a few
hundred bytes per message this is well under 100 KB, which is nothing for a phone
and still small enough that flooding overruns it — which is the point."""

ASSUMED_URGENT_RELAYS_PER_MIN = 30.0
"""Token-bucket refill rate for URGENT (rate-limited epidemic) relays.

Epidemic routing is affordable for URGENT precisely because URGENT is rare; the
rate limit is what enforces the 'rare'. One relay every two seconds bounds the
radio duty cycle a compromised or malfunctioning node can impose on its
neighbours, while still saturating a neighbourhood within seconds."""

ASSUMED_URGENT_BURST_RELAYS = 15
"""Token-bucket capacity: one neighbourhood's worth of relays in a single burst.

An alert must reach everyone standing nearby on the first encounter, not be
metered out one peer at a time. The bucket then has to refill before the node can
flood again."""

ASSUMED_UPLINK_BATTERY_RESERVE = 0.20
"""Battery fraction below which a node will not be elected uplink.

A phone that dies is not a node, and a spectator whose battery we drained will
uninstall before the next race. Election is lexicographic (see the mesh module)
precisely so this is a hard floor rather than a weight traded against throughput."""

GEOIND_PRIVACY_LEVEL = 1.3862943611198906  # math.log(4)
"""Privacy level l in the geo-indistinguishability definition: a mechanism is
l-private within radius r when eps = l / r. ln(4) is the level used in the
worked example of Andres et al. (CCS 2013) and is the one this system reports."""

ASSUMED_GEOIND_RADIUS_M = 50.0
"""Radius r within which a reported position is indistinguishable, metres.

Andres et al. illustrate with r = 200 m, which is city scale: at a circuit it
would place a fragment in the wrong grandstand entirely. 50 m is ASSUMED as the
venue-scale equivalent — roughly a grandstand block, so a fragment cannot say
which entrance one person used, while the aggregate map is built at zone scale
where the zero-mean noise averages out at 1/sqrt(n). This number is the whole
privacy/utility trade and should be argued about explicitly, which is why it is
one named constant rather than an epsilon sprinkled through the code."""

GEOIND_EPSILON_VENUE = GEOIND_PRIVACY_LEVEL / ASSUMED_GEOIND_RADIUS_M
"""eps = l / r, the geo-indistinguishability parameter actually applied on device.

Derived, never typed: move the radius and epsilon moves with it. Every
TraceFragment records the epsilon it was built with, because a privacy claim that
is not attached to the data it describes is not checkable."""

ASSUMED_FRAGMENT_MAX_DURATION_S = 120.0
"""Longest span a single TraceFragment may cover, seconds.

Geo-indistinguishability bounds what one *point* reveals; it does not bound what
a long sequence of correlated points reveals, and a full-day trace is
re-identifiable however noisy each point is. Two minutes is ASSUMED as short
enough to be a corridor observation and too short to be an itinerary."""
