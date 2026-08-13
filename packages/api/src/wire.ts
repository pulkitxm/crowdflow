/** Authored TypeScript wire contracts for the operator API. */

// Contract types are imported, never restated: one definition of a
// ZoneState exists and it is generated from the Pydantic model.
import type { Availability, CircuitPack, Confidence, CoordinateFrame, Crossing, CrossingKind, Edge, Forecast, InterventionCandidate, LOSBand, Position, Provenance, RerouteCommand, SafetyConstraints, SafetyOutcome, SafetyVerdict, ScoreBreakdown, Sourced, VenueState, Zone, ZoneKind, ZoneState } from "@crowdflow/contracts";
export type { Availability, CircuitPack, Confidence, CoordinateFrame, Crossing, CrossingKind, Edge, Forecast, InterventionCandidate, LOSBand, Position, Provenance, RerouteCommand, SafetyConstraints, SafetyOutcome, SafetyVerdict, ScoreBreakdown, Sourced, VenueState, Zone, ZoneKind, ZoneState };

/**
 * Everything needed to draw the venue, sent once per console.
 *
 * The track polyline is carried beside the pack because it is geometry, not
 * graph: it is what makes the schematic recognisable as Silverstone rather
 * than as an abstract network, and no engine consumes it.
 */
export interface VenueGeometry {
  pack: CircuitPack;
  /**
   * circuit outline in the venue's metric frame
   */
  track?: Position[];
  /**
   * pack.validate_integrity() — shown, not hidden: a console that silently renders a broken pack is worse than one that says so
   */
  integrity_problems?: string[];
}

/**
 * One row of the circuit picker.
 */
export interface CircuitSummary {
  id: string;
  name: string;
  zones: number;
  edges: number;
  crossings: number;
  track_length_m: number;
  /**
   * edges whose width is assumed rather than measured. Flow is per metre of width, so these zones' bands are provisional.
   */
  untrustworthy_widths: number;
}

/**
 * One operational band with the numbers that define it.
 *
 * The console shows a word and a number for every state; this is where the
 * numbers come from. Serving them rather than hard-coding them in TypeScript
 * is the whole point — change a constant in `standards.py` and the legend on
 * the wall moves with it.
 */
export interface BandBoundary {
  band: LOSBand;
  label: string;
  los_grades: string;
  /**
   * persons/m2, inclusive
   */
  density_min: number;
  /**
   * persons/m2, exclusive; None = unbounded
   */
  density_max: number | null;
}

/**
 * One Fruin grade. Console only — the spectator app never shows these.
 */
export interface LosGrade {
  grade: string;
  flow_min: number;
  flow_max: number | null;
  note: string;
}

/**
 * The constants registry, served at runtime.
 *
 * Every threshold the console displays comes from here, so there is no second
 * copy of Fruin's numbers living in a stylesheet.
 */
export interface StandardsReport {
  source: string;
  bands: BandBoundary[];
  los: LosGrade[];
  /**
   * persons/m2 at maximum flow
   */
  capacity_density: number;
  jam_density: number;
  free_flow_speed_ms: number;
  /**
   * ped/m/min at capacity density — below Fruin's LOS E/F boundary, which is why the system classifies on density
   */
  max_achievable_flow: number;
  measured_not_assumed: string[];
}

/**
 * One anonymous device, reduced to what a map needs.
 *
 * The rotating pseudonym is deliberately dropped at this boundary. The console
 * has no use for device identity — it plots dots — and an operator screen that
 * never receives an id cannot leak one, however long it is left running in a
 * room with a window.
 */
export interface NodeMark {
  x: number;
  y: number;
  speed_ms: number;
  /**
   * positional 1-sigma; the dot is not a point
   */
  accuracy_m: number;
}

/**
 * What the system can and cannot see this tick.
 *
 * `VenueState.coverage` divides observed zones by observed-plus-declared-
 * unobserved, which omits zones that reported recently but not now. Those
 * zones exist and the operator is entitled to know about them, so the
 * denominator here is every zone in the pack and the third category is
 * reported separately.
 */
export interface CoverageReport {
  /**
   * every zone in the circuit pack
   */
  zones_total: number;
  /**
   * zones with a reading this tick
   */
  observed: number;
  /**
   * zones the state engine declares unobserved
   */
  unknown: number;
  /**
   * zones in neither list: seen within the stale window, nothing now. Not empty, not currently known.
   */
  silent: number;
  /**
   * observed zones whose Confidence.is_reportable is False — a number exists but the contract says do not lean on it
   */
  low_confidence: number;
  /**
   * observed / zones_total
   */
  fraction_observed: number;
}

/**
 * Simulated crowd bookkeeping. Ground truth, which only exists in simulation.
 *
 * Shown beside the estimate on purpose: the console is also how we check that
 * the estimate tracks reality at the current participation rate.
 */
export interface PopulationSnapshot {
  total: number;
  /**
   * created but not yet departed
   */
  waiting: number;
  active: number;
  arrived: number;
  /**
   * devices reporting — NOT people
   */
  observed_nodes: number;
  /**
   * observed devices scaled by participation
   */
  estimated_present: number;
}

/**
 * Running totals, using core's A/B definitions verbatim.
 *
 * Same numbers the gate is judged on, so the console cannot flatter a run the
 * harness would fail.
 */
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

/**
 * One line of the race-control feed.
 *
 * A log of transitions core already computed — a band change is `ZoneState.band`
 * differing from last tick's, not a fresh classification. The adapter keeps the
 * log because only the adapter sees every tick; a console that connects late
 * would otherwise start with an empty screen and no history.
 */
export interface ConsoleEvent {
  /**
   * monotonic within a session; the console dedupes on it
   */
  seq: number;
  /**
   * simulation clock
   */
  time_s: number;
  kind: EventKind;
  severity: EventSeverity;
  message: string;
  zone_id?: string | null;
  detail?: string | null;
}

/**
 * One tick of the loop, as the console receives it.
 *
 * Mirrors `crowdflow_core.loop.TickResult` field for field, plus the transport
 * facts a live screen needs: which tick, what it cost, and what the system
 * could not see while producing it.
 */
export interface TickEnvelope {
  tick: number;
  time_s: number;
  /**
   * measured wall time for this tick. Shown, because an intervention sweep costs seconds and a console that hides the pause is lying about freshness.
   */
  compute_ms: number;
  state: VenueState;
  forecasts?: Forecast[];
  /**
   * zone ids whose forecast passes Forecast.is_actionable. Sent because that bar is a property on the contract rather than a serialised field, and a console that restated it in TypeScript would be a second copy of a threshold — the exact thing standards.py exists to prevent.
   */
  actionable?: string[];
  /**
   * every option evaluated, rejected ones included
   */
  candidates?: InterventionCandidate[];
  command?: RerouteCommand | null;
  verdict?: SafetyVerdict | null;
  dispatched?: boolean;
  /**
   * see CoverageReport.silent
   */
  silent_zones?: string[];
  low_confidence_zones?: string[];
  coverage: CoverageReport;
  population: PopulationSnapshot;
  metrics: MetricsSnapshot;
  /**
   * every reporting device, undownsampled. Thinning the marks would understate coverage, which is the one thing this screen must not do.
   */
  nodes?: NodeMark[];
  /**
   * new this tick
   */
  events?: ConsoleEvent[];
}

export type SessionStatus = "idle" | "running" | "paused" | "computing" | "finished";

/**
 * What is running, and under exactly which parameters.
 *
 * Every input that changes the numbers is here — including the seed, so a
 * screenshot of the console is enough to reproduce the run (invariant 6).
 */
export interface SessionInfo {
  session_id: string;
  circuit_id: string;
  scenario: string;
  description: string;
  status: SessionStatus;
  seed: number;
  population: number;
  /**
   * participation source for this run; a simulation input is ASSUMED, a live session must supply a measured estimate
   */
  participation: number;
  /**
   * share who act on a reroute — ASSUMED in core
   */
  compliance: number;
  /**
   * simulation seconds per tick
   */
  tick_s: number;
  /**
   * wall-clock multiplier; 1.0 is real time
   */
  speed: number;
  intervene: boolean;
  origins?: string[];
  destination?: string | null;
  tick?: number;
  time_s?: number;
  duration_s?: number;
  /**
   * wall time spent in the tick currently being computed
   */
  computing_ms?: number;
}

/**
 * A scenario the console can start, with the zones it would use.
 *
 * The zone choice is shown rather than hidden: 'everyone leaves at once' is a
 * different experiment depending on which stands and which car park, and an
 * operator comparing two runs needs to know it was the same one.
 */
export interface ScenarioOption {
  id: string;
  name: string;
  description: string;
  origins?: string[];
  destination?: string | null;
  origin_names?: string[];
  destination_name?: string | null;
}

/**
 * Start or restart a run.
 *
 * Defaults come from `SimConfig`, not from literals typed here — one place
 * decides what a default participation rate is.
 */
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
  /**
   * only for action=speed
   */
  speed?: number | null;
}

export type FrameType = "hello" | "tick" | "status";

/**
 * Every WebSocket message, one shape.
 *
 * `session` is present on all three types deliberately. A console that has not
 * received a tick for nine seconds must be able to tell "the server is inside
 * an intervention sweep" from "the link is dead", and it can only do that if
 * the status frames keep arriving with the run state attached.
 */
export interface SocketFrame {
  type: FrameType;
  session: SessionInfo;
  /**
   * sent once, on hello
   */
  standards?: StandardsReport | null;
  /**
   * sent on hello; geometry is too large to push per tick
   */
  geometry_url?: string | null;
  /**
   * on hello: what the console missed
   */
  backlog?: ConsoleEvent[];
  tick?: TickEnvelope | null;
  /**
   * on hello: the most recent tick, so the screen is never blank
   */
  last_tick?: TickEnvelope | null;
  note?: string | null;
}
