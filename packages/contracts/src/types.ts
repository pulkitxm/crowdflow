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

export type SafetyOutcome = 'approved' | 'rejected' | 'modified';

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
  unchecked_constraints?: string[];
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

export type WayAhead = 'nominal' | 'building' | 'critical' | 'unknown';

export interface AheadView {
  now: number;
  link: LinkStatus;
  route: Route;
  kind: 'ahead';
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
  kind: 'arrival';
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

export type CrossingKind = 'bridge' | 'tunnel' | 'at_grade';

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
  geometry: Position[];
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
export type Provenance = 'osm' | 'venue_map' | 'f1_circuits' | 'authored' | 'measured' | 'assumed';

/**
 * Hard rules the agent cannot override.
 */
export interface SafetyConstraints {
  never_route_through?: string[];
  never_route_edges?: string[];
  emergency_exits?: string[];
  accessible_routes?: string[][];
}

export type CircuitCapability = 'synthetic_simulation' | 'venue_imported' | 'venue_reviewed';

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

export type ZoneKind = 'gate' | 'concourse' | 'crossing' | 'viewing' | 'amenity' | 'parking' | 'exit';

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
  layout_id: string;
  capability: CircuitCapability;
  track_length_m: number;
  altitude_m: number;
  track_clearance_m: Sourced;
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
  /** As the sport names it: 'Practice 1', 'Sprint Qualifying', 'Race'. */
  name?: string;
  /**
   * Whether the end time was published or inferred.
   *
   * Session ends move — a race runs long, a session is red-flagged — and the
   * egress prediction hangs off the end of the race more than anything else in
   * this system. An assumed end is a guess about the largest crowd-movement
   * trigger of the day, and it must not read like a schedule.
   */
  end_provenance?: Provenance;
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
  /**
   * Championship round. What a spectator actually says — "round twelve", not a
   * circuit id — and the natural sort key for a season.
   */
  round?: number;
  season?: number;
  /**
   * Race day, ISO 8601 date. The weekend spans three days; this is the one that
   * matters, and the one the chequered-flag egress trigger hangs off.
   */
  date?: string;
  /** Town, then country. How a venue is found on a map and named in a ticket. */
  locality?: string;
  country?: string;
  /** ISO 3166-1 alpha-3, where the source gives one. For a flag, nothing more. */
  country_code?: string;
  /**
   * The venue's offset from UTC over the weekend, as '+01:00'.
   *
   * Carried because every timestamp in this contract is UTC and every session
   * time a spectator reads is local. A phone at the circuit is on venue time
   * anyway; a phone being used to plan the trip from another country is not, and
   * that is exactly when somebody misreads a start time by an hour.
   */
  utc_offset?: string;
}

/**
 * Operational density band. Always rendered with its word and its number.
 */
export type LOSBand = 'nominal' | 'building' | 'critical';

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
  kind: 'hold';
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
export type MeshClass = 'state' | 'uplink' | 'urgent';

export type MeshMessageType =
  | 'hello'
  | 'peer_discovery'
  | 'state_update'
  | 'zone_update'
  | 'trace_fragment'
  | 'route_update'
  | 'alert'
  | 'reroute'
  | 'ack'
  | 'heartbeat'
  | 'sync';

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
  kind: 'offline';
}

export interface ReroutedView {
  now: number;
  link: LinkStatus;
  route: Route;
  kind: 'rerouted';
  instead_of: Route;
  added_s: number;
  reason: string;
}

export interface WalkView {
  now: number;
  link: LinkStatus;
  route: Route;
  kind: 'walk';
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

/**
 * ---------------------------------------------------------------------------
 * Radio positioning
 * ---------------------------------------------------------------------------
 *
 * How a handset answers "where am I, in venue metres" when GNSS alone is not
 * enough. Three radios, one ladder, in this order of preference:
 *
 *   Wi-Fi   scan the access points in range, range each one from its RSSI,
 *           trilaterate against a surveyed anchor map. Android only — iOS has
 *           no public AP-scan API and never has.
 *   BLE     the same solve against beacon anchors. Works on both platforms,
 *           shorter range, so it wins indoors and under stands where the Wi-Fi
 *           anchor map is thin.
 *   GNSS    lat/lon from the platform's fused provider, projected into the
 *           venue frame. At an open circuit this is usually the best of the
 *           three; under a grandstand it is the worst.
 *
 * The ladder is a preference, not a hierarchy of trust: the fuser picks on
 * measured accuracy, and every fix carries the radio that produced it so a
 * console can say "this dot came from Bluetooth" rather than implying all dots
 * are equal.
 *
 * What crosses the network is the OUTPUT of this, never the input. Radio
 * observations name the access points and beacons around a person, which is a
 * location by another name and a far more identifying one; they are resolved
 * to a position on the handset and discarded there. The only exception is an
 * explicit operator survey (see SurveyReport), which is a walk test by staff,
 * not a spectator's phone.
 */

/**
 * Which radio produced a position.
 *
 * Not decorative and not merely diagnostic: accuracy differs by an order of
 * magnitude between these, the confidence model weights on it, and an operator
 * reading a sparse zone is entitled to know whether the dots there are GNSS
 * fixes in the open or BLE fixes under a stand.
 */
export type PositionSource = 'gnss' | 'wifi' | 'ble' | 'fused' | 'dead_reckoning';

export type AnchorKind = 'wifi_ap' | 'ble_beacon';

/**
 * One surveyed radio landmark at a known place in the venue.
 *
 * `anchor_id` is a digest of the hardware identifier (BSSID, or beacon
 * UUID/major/minor), never the identifier itself. That is not a privacy
 * measure — the MAC space is small enough to brute force — it is so that a
 * pack committed to this repository does not publish a venue's Wi-Fi
 * infrastructure inventory. The privacy measure is that anchor ids stay on the
 * handset.
 *
 * `rssi_at_1m_dbm` and `path_loss_exponent` are per-anchor because they are
 * properties of an installation, not of a radio standard: an AP behind a metal
 * panel and one on a mast have the same chipset and different curves. Both are
 * Sourced, so a pack can be honest that a given anchor was placed off a site
 * plan (assumed) rather than walked (measured), and the solver can down-weight
 * it accordingly.
 */
export interface RadioAnchor {
  /**
   * digest of the hardware identifier, never the identifier
   */
  anchor_id: string;
  kind: AnchorKind;
  /**
   * venue frame, metres
   */
  position: Position;
  /**
   * calibrated received strength at one metre — the intercept of the range curve
   */
  rssi_at_1m_dbm: Sourced;
  /**
   * the exponent of the log-distance model. Free space is 2; a packed concourse is nearer 3.5 because bodies absorb 2.4 GHz.
   */
  path_loss_exponent: Sourced;
  /**
   * for multi-level venues; null in a single-level frame
   */
  floor?: number | null;
  note?: string | null;
}

/**
 * A surveyed anchor map for one circuit.
 *
 * Shipped beside the circuit pack rather than inside it because it decays on a
 * different clock: the geography is good for a decade, the Wi-Fi estate is
 * re-cabled between events.
 */
export interface AnchorPack {
  circuit_id: string;
  /**
   * when the survey was walked, ISO 8601. A fix from a year-old anchor map is a guess wearing a number.
   */
  surveyed_at?: string | null;
  anchors?: Record<string, RadioAnchor>;
}

/**
 * One radio heard once. Never leaves the handset except in an operator survey.
 */
export interface RadioObservation {
  anchor_id: string;
  kind: AnchorKind;
  /**
   * received signal strength, dBm. Negative; closer to zero is stronger.
   */
  rssi_dbm: number;
  /**
   * unix seconds
   */
  timestamp: number;
  /**
   * 2.4 GHz and 5 GHz attenuate differently; the solver uses it to pick the exponent when the anchor does not supply one
   */
  frequency_mhz?: number | null;
}

/**
 * A resolved position, with the honesty attached.
 *
 * `accuracy_m` is a one-sigma radius, and `residual_m` is what the solve could
 * not explain. They fail apart on purpose: a tight `accuracy_m` beside a large
 * `residual_m` means the anchor map is wrong, not that the phone is confused,
 * and that is the difference between recalibrating a venue and blaming a
 * handset.
 */
export interface PositionFix {
  /**
   * venue frame, metres
   */
  position: Position;
  /**
   * positional one-sigma. Feeds Confidence; never zero.
   */
  accuracy_m: number;
  source: PositionSource;
  /**
   * unix seconds
   */
  timestamp: number;
  /**
   * anchors that contributed. Zero for GNSS, and a two-anchor fix is a weighted centroid rather than a trilateration — the count is how a reader tells which.
   */
  anchors_used: number;
  /**
   * RMS of the range residuals, metres. Null when the source does not solve (GNSS).
   */
  residual_m?: number | null;
  /**
   * metres per second, from successive fixes. Null until there are two.
   */
  speed_ms?: number | null;
  /**
   * degrees clockwise from north. Null when speed is below the noise floor, because the heading of a stationary phone is noise with a number on it.
   */
  heading_deg?: number | null;
}

/**
 * What a handset uploads.
 *
 * Deliberately made of CrowdNode and nothing else. There are no anchor ids
 * here, no RSSI, no scan lists: those are resolved on the phone and dropped.
 * A report is a position, a speed and a heading under a rotating pseudonym —
 * enough to count a crowd, not enough to follow a person.
 *
 * Batched because uplinks are opportunistic (D7): a phone with no data
 * connection keeps sensing and sends the backlog when it next has one.
 */
export interface NodeReport {
  person_id: number;
  gate_id?: string;
  /**
   * rotating pseudonym, valid within its epoch only
   */
  node_id: string;
  epoch: number;
  circuit_id: string;
  /**
   * which disclosure this person actually agreed to. A report under an unknown consent version is rejected, not accepted-and-flagged.
   */
  consent_version: string;
  /**
   * one or more samples, oldest first
   */
  nodes: CrowdNode[];
  /**
   * which radios were usable while this batch was formed. Explains a coverage gap: 'the zone is empty' and 'every phone in the zone lost its anchor map' look identical without it.
   */
  sources?: PositionSource[];
}

/**
 * The server's answer to a batch.
 */
export interface IngestAck {
  accepted: number;
  /**
   * samples dropped, with why in `problems`
   */
  rejected: number;
  problems?: string[];
  /**
   * unix seconds, server clock. Lets a handset correct drift without a time API — timestamps decide the staleness window, so a phone six minutes fast reports nothing that counts.
   */
  server_time: number;
  /**
   * Stop uploading and stop sensing. Set when the session has ended or the disclosure this report cites is no longer served. A phone that keeps sensing after the event is a battery complaint and a privacy problem.
   */
  stop: boolean;
}

/**
 * An operator walk test: observations WITH their positions, to build an anchor map.
 *
 * The one path where raw radio observations legitimately leave a device, and it
 * is a staff device on a surveying job, not a spectator's phone. Separate
 * contract, separate endpoint, separate consent — so that no amount of
 * refactoring can quietly widen the spectator path into this one.
 */
export interface SurveyReport {
  circuit_id: string;
  /**
   * who walked it; a staff identifier, not a pseudonym
   */
  surveyor: string;
  samples?: SurveySample[];
}

export interface SurveySample {
  /**
   * ground truth for this sample, venue frame
   */
  position: Position;
  /**
   * how well the surveyor knew where they were standing
   */
  accuracy_m: number;
  timestamp: number;
  observations?: RadioObservation[];
}

/**
 * What one handset's sensing stack is doing, as the person is shown it.
 *
 * Exists as a contract rather than app state because the app must be able to
 * answer "what are you doing with my phone right now" in the same words the
 * console uses. A settings screen that paraphrases is a settings screen that
 * drifts.
 */
export interface SensingStatus {
  /**
   * whether the loop is running at all
   */
  active: boolean;
  /**
   * radios usable on this handset right now, best first
   */
  available?: PositionSource[];
  /**
   * the source of the most recent accepted fix
   */
  using?: PositionSource | null;
  last_fix?: PositionFix | null;
  /**
   * samples held because there is no uplink
   */
  queued: number;
  /**
   * why sensing is not running, in words a person can act on ('Bluetooth is off', not 'ERR_ADAPTER_STATE')
   */
  blocked_by?: string[];
}
