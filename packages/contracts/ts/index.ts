// GENERATED FROM packages/contracts — DO NOT EDIT.
// Regenerate: uv run python packages/contracts/scripts/generate.py

/** A point in the venue's local metric frame, in metres. */
export interface Position {
  /** metres east of venue origin */
  x: number;
  /** metres north of venue origin */
  y: number;
}

/** One anonymous device's live movement state. */
export interface CrowdNode {
  /** rotating pseudonym, valid within its epoch only */
  node_id: string;
  /** ID rotation epoch; IDs are not comparable across epochs */
  epoch: number;
  /** unix seconds */
  timestamp: number;
  position: Position;
  /** metres per second */
  speed_ms: number;
  /** degrees clockwise from north */
  heading_deg: number;
  /** positional 1-sigma; feeds the confidence model */
  accuracy_m: number;
  /** assigned by the state engine, not self-reported */
  zone_id?: string | null;
}

export type MeshClass = "state" | "uplink" | "urgent";

export type MeshMessageType = "hello" | "peer_discovery" | "state_update" | "zone_update" | "trace_fragment" | "route_update" | "alert" | "reroute" | "ack" | "heartbeat" | "sync";

/** Envelope for anything crossing the mesh. */
export interface MeshMessage {
  type: MeshMessageType;
  traffic_class: MeshClass;
  /** rotating node pseudonym of the originator */
  source: string;
  /** per-source monotonic; used for dedupe */
  sequence: number;
  /** hops remaining */
  ttl: number;
  timestamp: number;
  payload?: Record<string, unknown>;
}

/** A short, noised path segment contributed for venue refinement. */
export interface TraceFragment {
  /** per-fragment random; never reused, never linkable */
  fragment_id: string;
  /** noised, in venue frame */
  points: Position[];
  /** unix seconds */
  t_start: number;
  /** unix seconds */
  t_end: number;
  /** geo-indistinguishability privacy parameter actually applied */
  epsilon: number;
  /** radius within which the true path is indistinguishable */
  noise_radius_m: number;
}

/** How much to trust the state beside it. */
export interface Confidence {
  value: number;
  /** devices contributing to this estimate */
  observed_nodes: number;
  /** age of the newest observation */
  freshness_s: number;
  /** mean positional 1-sigma */
  mean_accuracy_m: number;
  /** agreement with recent estimates for this zone */
  stability: number;
}

export type LOSBand = "nominal" | "building" | "critical";

/** One zone at one instant. */
export interface ZoneState {
  zone_id: string;
  timestamp: number;
  /** devices seen; NOT people */
  observed_nodes: number;
  /** measured, never assumed — see standards.MEASURED_NOT_ASSUMED */
  participation_rate: number;
  /** persons per square metre — the AUTHORITATIVE measure. Flow is not monotonic in density (it peaks then collapses), so a band cannot be read off flow alone: a jammed corridor and an empty one look alike. */
  density_persons_m2: number;
  /** pedestrians per metre width per minute — reported, not classified on */
  flow_ped_m_min: number;
  /** people who do not fit at jam density, i.e. backed up behind */
  queue_excess?: number;
  mean_speed_ms: number;
  dominant_heading_deg?: number | null;
  inflow_per_min: number;
  outflow_per_min: number;
  confidence: Confidence;
  /** Observed devices scaled by measured participation. */
  estimated_population: number;
  /** Operational band, classified on density (see standards.band_for_density). */
  band: LOSBand;
  /** Past the peak of the fundamental diagram: more arrivals now reduce */
  over_capacity: boolean;
  /** Full Fruin grade A-F. Console only; the app never shows this. */
  los_grade: string;
  /** Positive means filling. Sustained positive net flow is the early warning. */
  net_flow_per_min: number;
}

/** Every zone at one tick, plus what the system knows it cannot see. */
export interface VenueState {
  circuit_id: string;
  timestamp: number;
  /** drives crossing availability */
  session_id?: string | null;
  zones?: Record<string, ZoneState>;
  /** Zones with no reporting device. MUST render as unknown, never as empty. Under D7 uplinks are opportunistic, so coverage genuinely varies. */
  unobserved_zones?: string[];
}

/** Where congestion will be, when, and why. */
export interface Forecast {
  zone_id: string;
  issued_at: number;
  /** how far ahead this forecast looks */
  horizon_s: number;
  /** the band predicted to be crossed */
  target_band: LOSBand;
  probability: number;
  /** None when the threshold is not projected to be crossed */
  time_to_threshold_s?: number | null;
  /** ped/m/min at the projected peak */
  projected_peak_flow: number;
  confidence: number;
  /** which model produced this; baseline is a valid answer */
  model_id: string;
  /** human-readable drivers, ordered by contribution */
  causes?: string[];
}

/** Why a candidate scored what it did. */
export interface ScoreBreakdown {
  congestion_reduction: number;
  walk_time_cost: number;
  capacity_headroom: number;
  safety_margin: number;
  fairness: number;
  total: number;
}

/** One simulated what-if. Rejected candidates are kept and displayed. */
export interface InterventionCandidate {
  candidate_id: string;
  /** plain language, e.g. 'Divert 30% of Vale to Gate 4' */
  description: string;
  /** 0.0 is the do-nothing baseline */
  divert_fraction: number;
  from_zone: string;
  to_zone: string;
  via?: string[];
  /** ped/m/min */
  projected_peak_flow: number;
  /** positive means longer. Always shown beside the benefit, never hidden. */
  projected_walk_time_delta_s: number;
  projected_bottleneck_duration_s: number;
  score: ScoreBreakdown;
  selected?: boolean;
}

/** What actually goes over the mesh. */
export interface RerouteCommand {
  command_id: string;
  issued_at: number;
  /** commands must expire; stale routing is harmful */
  expires_at: number;
  source_zone: string;
  destination_zone: string;
  avoid?: string[];
  prefer?: string[];
  /** share of affected walkers this should reach */
  target_fraction: number;
  /** plain language, surfaced in the app */
  reason: string;
  /** honest added walking time, stated before the user accepts */
  expected_cost_s: number;
}

export type SafetyOutcome = "approved" | "rejected" | "modified";

/** The gate every action passes through. */
export interface SafetyVerdict {
  command_id: string;
  outcome: SafetyOutcome;
  /** stated even on approval; rejections are explained */
  reason: string;
  violated_constraints?: string[];
  emergency_mode?: boolean;
}

/** When an edge exists at all (D5). */
export interface Availability {
  always_open?: boolean;
  /** session states */
  open_when?: string[];
  closed_when?: string[];
  /** closes this long before cars run */
  close_lead_s?: number;
  reopen_lag_s?: number;
}

/** Local metric frame. Derived from the source bbox, never estimated. */
export interface CoordinateFrame {
  origin_lat: number;
  origin_lon: number;
  rotation_deg?: number;
  /** track extent (x, y) */
  track_bounds_m: unknown[];
  /** (min_x, min_y, max_x, max_y). Larger than the track: car parks, campsites and park-and-ride sit outside it. Sizing to the track clips arrival routes. */
  venue_bounds_m: unknown[];
}

/** The dominant bottleneck mechanism at a circuit. */
export interface Crossing {
  id: string;
  kind: CrossingKind;
  edge_id: string;
  throughput_per_min: Sourced;
  availability?: Availability;
}

export type CrossingKind = "bridge" | "tunnel" | "at_grade";

/** A walkable connection. */
export interface Edge {
  id: string;
  source: string;
  destination: string;
  length_m: number;
  /** required — LOS flow is per metre of width */
  width_m: Sourced;
  /** rise over run; affects walking speed */
  gradient?: number;
  bidirectional?: boolean;
  /** observed where available, else the standards prior */
  free_speed_ms?: Sourced | null;
}

export type Provenance = "osm" | "venue_map" | "f1_circuits" | "authored" | "measured" | "assumed";

/** Hard rules the agent cannot override. */
export interface SafetyConstraints {
  never_route_through?: string[];
  emergency_exits?: string[];
  accessible_routes?: string[][];
}

/** A value with its provenance and, where applicable, its sample count. */
export interface Sourced {
  value: number;
  provenance: Provenance;
  /** observations behind a MEASURED value */
  samples?: number | null;
  note?: string | null;
}

/** A named place. Imported from OSM tags where possible. */
export interface Zone {
  id: string;
  kind: ZoneKind;
  /** human-readable; the app uses this */
  name?: string | null;
  position: Position;
  capacity?: Sourced | null;
  osm_id?: string | null;
}

export type ZoneKind = "gate" | "concourse" | "crossing" | "viewing" | "amenity" | "parking" | "exit";

/** One venue. Swapping circuits must require no code change. */
export interface CircuitPack {
  id: string;
  name: string;
  /** f1-circuits id, e.g. gb-1948 */
  geometry_source: string;
  track_length_m: number;
  altitude_m: number;
  frame: CoordinateFrame;
  zones?: Record<string, Zone>;
  edges?: Record<string, Edge>;
  crossings?: Record<string, Crossing>;
  constraints?: SafetyConstraints;
}

export interface Session {
  id: string;
  /** practice | qualifying | sprint | race | support | ceremony */
  kind: string;
  /** ISO 8601 */
  start: string;
  end: string;
}

/** This weekend's timetable. Changes every event; the circuit does not. */
export interface EventProfile {
  circuit_id: string;
  name: string;
  sessions?: Session[];
  gates_open?: string | null;
}
