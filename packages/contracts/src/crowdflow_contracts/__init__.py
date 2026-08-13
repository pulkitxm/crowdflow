"""CrowdFlow contracts — the single source of truth for every runtime.

Authored here in Pydantic, exported to JSON Schema, generated into TypeScript for
the dashboard and app. Generated files are committed so drift shows up as a review
diff rather than a debugging session (D1).
"""

from .standards import (
    BAND_BUILDING_MAX,
    BAND_NOMINAL_MAX,
    FREE_FLOW_SPEED_MS,
    JAM_DENSITY_PERSONS_M2,
    LOS_A_MAX,
    LOS_B_MAX,
    LOS_C_MAX,
    LOS_D_MAX,
    LOS_E_MAX,
    MAD_TO_SIGMA,
    MEASURED_NOT_ASSUMED,
    MEASURED_SAMPLE_FLOOR,
    MODIFIED_Z_OUTLIER,
    CAPACITY_DENSITY,
    DENSITY_BUILDING_MAX,
    DENSITY_NOMINAL_MAX,
    LOSBand,
    band_for_density,
    band_for_flow,
    density_for_flow,
    los_grade_for_flow,
)
from .telemetry import (
    CrowdNode,
    MeshClass,
    MeshMessage,
    MeshMessageType,
    Position,
    TraceFragment,
)
from .state import Confidence, VenueState, ZoneState
from .decisions import (
    Forecast,
    InterventionCandidate,
    RerouteCommand,
    SafetyOutcome,
    SafetyVerdict,
    ScoreBreakdown,
)
from .venue import (
    Availability,
    CircuitPack,
    CoordinateFrame,
    Crossing,
    CrossingKind,
    Edge,
    EventProfile,
    Provenance,
    SafetyConstraints,
    Session,
    Sourced,
    Zone,
    ZoneKind,
)

__all__ = [
    "BAND_BUILDING_MAX", "BAND_NOMINAL_MAX", "FREE_FLOW_SPEED_MS",
    "JAM_DENSITY_PERSONS_M2", "LOS_A_MAX", "LOS_B_MAX", "LOS_C_MAX", "LOS_D_MAX",
    "LOS_E_MAX", "MEASURED_NOT_ASSUMED", "LOSBand", "band_for_flow", "los_grade_for_flow",
    "MAD_TO_SIGMA", "MEASURED_SAMPLE_FLOOR", "MODIFIED_Z_OUTLIER",
    "CAPACITY_DENSITY", "DENSITY_BUILDING_MAX", "DENSITY_NOMINAL_MAX",
    "band_for_density", "density_for_flow",
    "CrowdNode", "MeshClass", "MeshMessage", "MeshMessageType", "Position", "TraceFragment",
    "Confidence", "VenueState", "ZoneState",
    "Forecast", "InterventionCandidate", "RerouteCommand", "SafetyOutcome",
    "SafetyVerdict", "ScoreBreakdown",
    "Availability", "CircuitPack", "CoordinateFrame", "Crossing", "CrossingKind",
    "Edge", "EventProfile", "Provenance", "SafetyConstraints", "Session", "Sourced",
    "Zone", "ZoneKind",
]

__version__ = "0.1.0"
