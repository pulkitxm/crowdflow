/**
 * The seam between "a radio" and "a position".
 *
 * Two interfaces, not one, because the three radios answer two different
 * questions. Wi-Fi and BLE report WHAT THEY HEARD — a list of anchors and signal
 * strengths — and the position is solved from that on the handset. GNSS reports A
 * POSITION and there is nothing to solve. Forcing both through one interface
 * means either pretending GNSS produces observations, or pretending a Wi-Fi scan
 * produces a fix; both lies then have to be maintained in every implementation.
 *
 * Everything here returns `ScannerAvailability` rather than throwing, and the
 * reason is a sentence rather than a code. A person whose Bluetooth is switched
 * off should be told that, in those words, on the app's own status screen. A
 * developer whose handset is an iPhone should be told that Wi-Fi scanning does
 * not exist on iOS rather than watching an empty array come back forever.
 */

import type { PositionFix, PositionSource, RadioObservation } from '@crowdflow/contracts';

export interface ScannerAvailability {
  usable: boolean;
  /** Why not, in words a person can act on. Present whenever `usable` is false. */
  reason?: string;
}

/** Common lifecycle. `start`/`stop` are optional because a Wi-Fi scan is a
 *  one-shot call while a BLE scan and a GNSS watch are subscriptions. */
export interface Sensor {
  readonly source: PositionSource;
  availability(): Promise<ScannerAvailability>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  /** Seconds between useful samples from this radio. Not a preference: on
   *  Android the Wi-Fi figure is imposed by the platform's scan throttle. */
  readonly intervalS: number;
}

/** A radio that hears anchors. The fix is solved from what it returns. */
export interface AnchorScanner extends Sensor {
  scan(now: number): Promise<RadioObservation[]>;
}

/** A radio that reports a position directly. */
export interface FixProvider extends Sensor {
  fix(now: number): Promise<PositionFix | null>;
}

export function isAnchorScanner(sensor: Sensor): sensor is AnchorScanner {
  return typeof (sensor as AnchorScanner).scan === 'function';
}

export function isFixProvider(sensor: Sensor): sensor is FixProvider {
  return typeof (sensor as FixProvider).fix === 'function';
}
