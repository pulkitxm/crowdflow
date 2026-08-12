import * as Location from 'expo-location';
import { DeviceMotion, Pedometer } from 'expo-sensors';
import type { Subscription as SensorSubscription } from 'expo-sensors/build/DeviceSensor';
import type { VenuePoint } from '../core/contracts';
import { TypedEvent } from '../core/events';
import type { VenueGraph } from '../venue/venueGraph';
import { geographicToVenueMetres } from './coordinates';

export interface VenuePosition {
  point: VenuePoint;
  accuracy: number;
  velocity: number;
  direction: number;
  zoneId: string;
  confidence: number;
  timestamp: number;
}

/** GNSS + IMU heading + pedometer speed, converted to venue metres and graph map-matched. */
export class LocationEngine {
  readonly changed = new TypedEvent<VenuePosition>();
  private locationSubscription?: Location.LocationSubscription;
  private motionSubscription?: SensorSubscription;
  private stepSubscription?: SensorSubscription;
  private latest?: VenuePosition;
  private heading?: number;
  private stepVelocity = 0;
  private lastStepCount = 0;
  private lastStepAt = 0;

  constructor(private readonly graph: VenueGraph) {}

  current(): VenuePosition | undefined { return this.latest; }

  async start(): Promise<void> {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error('Location permission is required for venue guidance');
    await this.startSensors();
    this.locationSubscription = await Location.watchPositionAsync({
      accuracy: Location.Accuracy.High,
      timeInterval: 1_000,
      distanceInterval: .25,
    }, (location) => {
      const raw = geographicToVenueMetres(location.coords.latitude, location.coords.longitude, this.graph.coordinateTransform);
      const gnssHeading = location.coords.heading !== null && location.coords.heading >= 0 ? location.coords.heading : undefined;
      const direction = this.heading ?? gnssHeading ?? this.latest?.direction ?? 0;
      const match = this.graph.mapMatch(raw, direction);
      const accuracy = location.coords.accuracy ?? 20;
      const gnssVelocity = location.coords.speed ?? 0;
      // GNSS velocity is weak at walking speed; recent steps provide a less noisy lower bound.
      const velocity = Date.now() - this.lastStepAt < 4_000
        ? Math.max(gnssVelocity, this.stepVelocity)
        : gnssVelocity;
      this.latest = {
        point: match.point,
        accuracy,
        velocity: Math.min(5.1, Math.max(0, velocity)),
        direction: ((direction % 360) + 360) % 360,
        zoneId: match.zone.id,
        confidence: Math.max(.1, 1 - accuracy / 30) * Math.max(.35, 1 - match.distanceMetres / 40),
        timestamp: location.timestamp,
      };
      this.changed.emit(this.latest);
    });
  }

  stop(): void {
    this.locationSubscription?.remove(); this.motionSubscription?.remove(); this.stepSubscription?.remove();
    this.locationSubscription = undefined; this.motionSubscription = undefined; this.stepSubscription = undefined;
  }

  inject(point: VenuePoint, accuracy = 3, velocity = 1.2, direction = 0): void {
    const match = this.graph.mapMatch(point, direction);
    this.latest = {
      point: match.point, accuracy, velocity, direction, zoneId: match.zone.id,
      confidence: Math.max(.1, 1 - accuracy / 30) * Math.max(.35, 1 - match.distanceMetres / 40),
      timestamp: Date.now(),
    };
    this.changed.emit(this.latest);
  }

  private async startSensors(): Promise<void> {
    if (await DeviceMotion.isAvailableAsync().catch(() => false)) {
      const permission = await DeviceMotion.requestPermissionsAsync().catch(() => undefined);
      if (!permission || permission.granted) {
        DeviceMotion.setUpdateInterval(250);
        this.motionSubscription = DeviceMotion.addListener((motion) => {
          // alpha is rotation around Z in radians. Expo may report [-π, π].
          this.heading = ((motion.rotation.alpha * 180 / Math.PI) % 360 + 360) % 360;
        });
      }
    }
    if (await Pedometer.isAvailableAsync().catch(() => false)) {
      const permission = await Pedometer.requestPermissionsAsync().catch(() => undefined);
      if (!permission || permission.granted) {
        this.stepSubscription = Pedometer.watchStepCount(({ steps }) => {
          const now = Date.now();
          if (this.lastStepAt > 0 && steps > this.lastStepCount) {
            const cadence = (steps - this.lastStepCount) / ((now - this.lastStepAt) / 1_000);
            // Approximate 0.75 m stride, bounded to plausible pedestrian speed.
            this.stepVelocity = Math.min(2.4, Math.max(.2, cadence * .75));
          }
          this.lastStepCount = steps; this.lastStepAt = now;
        });
      }
    }
  }
}
