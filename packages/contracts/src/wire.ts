/** Authored TypeScript wire contracts for the operator API. */

// Contract types are imported, never restated: one authored TypeScript
// definition of ZoneState serves every runtime and UI.
import type { AnchorKind, AnchorPack, Availability, CircuitPack, Confidence, CoordinateFrame, Crossing, CrossingKind, CrowdNode, Edge, EventProfile, Forecast, IngestAck, InterventionCandidate, LOSBand, NodeReport, Position, PositionFix, PositionSource, Provenance, RadioAnchor, RerouteCommand, SafetyConstraints, SafetyOutcome, SafetyVerdict, ScoreBreakdown, SensingStatus, Session, Sourced, VenueState, Zone, ZoneKind, ZoneState } from "./types.js";
export type { AnchorKind, AnchorPack, Availability, CircuitPack, Confidence, CoordinateFrame, Crossing, CrossingKind, CrowdNode, Edge, EventProfile, Forecast, IngestAck, InterventionCandidate, LOSBand, NodeReport, Position, PositionFix, PositionSource, Provenance, RadioAnchor, RerouteCommand, SafetyConstraints, SafetyOutcome, SafetyVerdict, ScoreBreakdown, SensingStatus, Session, Sourced, VenueState, Zone, ZoneKind, ZoneState };

export interface PersonRecord {
  person_id: number;
  circuit_id: string;
  joined_at: number;
  last_seen_at: number | null;
  status: 'active';
}

export interface PersonLocation extends PersonRecord {
  position: Position;
  speed_ms: number;
  accuracy_m: number;
  source: PositionSource;
  gate_id: string | null;
}

export interface PeopleQuery {
  coordinates: Position[];
  zoom: number;
  count?: number;
  since?: number;
}

export interface GridCell {
  id: string;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  count: number;
  person_ids: number[];
}

export interface PeopleQueryResult {
  circuit_id: string;
  coordinates: Position[];
  zoom: number;
  grid_size_m: number;
  matched_count: number;
  returned_count: number;
  people: PersonLocation[];
  cells: GridCell[];
  source?: 'handsets' | 'simulation';
}

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
 * One row of the race picker.
 *
 * A race, not a circuit — which is how a spectator holds it. The circuit is
 * carried because everything downstream is keyed on it, but nothing in the app
 * asks somebody to recognise a circuit id.
 *
 * `has_map` is the field that matters. Most rounds of a season have no committed
 * circuit pack, so the app can name the race and give the timetable but cannot
 * route anybody through the venue. Serving the whole calendar with the gap marked
 * is honest; serving only the guidable rounds would hide it.
 */
export interface RaceSummary {
  /** season and round — unique, and stable once a season is published */
  id: string;
  round: number;
  season: number;
  /** as the sport names it: "British Grand Prix" */
  name: string;
  circuit_id: string;
  locality: string;
  country: string;
  /** ISO 3166-1 alpha-3, where the source has one */
  country_code?: string;
  /** race day, ISO 8601 date */
  date: string;
  /** the venue's UTC offset over the weekend, as '+01:00' */
  utc_offset?: string;
  /**
   * First session start and last session end. Derived, not published: a sprint
   * weekend and a conventional one have different shapes, and neither source
   * carries a "weekend starts" field.
   */
  starts_at: string | null;
  ends_at: string | null;
  sessions?: Session[];
  /**
   * Whether every session end came from a published timetable rather than a
   * regulation duration. False means the whole weekend is an estimate — and the
   * chequered flag is the biggest crowd-movement trigger of the day.
   */
  session_times_published: boolean;
  /** whether a circuit pack is committed, i.e. whether this round can be guided */
  has_map: boolean;
  /** when the calendar was imported. A schedule is a snapshot; sessions move. */
  calendar_generated_at: string;
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
 * is the whole point — change a constant in `contracts/src/standards.ts` and the legend on
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
  person_id?: number;
  x: number;
  y: number;
  speed_ms: number;
  /**
   * positional 1-sigma; the dot is not a point
   */
  accuracy_m: number;
  timestamp?: number;
  source?: PositionSource;
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

export type EventKind = "session" | "band" | "coverage" | "forecast" | "intervention" | "command" | "safety" | "hazard" | "evacuation" | "lifecycle";

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
 * Mirrors `@crowdflow/core`'s TickResult field for field, plus the transport
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
   * zone ids whose forecast passes the authored contract judgement. Sent so the console never restates a threshold.
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

export type SessionStatus = "idle" | "starting" | "running" | "paused" | "stopping" | "completed" | "failed";

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
  join_rate_per_s?: number;
  movement_scale?: number;
  starting_person_id?: number;
  gates?: string[];
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
  join_rate_per_s?: number | null;
  tick_ms?: number | null;
  duration_s?: number | null;
  movement_scale?: number | null;
  starting_person_id?: number | null;
  gates?: string[] | null;
  reset_before_start?: boolean;
  compliance?: number | null;
}

export type HazardType = "fire" | "gate_blockage" | "walkway_blockage" | "exit_unavailable";
export type HazardSeverity = "low" | "medium" | "high" | "critical";
export type HazardMode = "closed" | "restricted";
export type HazardStatus = "active" | "cleared";

export interface HazardLocation {
  zone_id?: string | null;
  gate_id?: string | null;
  edge_id?: string | null;
  position?: Position | null;
}

export interface HazardRequest {
  type: HazardType;
  severity: HazardSeverity;
  mode: HazardMode;
  capacity_percent?: number | null;
  radius_m?: number | null;
  location: HazardLocation;
}

export interface HazardRecord extends HazardRequest {
  id: string;
  status: HazardStatus;
  created_at_s: number;
  cleared_at_s: number | null;
  affected_people: number;
  rerouted_people: number;
  awaiting_safe_route: number;
  replacement_exits: string[];
  affected_zone_ids: string[];
  affected_edge_ids: string[];
}

export interface GateAvailability {
  id: string;
  name: string;
  kind: ZoneKind;
  available: boolean;
  capacity_percent: number;
  hazard_ids: string[];
  replacement_exit_ids: string[];
}

export interface EvacuationMetrics {
  enabled: boolean;
  total_population: number;
  evacuated: number;
  remaining: number;
  awaiting_safe_route: number;
  throughput_per_minute: number;
  congestion: LOSBand;
  estimated_clearance_s: number | null;
}

export interface ScenarioSnapshot {
  revision: number;
  lifecycle: SessionStatus;
  circuit_id: string | null;
  session: SessionInfo | null;
  active_hazards: HazardRecord[];
  hazard_history: HazardRecord[];
  gates: GateAvailability[];
  evacuation: EvacuationMetrics;
  event_history: ConsoleEvent[];
  operational_warning: string | null;
}

export type ControlAction = "play" | "pause" | "step" | "speed";

export interface ControlRequest {
  action: ControlAction;
  /**
   * only for action=speed
   */
  speed?: number | null;
}

export type FrameType = "hello" | "tick" | "status" | "live" | "person_joined" | "people_joined" | "command" | "scenario";

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
  session: SessionInfo | null;
  revision?: number;
  scenario_snapshot?: ScenarioSnapshot | null;
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
  /**
   * the live phone picture, on hello and on every `live` frame. Absent when no handset has ever reported — which is different from present-and-empty, and the console draws them differently.
   */
  live?: LiveSnapshot | null;
  person?: PersonRecord | null;
  people?: PersonRecord[];
  note?: string | null;
  event?: ConsoleEvent | null;
  command?: AgentCommandStatus | null;
}

/**
 * What real handsets are reporting, right now.
 *
 * Not a `TickEnvelope`. A tick carries forecasts, candidates, verdicts and a
 * ground-truth population, all of which exist because a simulation knows the
 * answer. None of that is available from live phones, and a snapshot shaped like
 * a tick would invite the console to draw an empty prediction panel as though
 * the prediction were "nothing will happen".
 *
 * What it carries instead is the honesty layer: how many devices, over which
 * radios, how stale, what was rejected and why, and whether the population
 * figure rests on a measurement or an estimate.
 */
export interface LiveSnapshot {
  circuit_id: string;
  /**
   * unix seconds, server clock. The console's staleness clock, and the phone's drift correction.
   */
  server_time: number;
  /**
   * seconds since the last accepted batch. Null before the first one. A live panel showing dots with no age beside them is a photograph presented as a window.
   */
  last_report_age_s: number | null;
  participation: number;
  /**
   * where the participation rate came from. ASSUMED until a capture-recapture measurement exists — and `estimated_population` is observed devices divided by it, so this label decides how much the population number is worth.
   */
  participation_provenance: Provenance;
  window_s: number;
  state: VenueState;
  forecasts?: Forecast[];
  actionable?: string[];
  /**
   * one mark per reporting device in the window, undownsampled
   */
  nodes?: NodeMark[];
  reporting_devices: number;
  /**
   * batches by the radio that produced them. A zone going quiet as every phone in it drops from Wi-Fi to nothing looks identical to the zone emptying, unless this is on screen.
   */
  by_source?: Partial<Record<PositionSource, number>>;
  accepted_total: number;
  rejected_total: number;
  /**
   * rejection reasons by count, worst first. '3,400 rejected' is not actionable; '3,400 rejected: position outside venue bounds' is a wrong circuit id in a config file.
   */
  problems?: Record<string, number>;
  coverage: CoverageReport;
}

/**
 * Turn live ingest on for one circuit.
 *
 * `participation` is required and has no default. Defaulting it would put a
 * plausible number behind `estimated_population` without anybody choosing it,
 * and that number is the one an operator would act on.
 */
export interface LiveRequest {
  circuit_id: string;
  participation: number;
  window_s?: number | null;
}

export interface PersonLoginRequest {
  person_id: number;
  circuit_id: string;
}

export type AgentStateSource = 'live' | 'scenario';

export interface AgentAskRequest {
  question?: string;
  provider?: string;
}

export interface AgentToolCallWire {
  name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface AgentTurnWire {
  text: string | null;
  calls: AgentToolCallWire[];
}

export interface AgentAskResponse {
  question: string;
  answer: string | null;
  provider: string;
  model: string | null;
  state_source: AgentStateSource;
  truncated: boolean;
  turns: AgentTurnWire[];
  proposals: Record<string, unknown>[];
}

export interface AgentAdvisory {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  headline: string;
  detail: string;
  zone_id: string;
  crowd_message: string;
  model_id: string;
  raised_at_s: number;
  approved: boolean;
}

export interface SpectatorNotice {
  id: string;
  advisory_id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  zone_id: string;
  published_at_s: number;
  expires_at_s: number;
  approved_by: string;
}

export interface RaceCarWire {
  number: number;
  label: string;
  position: number;
  lap: number;
  lap_progress: number;
  gap_to_leader_s: number;
  retired: boolean;
}

export interface RaceStateWire {
  running: boolean;
  finished: boolean;
  lap: number;
  total_laps: number;
  lap_s: number;
  elapsed_s: number;
  remaining_s: number;
  leader_lap_progress: number;
  grid_provenance: string;
  grid_note: string;
  cars: RaceCarWire[];
}

export interface AnomalyRecord {
  id: string;
  kind: string;
  label: string;
  injected_at_s: number;
  duration_s: number;
  affected_agents: number;
  effect: string;
}

export interface AnomalyOption {
  kind: string;
  label: string;
  effect: string;
  default_duration_s: number;
}

export interface RaceDayRequest {
  circuit_id?: string;
  population?: number;
  speed?: number;
  participation?: number;
  tick_s?: number;
  seed?: number;
  intervene?: boolean;
}

export interface RaceDayPhaseWire {
  id: string;
  kind: string;
  name: string;
  start_s: number;
  end_s: number;
  provenance: string;
  source: string;
  crowd_effect: string;
  state: 'done' | 'active' | 'pending';
}

export interface RaceDayStatus {
  circuit_id: string;
  event_name: string;
  date: string | null;
  utc_offset: string | null;
  population: number;
  day_s: number;
  clock_s: number;
  clock_local: string;
  day_state: 'pre_event' | 'running' | 'complete';
  race_start_s: number;
  race_end_s: number;
  race_provenance: string;
  current_phase_id: string | null;
  phases: RaceDayPhaseWire[];
  crowd: { offsite: number; walking: number; dwelling: number; departed: number; stranded: number; total: number };
  by_area: Array<{ kind: string; label: string; count: number }>;
  anomalies: AnomalyRecord[];
  catalogue: AnomalyOption[];
  race: RaceStateWire;
  crowd_source: 'handsets' | 'simulation';
}

export interface AgentStatus {
  provider: string;
  configured: boolean;
  detail: string | null;
  state_source: AgentStateSource | null;
}

export interface AgentCommandStatus {
  command_id: string;
  circuit_id: string;
  source_zone: string;
  destination_zone: string;
  via: string[];
  target_fraction: number;
  reason: string;
  dispatched_at: number;
  expires_at: number;
  expires_in_s: number;
  walk_time_s: number;
  applied_to_simulation: boolean;
  cohort: {
    targeted: number;
    pinged: number;
    moved: number;
    still_near_source: number;
  };
}

export interface GuidanceRecord {
  person_id: number;
  command_id: string;
  from_zone: string;
  to_zone: string;
  via: string[];
  avoid: string[];
  prefer: string[];
  reason: string;
  expires_at: number;
}
