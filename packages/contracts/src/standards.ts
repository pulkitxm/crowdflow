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
] as const;
