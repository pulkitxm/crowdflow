/**
 * Turning a signal strength into a distance, and being honest about the error.
 *
 * The log-distance model:
 *
 *     RSSI(d) = RSSI(1 m) - 10 * n * log10(d)
 *
 * inverted for d. Two parameters: the intercept `rssiAt1m`, which is a property
 * of the transmitter and its enclosure, and the exponent `n`, which is a
 * property of everything between the transmitter and the phone. Free space is
 * n = 2. A packed concourse is nearer 3.3, because 2.4 GHz is absorbed by water
 * and a crowd is mostly water.
 *
 * That last fact is the uncomfortable one and the reason this file is written
 * the way it is. The exponent rises with the density the system is trying to
 * measure, so radio ranging degrades exactly where it is most needed — in the
 * jammed corridor, not the empty one. A ranging layer that reports its error as
 * a fixed metre figure will therefore be confidently wrong at the only moment
 * anybody is looking. So every range comes back with a sigma that grows with
 * the distance it claims, and the solver weights on it.
 *
 * None of these numbers are laws. They are the intercept and the slope of a line
 * that must be walked at the venue before it means anything, which is why
 * 'path_loss_exponent' is on the measured-not-assumed list and why every
 * `RadioAnchor` carries its own Sourced pair to override the defaults here.
 */

import type { AnchorKind, RadioAnchor, RadioObservation, Sourced } from '@crowdflow/contracts';
import {
  ASSUMED_BLE_RSSI_AT_1M_DBM,
  ASSUMED_PATH_LOSS_EXPONENT_CROWD,
  ASSUMED_PATH_LOSS_EXPONENT_COVERED,
  ASSUMED_PATH_LOSS_EXPONENT_OPEN,
  ASSUMED_WIFI_RSSI_AT_1M_DBM,
} from '@crowdflow/contracts';

/** The two parameters of one anchor's range curve. */
export interface RangeCurve {
  rssi_at_1m_dbm: number;
  path_loss_exponent: number;
}

/** Named environments, so a caller picks a place rather than a number. */
export const PATH_LOSS: Record<'open' | 'crowd' | 'covered', number> = {
  open: ASSUMED_PATH_LOSS_EXPONENT_OPEN,
  crowd: ASSUMED_PATH_LOSS_EXPONENT_CROWD,
  covered: ASSUMED_PATH_LOSS_EXPONENT_COVERED,
};

export function defaultCurve(kind: AnchorKind): RangeCurve {
  return {
    rssi_at_1m_dbm: kind === 'ble_beacon' ? ASSUMED_BLE_RSSI_AT_1M_DBM : ASSUMED_WIFI_RSSI_AT_1M_DBM,
    path_loss_exponent: PATH_LOSS.crowd,
  };
}

/**
 * The curve to use for one anchor.
 *
 * A surveyed anchor's own values win. Where it only has assumed values, they
 * still win — an assumption recorded against a specific installation is a
 * better guess than a constant, and the provenance travels with it so the
 * weighting can reflect that neither was walked.
 */
export function curveFor(anchor: RadioAnchor): RangeCurve {
  const fallback = defaultCurve(anchor.kind);
  return {
    rssi_at_1m_dbm: Number.isFinite(anchor.rssi_at_1m_dbm?.value) ? anchor.rssi_at_1m_dbm.value : fallback.rssi_at_1m_dbm,
    path_loss_exponent: anchor.path_loss_exponent?.value > 0 ? anchor.path_loss_exponent.value : fallback.path_loss_exponent,
  };
}

/** Log-distance, inverted: metres from a received strength. */
export function distanceFromRssi(rssiDbm: number, curve: RangeCurve): number {
  const { rssi_at_1m_dbm, path_loss_exponent } = curve;
  if (!(path_loss_exponent > 0)) throw new Error('path loss exponent must be positive');
  return 10 ** ((rssi_at_1m_dbm - rssiDbm) / (10 * path_loss_exponent));
}

/** The forward model. Used to generate scans for tests and for the simulator. */
export function rssiFromDistance(distanceM: number, curve: RangeCurve): number {
  const d = Math.max(distanceM, 0.01);
  return curve.rssi_at_1m_dbm - 10 * curve.path_loss_exponent * Math.log10(d);
}

/**
 * Where a Sourced parameter's provenance costs it weight.
 *
 * A measured curve is trusted at face value; an assumed one is treated as if
 * the range it produced were half again as uncertain. The multiplier is not
 * derived from anything — provenance is a label, not a variance — it exists so
 * that a surveyed anchor standing next to a guessed one wins the solve, which
 * is the behaviour a survey is supposed to buy.
 */
export function provenancePenalty(...sources: (Sourced | undefined)[]): number {
  let penalty = 1;
  for (const source of sources) {
    const provenance = source?.provenance;
    if (provenance === 'measured') continue;
    penalty *= provenance === 'assumed' ? 1.5 : 1.2;
  }
  return penalty;
}

/**
 * The one-sigma error on a ranged distance, in metres.
 *
 * Derived from the model rather than tabulated. Differentiating the log-distance
 * law gives
 *
 *     dd/dRSSI = -d * ln(10) / (10 n)
 *
 * so a fixed RSSI uncertainty becomes a distance uncertainty PROPORTIONAL to
 * the distance: a 6 dB wobble is a metre at one metre and thirty metres at
 * thirty. That proportionality is the whole reason a near anchor is worth more
 * than a far one, and it falls out of the physics instead of being asserted.
 *
 * `rssiSigmaDb` is the spread of a single reading. Six decibels is the
 * conventional figure for shadowing in a built environment and it is an
 * assumption; it belongs to the venue survey, not to this file.
 */
export function rangeSigmaM(distanceM: number, curve: RangeCurve, rssiSigmaDb = 6, penalty = 1): number {
  const gradient = (distanceM * Math.LN10) / (10 * curve.path_loss_exponent);
  return Math.max(0.5, gradient * rssiSigmaDb * penalty);
}

/** An observation resolved against its anchor: a distance, its error, and where it was measured from. */
export interface Range {
  anchor_id: string;
  kind: AnchorKind;
  position: import('@crowdflow/contracts').Position;
  distance_m: number;
  sigma_m: number;
  rssi_dbm: number;
  timestamp: number;
}

/** Resolve one observation against one anchor. */
export function rangeFrom(anchor: RadioAnchor, observation: RadioObservation, rssiSigmaDb = 6): Range {
  const curve = curveFor(anchor);
  const distance = distanceFromRssi(observation.rssi_dbm, curve);
  return {
    anchor_id: anchor.anchor_id,
    kind: anchor.kind,
    position: anchor.position,
    distance_m: distance,
    sigma_m: rangeSigmaM(distance, curve, rssiSigmaDb, provenancePenalty(anchor.rssi_at_1m_dbm, anchor.path_loss_exponent)),
    rssi_dbm: observation.rssi_dbm,
    timestamp: observation.timestamp,
  };
}
