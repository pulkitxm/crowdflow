"""The mesh: delay-tolerant transport for a crowd of phones with no gateway.

Participating handsets carry each other's data over short-range radio until it
reaches one that currently has internet. There is no fixed gateway, because the
cell network saturates exactly when and where crowd density peaks — the moment
the system is worth having is the moment a fixed uplink stops working. A floating
uplink degrades instead: whoever has connectivity right now is the gateway, and
the dashboard subscribes to however many of them are reachable.

The protocol logic lives in core, not in the app, because it is algorithmic and
must be simulatable with zero devices. `simulator.py` is the proof of that: N
nodes, a radio range, and messages moving hop by hop, from which delivery ratio,
hop count and copies-per-message fall out for each traffic class. The native
layer (apps/mobile/modules/mesh) owns only the radio.

Modules
-------
buffer      TTL, sequence dedupe, bounded storage, rate limiting
policy      Spray-and-Wait, PRoPHET, rate-limited epidemic, one interface
node        a device: encounter, accept, relay
uplink      opportunistic election, dashboard fan-in, clock skew, coverage
privacy     planar Laplace noise applied before storage -> TraceFragment
simulator   the deviceless mesh
metrics     delivery ratio, hops, copies per message
"""

from .buffer import Carried, DedupeCache, MessageBuffer, MessageKey, TokenBucket, key_of
from .metrics import MeshRunMetrics, PolicyMetrics
from .node import Delivery, MeshNode, NodeRadio, encounter
from .policy import (
    UPLINK_DESTINATION,
    DeliveryPredictability,
    Prophet,
    RateLimitedEpidemic,
    RoutingPolicy,
    SprayAndWait,
    Transmission,
    default_policies,
    initial_copies,
)
from .privacy import (
    FragmentPolicy,
    aggregate_density,
    expected_displacement_m,
    lambert_w_minus1,
    noise_fragment,
    noise_radius_for,
    planar_laplace,
)
from .simulator import MeshSimConfig, MeshSimulator, compare_policies
from .uplink import (
    ClockSkew,
    CoverageReport,
    Election,
    FanIn,
    Observation,
    UplinkCandidate,
    UplinkReport,
    components,
    coverage,
    elect_uplinks,
    radio_neighbours,
)

__all__ = [
    "UPLINK_DESTINATION",
    "Carried",
    "ClockSkew",
    "CoverageReport",
    "DedupeCache",
    "Delivery",
    "DeliveryPredictability",
    "Election",
    "FanIn",
    "FragmentPolicy",
    "MeshNode",
    "MeshRunMetrics",
    "MeshSimConfig",
    "MeshSimulator",
    "MessageBuffer",
    "MessageKey",
    "NodeRadio",
    "Observation",
    "PolicyMetrics",
    "Prophet",
    "RateLimitedEpidemic",
    "RoutingPolicy",
    "SprayAndWait",
    "TokenBucket",
    "Transmission",
    "UplinkCandidate",
    "UplinkReport",
    "aggregate_density",
    "compare_policies",
    "components",
    "coverage",
    "default_policies",
    "elect_uplinks",
    "encounter",
    "expected_displacement_m",
    "initial_copies",
    "key_of",
    "lambert_w_minus1",
    "noise_fragment",
    "noise_radius_for",
    "planar_laplace",
    "radio_neighbours",
]
