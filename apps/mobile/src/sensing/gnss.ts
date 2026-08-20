
import * as Location from 'expo-location';
import type { CoordinateFrame, PositionFix } from '@crowdflow/contracts';
import { ASSUMED_GNSS_SAMPLE_INTERVAL_S } from '@crowdflow/contracts';
import { toVenue } from '@crowdflow/core/positioning';
import type { FixProvider, ScannerAvailability } from './types';

export class GnssSensor implements FixProvider {
  readonly source = 'gnss' as const;
  readonly intervalS = ASSUMED_GNSS_SAMPLE_INTERVAL_S;
  private watch: Location.LocationSubscription | null = null;
  private latest: Location.LocationObject | null = null;

  constructor(private readonly frame: CoordinateFrame) {}

  async availability(): Promise<ScannerAvailability> {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return { usable: false, reason: 'Location permission is off.' };
    if (!(await Location.hasServicesEnabledAsync())) return { usable: false, reason: 'Location Services are switched off on this phone.' };
    return { usable: true };
  }

  async start(): Promise<void> {
    if (this.watch) return;
    this.watch = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: this.intervalS * 1000,
        distanceInterval: 5,
      },
      (location) => { this.latest = location; },
    );
  }

  async stop(): Promise<void> {
    this.watch?.remove();
    this.watch = null;
    this.latest = null;
  }

  async fix(_now: number): Promise<PositionFix | null> {
    const location = this.latest;
    if (!location) return null;
    const accuracy = location.coords.accuracy;
    if (accuracy == null || !(accuracy > 0)) return null;
    return {
      position: toVenue(this.frame, { lat: location.coords.latitude, lon: location.coords.longitude }),
      accuracy_m: accuracy,
      source: 'gnss',
      timestamp: location.timestamp / 1000,
      anchors_used: 0,
      residual_m: null,
      speed_ms: null,
      heading_deg: null,
    };
  }
}
