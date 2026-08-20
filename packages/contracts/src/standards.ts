/** CrowdFlow's constants registry. Every assumption is named and documented. */

export const LOS_A_MAX = 23;
export const LOS_B_MAX = 33;
export const LOS_C_MAX = 49;
export const LOS_D_MAX = 66;
export const LOS_E_MAX = 82;

export const FREE_FLOW_SPEED_MS = 1.34;
export const JAM_DENSITY_PERSONS_M2 = 4;
export const OBSERVED_HIGH_DENSITY_PERSONS_M2 = 4.7;
export const CAPACITY_DENSITY = JAM_DENSITY_PERSONS_M2 / 2;

import type { LOSBand } from './types.js';

export function densityForFlow(
  flowPedMMin: number,
  freeSpeedMs = FREE_FLOW_SPEED_MS,
  jamDensity = JAM_DENSITY_PERSONS_M2,
): number | null {
  const c = (flowPedMMin * jamDensity) / (60 * freeSpeedMs);
  const discriminant = jamDensity ** 2 - 4 * c;
  return discriminant < 0 ? null : (jamDensity - Math.sqrt(discriminant)) / 2;
}

export const DENSITY_NOMINAL_MAX = densityForFlow(LOS_C_MAX) ?? 0.75;
export const DENSITY_BUILDING_MAX = CAPACITY_DENSITY;

/** Authoritative classifier. Flow is non-monotonic and must never classify a zone. */
export function bandForDensity(personsM2: number): LOSBand {
  if (personsM2 < DENSITY_NOMINAL_MAX) return 'nominal';
  if (personsM2 < DENSITY_BUILDING_MAX) return 'building';
  return 'critical';
}

export function losGradeForFlow(flowPedMMin: number): string {
  for (const [grade, max] of [
    ['A', LOS_A_MAX],
    ['B', LOS_B_MAX],
    ['C', LOS_C_MAX],
    ['D', LOS_D_MAX],
    ['E', LOS_E_MAX],
  ] as const) {
    if (flowPedMMin < max) return grade;
  }
  return 'F';
}

export const ASSUMED_REPORTABLE_CONFIDENCE_FLOOR = 0.25;
export const ASSUMED_REPORTABLE_NODE_FLOOR = 3;
export const ASSUMED_ACTIONABLE_PROBABILITY_FLOOR = 0.6;
export const ASSUMED_ACTIONABLE_CONFIDENCE_FLOOR = 0.5;
export const ASSUMED_CONFIDENCE_COUNT_SATURATION = 200;
export const ASSUMED_CONFIDENCE_COUNT_WEIGHT = 0.55;
export const ASSUMED_POSITION_ACCURACY_BEST_M = 5;
export const ASSUMED_POSITION_ACCURACY_WORST_M = 50;
export const ASSUMED_ROUTE_CACHE_ENTRIES = 4096;
export const ASSUMED_ORPHAN_ZONE_LENGTH_M = 25;
export const ASSUMED_ORPHAN_ZONE_WIDTH_M = 2;

export const MEASURED_SAMPLE_FLOOR = 30;
export const MAD_TO_SIGMA = 1.4826;
export const MODIFIED_Z_OUTLIER = 3.5;

export const ASSUMED_RADIO_RANGE_CROWD_M = 30;
export const PROPHET_P_INIT = 0.75;
export const PROPHET_BETA = 0.25;
export const PROPHET_GAMMA = 0.98;
export const ASSUMED_SPRAY_COPY_SCALING = 1;
export const MESH_TTL_MAX = 8;
export const ASSUMED_HOP_LATENCY_S = 5;
export const ASSUMED_MESH_BUFFER_MESSAGES = 256;
export const ASSUMED_URGENT_RELAYS_PER_MIN = 30;
export const ASSUMED_URGENT_BURST_RELAYS = 15;
export const ASSUMED_UPLINK_BATTERY_RESERVE = 0.2;
export const ASSUMED_SKEW_WINDOW_S = 300;
export const ASSUMED_DEMO_POPULATION = 2500;
export const ASSUMED_ANTHROPIC_THINKING_BUDGET_TOKENS = 4000;

export function prophetTimeUnitS(
  radioRangeM = ASSUMED_RADIO_RANGE_CROWD_M,
  walkSpeedMs = FREE_FLOW_SPEED_MS,
  gamma = PROPHET_GAMMA,
): number {
  return (radioRangeM / walkSpeedMs) * Math.log(1 / gamma) / Math.log(2);
}

export function sprayCopiesFor(reachableNodes: number): number {
  if (reachableNodes <= 0) return 2;
  return Math.max(2, Math.ceil(ASSUMED_SPRAY_COPY_SCALING * Math.sqrt(reachableNodes)));
}

export function dedupeRetentionS(
  ttl = MESH_TTL_MAX,
  hopLatencyS = ASSUMED_HOP_LATENCY_S,
): number {
  return ttl * hopLatencyS;
}

export const GEOIND_PRIVACY_LEVEL = Math.log(4);
export const ASSUMED_GEOIND_RADIUS_M = 50;
export const GEOIND_EPSILON_VENUE = GEOIND_PRIVACY_LEVEL / ASSUMED_GEOIND_RADIUS_M;
export const ASSUMED_FRAGMENT_MAX_DURATION_S = 120;
export const CAPTURE_RECAPTURE_MIN_SAMPLE = 2;
export const CAPTURE_RECAPTURE_MIN_OVERLAP = 1;
export const ASSUMED_PRIVATE_SKETCH_K = 32;
export const ASSUMED_PRIVATE_SKETCH_EPSILON = 1;

/**
 * Radio positioning.
 *
 * Every number here is a starting value for a curve that must be walked before
 * it can be trusted. `rssi_at_1m` and the path-loss exponent are the intercept
 * and the slope of the same line, and the line is a property of one
 * installation in one crowd — an anchor behind a metal panel and one on a mast
 * share a datasheet and nothing else. So these are ASSUMED, they are the
 * defaults a `RadioAnchor` overrides with its own Sourced values, and
 * 'path_loss_exponent' is on the measured-not-assumed list below.
 */

/** Free-space reference for a 2.4 GHz AP at one metre. */
export const ASSUMED_WIFI_RSSI_AT_1M_DBM = -40;
/** The iBeacon convention, which is a one-metre reference and not a 2.4 GHz law. */
export const ASSUMED_BLE_RSSI_AT_1M_DBM = -59;
/** Free space is 2.0. Open paddock tarmac with line of sight sits just above it. */
export const ASSUMED_PATH_LOSS_EXPONENT_OPEN = 2.2;
/**
 * A packed concourse. Water absorbs 2.4 GHz and a crowd is mostly water, so the
 * exponent rises with the density it is measuring — which is why a fix degrades
 * exactly where the system most needs one.
 */
export const ASSUMED_PATH_LOSS_EXPONENT_CROWD = 3.3;
/** Under a grandstand: concrete, steel and no line of sight to anything. */
export const ASSUMED_PATH_LOSS_EXPONENT_COVERED = 3.8;

/** Below three, the geometry is not a fix. Two anchors give a weighted centroid, and the contract says so via PositionFix.anchors_used. */
export const ASSUMED_MIN_ANCHORS_FOR_FIX = 3;
/** An observation older than this describes where the phone was, not where it is. */
export const ASSUMED_ANCHOR_OBSERVATION_TTL_S = 20;
/**
 * Android throttles foreground Wi-Fi scans to four per two minutes since 9
 * (Pie). A platform fact, not a preference: ask for more and the extra calls
 * return the previous results with old timestamps, which is worse than not
 * asking. Everything about the Wi-Fi cadence follows from this one number.
 */
export const ANDROID_WIFI_SCAN_THROTTLE_PER_2_MIN = 4;
export const ASSUMED_WIFI_SCAN_INTERVAL_S = 120 / ANDROID_WIFI_SCAN_THROTTLE_PER_2_MIN;
/** A BLE scan window long enough to hear a beacon advertising at 1 Hz more than once. */
export const ASSUMED_BLE_SCAN_WINDOW_S = 4;
/** GNSS is cheap to sample and the fused provider caches, so this is the loop cadence rather than a duty cycle. */
export const ASSUMED_GNSS_SAMPLE_INTERVAL_S = 10;

/**
 * A fix wider than this is not a position, it is a zone name with extra steps.
 * Rejected outright rather than reported with a large sigma, because the state
 * engine would place it in a zone and the operator would count it there.
 */
export const ASSUMED_FIX_ACCURACY_CEILING_M = 60;
/** No radio solve can beat this; anything tighter is the solver flattering itself. */
export const ASSUMED_FIX_ACCURACY_FLOOR_M = 3;
/** After this, the last fix is history and the node stops reporting rather than repeating itself. */
export const ASSUMED_FIX_STALE_S = 45;
/**
 * How much better a challenger must be before the fuser switches source.
 * Without hysteresis two sources of similar quality trade the lead every tick,
 * and the resulting position jitters between two solutions that are each fine —
 * which reads on a console as a person vibrating.
 */
export const ASSUMED_SOURCE_SWITCH_HYSTERESIS = 1.25;
/**
 * How long a moving node may be carried on its last velocity with no new fix.
 * Long enough to cross a Wi-Fi scan gap, short enough that it cannot walk a
 * phone through a wall and into the next zone.
 */
export const ASSUMED_DEAD_RECKONING_MAX_S = 15;
/** Below this, reported speed is sensor noise and heading is meaningless. */
export const ASSUMED_HEADING_SPEED_FLOOR_MS = 0.3;
/** Displacement smoothing across fixes: fully responsive is jitter, fully damped is a stale dot. */
export const ASSUMED_VELOCITY_SMOOTHING = 0.4;

/** How often the handset's pseudonym rotates. An id that outlives the walk is a trail. */
export const ASSUMED_ID_ROTATION_S = 900;
/** Samples per upload batch. Bounded so an uplink that has been unreachable for an hour cannot arrive as one enormous request. */
export const ASSUMED_UPLINK_BATCH_MAX = 60;
export const ASSUMED_UPLINK_INTERVAL_S = 30;
/** Retained sensing beyond this is deleted, reported or not. The disclosure says 24 hours; this is that sentence in code. */
export const RETENTION_MAX_S = 24 * 60 * 60;

/**
 * The disclosure a report cites.
 *
 * Versioned because the sentence people agreed to is part of the data. If the
 * wording of what the app promises changes, reports gathered under the old
 * wording are not retroactively covered by the new one — so the version travels
 * with every batch and the server rejects an id it does not serve, rather than
 * accepting the data and sorting the consent question out later.
 */
export const LOCATION_DISCLOSURE_VERSION = 'location-disclosure.v1';

/** Disclosure versions still honoured. Withdraw one by removing it here: every
 *  handset still citing it stops being accepted, and stops sensing, on the next
 *  batch — because `IngestAck.stop` says so. */
export const SERVED_DISCLOSURE_VERSIONS = [LOCATION_DISCLOSURE_VERSION] as const;

/**
 * How long a session lasts when nobody published an end time.
 *
 * Jolpica gives session START times only. An end has to come from somewhere, and
 * these are the sporting regulations' scheduled durations — a practice hour, a
 * qualifying hour, a race capped at two. They are ASSUMED because a session that
 * is red-flagged, shortened for weather or run to the two-hour limit ends when it
 * ends, and the chequered flag is the single largest crowd-movement trigger of
 * the day. Every session built from these carries `end_provenance: 'assumed'` so
 * nothing downstream mistakes the number for a schedule.
 */
export const ASSUMED_SESSION_MINUTES: Record<string, number> = {
  practice: 60,
  qualifying: 60,
  sprint: 30,
  race: 120,
  support: 45,
  ceremony: 30,
};

export const MEASURED_NOT_ASSUMED = [
  'participation_rate',
  'zone_capacity',
  'corridor_width',
  'walking_speed',
  'time_to_congestion',
  'prediction_confidence',
  'radio_range',
  'hop_latency',
  'uplink_coverage',
  'path_loss_exponent',
  'anchor_position',
  'fix_accuracy',
] as const;
