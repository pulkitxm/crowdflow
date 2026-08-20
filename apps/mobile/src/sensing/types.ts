
import type { PositionFix, PositionSource, RadioObservation } from '@crowdflow/contracts';

export interface ScannerAvailability {
  usable: boolean;
  reason?: string;
}

export interface Sensor {
  readonly source: PositionSource;
  availability(): Promise<ScannerAvailability>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  readonly intervalS: number;
}

export interface AnchorScanner extends Sensor {
  scan(now: number): Promise<RadioObservation[]>;
}

export interface FixProvider extends Sensor {
  fix(now: number): Promise<PositionFix | null>;
}

export function isAnchorScanner(sensor: Sensor): sensor is AnchorScanner {
  return typeof (sensor as AnchorScanner).scan === 'function';
}

export function isFixProvider(sensor: Sensor): sensor is FixProvider {
  return typeof (sensor as FixProvider).fix === 'function';
}
