// GENERATED FROM packages/api/src/crowdflow_api/wire.py — DO NOT EDIT.
// Regenerate: uv run python packages/api/scripts/generate.py

// Contract types are imported, never restated: one definition of a
// ZoneState exists and it is generated from the Pydantic model.
import type { Availability, CircuitPack, Confidence, CoordinateFrame, Crossing, CrossingKind, Edge, Forecast, InterventionCandidate, LOSBand, Position, Provenance, RerouteCommand, SafetyConstraints, SafetyOutcome, SafetyVerdict, ScoreBreakdown, Sourced, VenueState, Zone, ZoneKind, ZoneState } from "../../contracts/ts/index";
export type { Availability, CircuitPack, Confidence, CoordinateFrame, Crossing, CrossingKind, Edge, Forecast, InterventionCandidate, LOSBand, Position, Provenance, RerouteCommand, SafetyConstraints, SafetyOutcome, SafetyVerdict, ScoreBreakdown, Sourced, VenueState, Zone, ZoneKind, ZoneState };

/** Everything needed to draw the venue, sent once per console. */
export interface VenueGeometry {
  pack: CircuitPack;
  /** circuit outline in the venue's metric frame */
  track?: Position[];
  /** pack.validate_integrity() — shown, not hidden: a console that silently renders a broken pack is worse than one that says so */
  integrity_problems?: string[];
}

/** One row of the circuit picker. */
export interface CircuitSummary {
  id: string;
  name: string;
  zones: number;
  edges: number;
  crossings: number;
  track_length_m: number;
  /** edges whose width is assumed rather than measured. Flow is per metre of width, so these zones' bands are provisional. */
  untrustworthy_widths: number;
}

/** One operational band with the numbers that define it. */
export interface BandBoundary {
  band: LOSBand;
  label: string;
  los_grades: string;
  /** persons/m2, inclusive */
  density_min: number;
  /** persons/m2, exclusive; None = unbounded */
  density_max: number | null;
}

/** One Fruin grade. Console only — the spectator app never shows these. */
export interface LosGrade {
  grade: string;
  flow_min: number;
  flow_max: number | null;
  note: string;
}

/** The constants registry, served at runtime. */
export interface StandardsReport {
  source: string;
  bands: BandBoundary[];
  los: LosGrade[];
  /** persons/m2 at maximum flow */
  capacity_density: number;
  jam_density: number;
  free_flow_speed_ms: number;
  /** ped/m/min at capacity density — below Fruin's LOS E/F boundary, which is why the system classifies on density */
  max_achievable_flow: number;
  measured_not_assumed: string[];
}

/** One anonymous device, reduced to what a map needs. */
export interface NodeMark {
  x: number;
  y: number;
  speed_ms: number;
  /** positional 1-sigma; the dot is not a point */
  accuracy_m: number;
}

/** What the system can and cannot see this tick. */
export interface CoverageReport {
  /** every zone in the circuit pack */
  zones_total: number;
  /** zones with a reading this tick */
  observed: number;
  /** zones the state engine declares unobserved */
  unknown: number;
  /** zones in neither list: seen within the stale window, nothing now. Not empty, not currently known. */
  silent: number;
  /** observed zones whose Confidence.is_reportable is False — a number exists but the contract says do not lean on it */
  low_confidence: number;
  /** observed / zones_total */
  fraction_observed: number;
}

/** Simulated crowd bookkeeping. Ground truth, which only exists in simulation. */
export interface PopulationSnapshot {
  total: number;
  /** created but not yet departed */
  waiting: number;
  active: number;
  arrived: number;
  /** devices reporting — NOT people */
  observed_nodes: number;
  /** observed devices scaled by participation */
  estimated_present: number;
}

/** Running totals, using core's A/B definitions verbatim. */
export interface MetricsSnapshot {
  peak_density: number;
  critical_zone_seconds: number;
  building_zone_seconds: number;
  peak_critical_zones: number;
  total_queue_peak: number;
  arrived: number;
  mean_walk_s: number;
  p95_walk_s: number;
  interventions: number;
  rejected_by_safety: number;
  samples: number;
}

export type EventKind = "session" | "band" | "coverage" | "forecast" | "intervention" | "command" | "safety";

export type EventSeverity = "info" | "warning" | "critical";

/** One line of the race-control feed. */
export interface ConsoleEvent {
  /** monotonic within a session; the console dedupes on it */
  seq: number;
  /** simulation clock */
  time_s: number;
  kind: EventKind;
  severity: EventSeverity;
  message: string;
  zone_id?: string | null;
  detail?: string | null;
}

/** One tick of the loop, as the console receives it. */
export interface TickEnvelope {
  tick: number;
  time_s: number;
  /** measured wall time for this tick. Shown, because an intervention sweep costs seconds and a console that hides the pause is lying about freshness. */
  compute_ms: number;
  state: VenueState;
  forecasts?: Forecast[];
  /** zone ids whose forecast passes Forecast.is_actionable. Sent because that bar is a property on the contract rather than a serialised field, and a console that restated it in TypeScript would be a second copy of a threshold — the exact thing standards.py exists to prevent. */
  actionable?: string[];
  /** every option evaluated, rejected ones included */
  candidates?: InterventionCandidate[];
  command?: RerouteCommand | null;
  verdict?: SafetyVerdict | null;
  dispatched?: boolean;
  /** see CoverageReport.silent */
  silent_zones?: string[];
  low_confidence_zones?: string[];
  coverage: CoverageReport;
  population: PopulationSnapshot;
  metrics: MetricsSnapshot;
  /** every reporting device, undownsampled. Thinning the marks would understate coverage, which is the one thing this screen must not do. */
  nodes?: NodeMark[];
  /** new this tick */
  events?: ConsoleEvent[];
}

export type SessionStatus = "idle" | "running" | "paused" | "computing" | "finished";

/** What is running, and under exactly which parameters. */
export interface SessionInfo {
  session_id: string;
  circuit_id: string;
  scenario: string;
  description: string;
  status: SessionStatus;
  seed: number;
  population: number;
  /** measured share running the app */
  participation: number;
  /** share who act on a reroute — ASSUMED in core */
  compliance: number;
  /** simulation seconds per tick */
  tick_s: number;
  /** wall-clock multiplier; 1.0 is real time */
  speed: number;
  intervene: boolean;
  origins?: string[];
  destination?: string | null;
  tick?: number;
  time_s?: number;
  duration_s?: number;
  /** wall time spent in the tick currently being computed */
  computing_ms?: number;
}

/** A scenario the console can start, with the zones it would use. */
export interface ScenarioOption {
  id: string;
  name: string;
  description: string;
  origins?: string[];
  destination?: string | null;
  origin_names?: string[];
  destination_name?: string | null;
}

/** Start or restart a run. */
export interface SessionRequest {
  circuit_id?: string;
  scenario?: string;
  seed?: number | null;
  population?: number | null;
  participation?: number | null;
  tick_s?: number | null;
  speed?: number | null;
  intervene?: boolean;
  origins?: string[] | null;
  destination?: string | null;
}

export type ControlAction = "play" | "pause" | "step" | "speed";

export interface ControlRequest {
  action: ControlAction;
  /** only for action=speed */
  speed?: number | null;
}

export type FrameType = "hello" | "tick" | "status";

/** Every WebSocket message, one shape. */
export interface SocketFrame {
  type: FrameType;
  session: SessionInfo;
  /** sent once, on hello */
  standards?: StandardsReport | null;
  /** sent on hello; geometry is too large to push per tick */
  geometry_url?: string | null;
  /** on hello: what the console missed */
  backlog?: ConsoleEvent[];
  tick?: TickEnvelope | null;
  /** on hello: the most recent tick, so the screen is never blank */
  last_tick?: TickEnvelope | null;
  note?: string | null;
}
