"""Venue refinement: what the crowd knows that the map does not.

Per D6 the venue structure is IMPORTED before the event and REFINED afterwards.
The order matters and is not negotiable — traces do not build the graph, they
correct it. A system that constructed geometry from movement would draw paths
through fences the first time somebody's GNSS drifted, and would have no
structure at all before the first spectator arrived.

So everything here is a *proposal against an existing map*:

    trace       match noised fragments onto the imported graph
    desire      the shortcuts the map has no edge for
    capacity    measured width, speed and sustained flow per edge
    staleness   imported edges nobody walks — reported, never deleted
    report      one pass over the traces, all three answers

Pure, like the rest of core: fragments in, findings out, no I/O and no mutation
of the pack. Adoption is a single explicit call in an adapter.
"""

from .capacity import (
    BIN_S,
    SUSTAINED_BINS,
    EdgeMeasurement,
    apply_measurements,
    measure_capacity,
    measure_edges,
    measure_free_speed,
    measure_width,
)
from .desire import DesireLine, ZoneIndex, discover, propose_edges
from .report import RefinementReport, refine
from .staleness import EdgeUsage, UsageVerdict, audit, removal_candidates
from .trace import (
    EdgeIndex,
    Match,
    MatchedFragment,
    TraceMatcher,
    Traversal,
    match_all,
)

__all__ = [
    "BIN_S", "SUSTAINED_BINS", "EdgeMeasurement", "apply_measurements",
    "measure_capacity", "measure_edges", "measure_free_speed", "measure_width",
    "DesireLine", "ZoneIndex", "discover", "propose_edges",
    "RefinementReport", "refine",
    "EdgeUsage", "UsageVerdict", "audit", "removal_candidates",
    "EdgeIndex", "Match", "MatchedFragment", "TraceMatcher", "Traversal", "match_all",
]
