/** Authored CrowdFlow wire contracts. Runtime derivations live beside them. */

export interface CrossingClosed {
  open: false;
  /**
   * absolute unix seconds; None when no reopening time is known
   */
  opens_at: number | null;
}

/**
 * A timetable fact a spectator cannot infer by looking at the crossing.
 */
export interface CrossingNotice {
  name: string;
  state: CrossingOpen | CrossingClosed;
}

export interface CrossingOpen {
  open: true;
  /**
   * absolute unix seconds; None when no closing time is known
   */
  closes_at: number | null;
}

/**
 * Freshness and reachability, stated rather than hidden.
 */
export interface LinkStatus {
  online: boolean;
  mesh_peers: number;
  /**
   * unix seconds of the newest observation behind the route
   */
  updated_at: number;
}

/**
 * What actually goes over the mesh.
 *
 * Deliberately NOT a per-person route. Broadcasting avoid/prefer sets and
 * letting each device compute its own path scales, and works offline
 * (plan.md section 33).
 */
export interface RerouteCommand {
  command_id: string;
  issued_at: number;
  /**
   * commands must expire; stale routing is harmful
   */
  expires_at: number;
  source_zone: string;
  destination_zone: string;
  avoid?: string[];
  prefer?: string[];
  /**
   * share of affected walkers this should reach
   */
  target_fraction: number;
  /**
   * plain language, surfaced in the app
   */
  reason: string;
  /**
   * honest added walking time, stated before the user accepts
   */
  expected_cost_s: number;
}

/**
 * A proposed alternative and the safety verdict that gates its display.
 */
export interface RerouteOffer {
  command: RerouteCommand;
  verdict: SafetyVerdict;
  instead: Route;
}

/**
 * Where the spectator is, where they are going and the walk between them.
 */
export interface Route {
  id: string;
  from: string;
  to: string;
  steps: Step[];
  /**
   * door-to-door seconds from routing, including waits; never summed on the phone
   */
  total_walk_s: number;
}

export type SafetyOutcome = "approved" | "rejected" | "modified";

/**
 * The gate every action passes through.
 *
 * Hard constraints the AI cannot override: never route through a blocked or
 * forbidden edge, never intentionally exceed capacity, never route away from
 * emergency exits during evacuation (plan.md section 34).
 */
export interface SafetyVerdict {
  command_id: string;
  outcome: SafetyOutcome;
  /**
   * stated even on approval; rejections are explained
   */
  reason: string;
  violated_constraints?: string[];
  emergency_mode?: boolean;
  /**
   * Only the exact command reviewed as APPROVED may leave the gate.
   *
   * ``MODIFIED`` describes a rejected proposal for which safety can suggest a
   * correction; it does not contain that corrected command. Dispatching the
   * original in that state would act on the version safety changed. A
   * corrected command must be issued separately and reviewed in full.
   */
  dispatchable: boolean;
}

/**
 * One already-priced leg of a route.
 */
export interface Step {
  id: string;
  /**
   * human-readable landmark from the circuit pack
   */
  to: string;
  /**
   * walking seconds computed by the routing engine
   */
  walk_s: number;
  way_ahead: WayAhead;
  crossing?: CrossingNotice | null;
}

export type WayAhead = "nominal" | "building" | "critical" | "unknown";

export interface AheadView {
  now: number;
  link: LinkStatus;
  route: Route;
  kind: "ahead";
  step_id: string;
  offer: RerouteOffer;
}

export interface GateChoice {
  zone_id: string;
  name: string;
  walk_s: number;
  way_ahead: WayAhead;
  note?: string | null;
  selected?: boolean;
}

export interface ArrivalView {
  now: number;
  link: LinkStatus;
  route: Route;
  kind: "arrival";
  gates: GateChoice[];
  note: string;
}

/**
 * When an edge exists at all (D5).
 *
 * `blocked: bool` cannot express "open until quali, then closed for sixty
 * minutes". At-grade crossings close whenever cars are running, which makes
 * routing time-dependent: a path is valid only if each edge is still open when
 * the walker would actually reach it.
 */
export interface Availability {
  always_open?: boolean;
  /**
   * session states
   */
  open_when?: string[];
  closed_when?: string[];
  /**
   * closes this long before cars run
   */
  close_lead_s?: number;
  reopen_lag_s?: number;
}

/**
 * Local metric frame. Derived from the source bbox, never estimated.
 */
export interface CoordinateFrame {
  origin_lat: number;
  origin_lon: number;
  rotation_deg?: number;
  /**
   * track extent (x, y)
   */
  track_bounds_m: unknown[];
  /**
   * (min_x, min_y, max_x, max_y). Larger than the track: car parks, campsites and park-and-ride sit outside it. Sizing to the track clips arrival routes.
   */
  venue_bounds_m: unknown[];
}

/**
 * The dominant bottleneck mechanism at a circuit.
 *
 * Bridges and tunnels stay open but carry far less than the at-grade crossings
 * they replace — which is exactly why they pinch when a session starts.
 */
export interface Crossing {
  id: string;
  kind: CrossingKind;
  edge_id: string;
  throughput_per_min: Sourced;
  availability?: Availability;
}

export type CrossingKind = "bridge" | "tunnel" | "at_grade";

/**
 * A walkable connection.
 *
 * width_m matters more than it looks: flow rate is per metre of width, so the
 * LOS band cannot be computed without it.
 */
export interface Edge {
  id: string;
  source: string;
  destination: string;
  length_m: number;
  /**
   * required — LOS flow is per metre of width
   */
  width_m: Sourced;
  /**
   * rise over run; affects walking speed
   */
  gradient?: number;
  bidirectional?: boolean;
  /**
   * observed where available, else the standards prior
   */
  free_speed_ms?: Sourced | null;
  /**
   * observed peak sustained flow per metre of width; never invented
   */
  capacity_flow_ped_m_min?: Sourced | null;
}

/**
 * A point in the venue's local metric frame, in metres.
 *
 * Never latitude/longitude. Lat/lon exists only at the circuit pack's origin and
 * at the device's location adapter (plan.md section 10).
 */
export interface Position {
  /**
   * metres east of venue origin
   */
  x: number;
  /**
   * metres north of venue origin
   */
  y: number;
}

/**
 * Where a value came from. Never decorative — routing weights it.
 */
export type Provenance = "osm" | "venue_map" | "f1_circuits" | "authored" | "measured" | "assumed";

/**
 * Hard rules the agent cannot override.
 */
export interface SafetyConstraints {
  never_route_through?: string[];
  emergency_exits?: string[];
  accessible_routes?: string[][];
}

/**
 * A value with its provenance and, where applicable, its sample count.
 */
export interface Sourced {
  value: number;
  provenance: Provenance;
  /**
   * observations behind a MEASURED value
   */
  samples?: number | null;
  note?: string | null;
}

/**
 * A named place. Imported from OSM tags where possible.
 */
export interface Zone {
  id: string;
  kind: ZoneKind;
  /**
   * human-readable; the app uses this
   */
  name?: string | null;
  position: Position;
  capacity?: Sourced | null;
  osm_id?: string | null;
}

export type ZoneKind = "gate" | "concourse" | "crossing" | "viewing" | "amenity" | "parking" | "exit";

/**
 * One venue. Swapping circuits must require no code change.
 */
export interface CircuitPack {
  id: string;
  name: string;
  /**
   * f1-circuits id, e.g. gb-1948
   */
  geometry_source: string;
  track_length_m: number;
  altitude_m: number;
  frame: CoordinateFrame;
  zones?: Record<string, Zone>;
  edges?: Record<string, Edge>;
  crossings?: Record<string, Crossing>;
  constraints?: SafetyConstraints;
}

/**
 * How much to trust the state beside it.
 *
 * Never presented without the claim it qualifies. With thirty nodes reporting,
 * the system says so; it does not quietly present the same number it would give
 * for four hundred.
 */
export interface Confidence {
  value: number;
  /**
   * devices contributing to this estimate
   */
  observed_nodes: number;
  /**
   * age of the newest observation
   */
  freshness_s: number;
  /**
   * mean positional 1-sigma
   */
  mean_accuracy_m: number;
  /**
   * agreement with recent estimates for this zone
   */
  stability: number;
  /**
   * The contract's served judgement; clients never restate its thresholds.
   */
  reportable: boolean;
}

/**
 * One anonymous device's live movement state.
 *
 * node_id is a rotating pseudonym, not an identity. It is valid only within its
 * rotation epoch and must never be joined across epochs.
 */
export interface CrowdNode {
  /**
   * rotating pseudonym, valid within its epoch only
   */
  node_id: string;
  /**
   * ID rotation epoch; IDs are not comparable across epochs
   */
  epoch: number;
  /**
   * unix seconds
   */
  timestamp: number;
  position: Position;
  /**
   * metres per second
   */
  speed_ms: number;
  /**
   * degrees clockwise from north
   */
  heading_deg: number;
  /**
   * positional 1-sigma; feeds the confidence model
   */
  accuracy_m: number;
  /**
   * assigned by the state engine, not self-reported
   */
  zone_id?: string | null;
}

export interface Session {
  id: string;
  /**
   * practice | qualifying | sprint | race | support | ceremony
   */
  kind: string;
  /**
   * ISO 8601
   */
  start: string;
  end: string;
}

/**
 * This weekend's timetable. Changes every event; the circuit does not.
 *
 * The chequered flag is the largest crowd-movement trigger of the day, so this
 * feeds the predictor directly, not just the display.
 */
export interface EventProfile {
  circuit_id: string;
  name: string;
  sessions?: Session[];
  gates_open?: string | null;
}

/**
 * Operational density band. Always rendered with its word and its number.
 */
export type LOSBand = "nominal" | "building" | "critical";

/**
 * Where congestion will be, when, and why.
 *
 * The headline is time_to_threshold_s, not the current value. "2:47 until
 * capacity" drives a decision; "87% full" does not.
 */
export interface Forecast {
  zone_id: string;
  issued_at: number;
  /**
   * how far ahead this forecast looks
   */
  horizon_s: number;
  /**
   * the band predicted to be crossed
   */
  target_band: LOSBand;
  probability: number;
  /**
   * None when the threshold is not projected to be crossed
   */
  time_to_threshold_s?: number | null;
  /**
   * persons/m2 at the projected peak; bands are classified on density
   */
  projected_peak_density_persons_m2: number;
  confidence: number;
  /**
   * which model produced this; baseline is a valid answer
   */
  model_id: string;
  /**
   * human-readable drivers, ordered by contribution
   */
  causes?: string[];
  /**
   * Served judgement: clients must not duplicate these thresholds.
   */
  actionable: boolean;
}

export interface LeaveOption {
  id: string;
  label: string;
  /**
   * door-to-car seconds, including any wait
   */
  total_s: number;
  way_ahead: WayAhead;
  spent: string;
  /**
   * engine-authored reason this option is recommended; absent otherwise
   */
  recommendation_note?: string | null;
}

export interface HoldView {
  now: number;
  link: LinkStatus;
  route: Route;
  kind: "hold";
  options: LeaveOption[];
  recommended_id: string;
  headline: string;
  because: string;
}

/**
 * Why a candidate scored what it did.
 *
 * Shown to the operator. An intervention recommendation without its components
 * is an assertion; with them it is an argument.
 */
export interface ScoreBreakdown {
  congestion_reduction: number;
  walk_time_cost: number;
  capacity_headroom: number;
  safety_margin: number;
  fairness: number;
  total: number;
}

/**
 * One simulated what-if. Rejected candidates are kept and displayed.
 */
export interface InterventionCandidate {
  candidate_id: string;
  /**
   * plain language, e.g. 'Divert 30% of Vale to Gate 4'
   */
  description: string;
  /**
   * 0.0 is the do-nothing baseline
   */
  divert_fraction: number;
  from_zone: string;
  to_zone: string;
  via?: string[];
  /**
   * persons/m2 at the projected peak
   */
  projected_peak_density_persons_m2: number;
  /**
   * positive means longer. Always shown beside the benefit, never hidden.
   */
  projected_walk_time_delta_s: number;
  projected_bottleneck_duration_s: number;
  score: ScoreBreakdown;
  selected?: boolean;
}

/**
 * Traffic class, which selects the routing protocol.
 *
 * Flooding everything is epidemic routing: highest delivery, but buffer
 * exhaustion and battery drain, which is fatal for phones in pockets.
 * See plan/methods.md section 5. The UPLINK recommendation was deliberately
 * revised after measurement: PRoPHET bought only 0.6 percentage points of
 * delivery for about 3.1x the radio traffic, so both loss-tolerant classes now
 * use the bounded policy until encounter predictability proves a material gain.
 */
export type MeshClass = "state" | "uplink" | "urgent";

export type MeshMessageType = "hello" | "peer_discovery" | "state_update" | "zone_update" | "trace_fragment" | "route_update" | "alert" | "reroute" | "ack" | "heartbeat" | "sync";

/**
 * Envelope for anything crossing the mesh.
 *
 * sequence prevents duplicate processing; ttl stops packets travelling forever.
 * Both are enforced at every hop, not just at the destination.
 */
export interface MeshMessage {
  type: MeshMessageType;
  traffic_class: MeshClass;
  /**
   * rotating node pseudonym of the originator
   */
  source: string;
  /**
   * per-source monotonic; used for dedupe
   */
  sequence: number;
  /**
   * hops remaining
   */
  ttl: number;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface OfflineView {
  now: number;
  link: LinkStatus;
  route: Route;
  kind: "offline";
}

export interface ReroutedView {
  now: number;
  link: LinkStatus;
  route: Route;
  kind: "rerouted";
  instead_of: Route;
  added_s: number;
  reason: string;
}

export interface WalkView {
  now: number;
  link: LinkStatus;
  route: Route;
  kind: "walk";
}

/**
 * One of the six screen states for a race day.
 */
export type SpectatorView = ArrivalView | WalkView | AheadView | ReroutedView | OfflineView | HoldView;

/**
 * A short, noised path segment contributed for venue refinement.
 *
 * Carries planar Laplace noise applied ON DEVICE before storage
 * (geo-indistinguishability, Andres et al. CCS 2013 -- see plan/methods.md
 * section 4). Fragments are deliberately too short to reconstruct one person's
 * day, and their IDs rotate per fragment.
 *
 * Accurate in aggregate, deniable individually: map refinement is density
 * estimation over many fragments, and zero-mean noise averages out.
 */
export interface TraceFragment {
  /**
   * per-fragment random; never reused, never linkable
   */
  fragment_id: string;
  /**
   * noised, in venue frame
   */
  points: Position[];
  /**
   * unix seconds
   */
  t_start: number;
  /**
   * unix seconds
   */
  t_end: number;
  /**
   * geo-indistinguishability privacy parameter actually applied
   */
  epsilon: number;
  /**
   * radius within which the true path is indistinguishable
   */
  noise_radius_m: number;
}

/**
 * One zone at one instant.
 */
export interface ZoneState {
  zone_id: string;
  timestamp: number;
  /**
   * devices seen; NOT people
   */
  observed_nodes: number;
  /**
   * measured, never assumed — see standards.MEASURED_NOT_ASSUMED
   */
  participation_rate: number;
  /**
   * persons per square metre — the AUTHORITATIVE measure. Flow is not monotonic in density (it peaks then collapses), so a band cannot be read off flow alone: a jammed corridor and an empty one look alike.
   */
  density_persons_m2: number;
  /**
   * pedestrians per metre width per minute — reported, not classified on
   */
  flow_ped_m_min: number;
  /**
   * people who do not fit at jam density, i.e. backed up behind
   */
  queue_excess?: number;
  mean_speed_ms: number;
  dominant_heading_deg?: number | null;
  inflow_per_min: number;
  outflow_per_min: number;
  confidence: Confidence;
  /**
   * Observed devices scaled by measured participation.
   *
   * The single most load-bearing number in the system, which is why
   * participation_rate is measured rather than configured.
   */
  estimated_population: number;
  /**
   * Operational band, classified on density (see standards.band_for_density).
   *
   * CRITICAL means at or beyond capacity density — the point where flow stops
   * improving and starts to collapse — not a high flow number.
   */
  band: LOSBand;
  /**
   * Past the peak of the fundamental diagram: more arrivals now reduce
   * throughput. The single most important operator signal.
   */
  over_capacity: boolean;
  /**
   * Full Fruin grade A-F. Console only; the app never shows this.
   */
  los_grade: string;
  /**
   * Positive means filling. Sustained positive net flow is the early warning.
   */
  net_flow_per_min: number;
}

/**
 * Every zone at one tick, plus what the system knows it cannot see.
 */
export interface VenueState {
  circuit_id: string;
  timestamp: number;
  /**
   * drives crossing availability
   */
  session_id?: string | null;
  zones?: Record<string, ZoneState>;
  /**
   * Zones with no reporting device. MUST render as unknown, never as empty. Under D7 uplinks are opportunistic, so coverage genuinely varies.
   */
  unobserved_zones?: string[];
}
