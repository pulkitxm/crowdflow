/**
 * The rung that works everywhere, and is usually the best one.
 *
 * At an open circuit, GNSS with a clear sky beats an RSSI trilateration and it
 * is not close: five to ten metres against fifteen to twenty-five, with no
 * survey to install and no anchor map to keep current. The reason the other two
 * rungs exist is the places where the sky is gone — under a grandstand, in a
 * tunnel, inside a hospitality unit — which is also where crowds jam. So this is
 * the default and the radios are what rescue it, rather than the other way
 * round.
 *
 * `watchPositionAsync` rather than repeated `getCurrentPositionAsync`: a watch
 * lets the platform's fused provider keep its own cadence and serve cached
 * fixes, which on Android means the Wi-Fi and cell components of that fusion are
 * already being used without this app scanning anything. Polling would restart
 * the acquisition each time and cost noticeably more battery for worse fixes.
 *
 * The platform's own `speed` and `heading` are deliberately ignored. They exist
 * only for GNSS, so a system that used them would report a quantity that
 * silently changes definition the moment a phone drops to a Wi-Fi fix — and
 * `mean_speed_ms` across a zone would then be an average over two different
 * measurements. Velocity comes from displacement between fused fixes, for every
 * source, in `PositionFuser`.
 */

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
        // Balanced, not Highest. Highest asks for continuous full-power GNSS,
        // which at a race weekend is a phone that is flat by mid-afternoon —
        // and a flat phone contributes nothing to a crowd picture at all.
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

  /**
   * The most recent watch callback, projected into the venue frame.
   *
   * Returns null when accuracy is missing rather than substituting a number.
   * Android reports `accuracy` as a 68% radius and iOS as `horizontalAccuracy`;
   * where a platform declines to say, the honest answer is that this fix has no
   * error bar, and everything downstream weights on the error bar.
   */
  async fix(_now: number): Promise<PositionFix | null> {
    const location = this.latest;
    if (!location) return null;
    const accuracy = location.coords.accuracy;
    if (accuracy == null || !(accuracy > 0)) return null;
    return {
      position: toVenue(this.frame, { lat: location.coords.latitude, lon: location.coords.longitude }),
      accuracy_m: accuracy,
      source: 'gnss',
      // The platform's timestamp in milliseconds, not the caller's clock: a
      // cached fix may be older than this tick, and the fuser's staleness test
      // is the thing that must notice.
      timestamp: location.timestamp / 1000,
      anchors_used: 0,
      residual_m: null,
      speed_ms: null,
      heading_deg: null,
    };
  }
}
