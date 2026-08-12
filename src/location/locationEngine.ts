import * as Location from 'expo-location';
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

export class LocationEngine {
  readonly changed = new TypedEvent<VenuePosition>();
  private subscription?: Location.LocationSubscription;
  private latest?: VenuePosition;

  constructor(private readonly graph: VenueGraph) {}

  current(): VenuePosition | undefined { return this.latest; }

  async start(): Promise<void> {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error('Location permission is required for venue guidance');
    this.subscription = await Location.watchPositionAsync({
      accuracy: Location.Accuracy.High,
      timeInterval: 1_000,
      distanceInterval: .25,
    }, (location) => {
      const raw = geographicToVenueMetres(location.coords.latitude, location.coords.longitude, this.graph.coordinateTransform);
      const direction = location.coords.heading && location.coords.heading >= 0 ? location.coords.heading : 0;
      const match = this.graph.mapMatch(raw, direction);
      const accuracy = location.coords.accuracy ?? 20;
      this.latest = {
        point: match.point,
        accuracy,
        velocity: Math.min(5.1, Math.max(0, location.coords.speed ?? 0)),
        direction: ((direction % 360) + 360) % 360,
        zoneId: match.zone.id,
        confidence: Math.max(.1, 1 - accuracy / 30) * Math.max(.35, 1 - match.distanceMetres / 40),
        timestamp: location.timestamp,
      };
      this.changed.emit(this.latest);
    });
  }

  stop(): void { this.subscription?.remove(); this.subscription = undefined; }

  inject(point: VenuePoint, accuracy = 3, velocity = 1.2, direction = 0): void {
    const match = this.graph.mapMatch(point, direction);
    this.latest = {
      point: match.point, accuracy, velocity, direction, zoneId: match.zone.id,
      confidence: Math.max(.1, 1 - accuracy / 30) * Math.max(.35, 1 - match.distanceMetres / 40),
      timestamp: Date.now(),
    };
    this.changed.emit(this.latest);
  }
}
