import type { VenuePoint } from '../core/contracts';
import type { CoordinateTransform } from '../venue/venueGraph';

const METRES_PER_LATITUDE_DEGREE = 111_320;

/** Raw geographic coordinates terminate here; only VenuePoint escapes this driver. */
export function geographicToVenueMetres(
  latitude: number,
  longitude: number,
  transform: CoordinateTransform,
): VenuePoint {
  const north = (latitude - transform.originLatitude) * METRES_PER_LATITUDE_DEGREE;
  const east = (longitude - transform.originLongitude) * METRES_PER_LATITUDE_DEGREE *
    Math.cos(transform.originLatitude * Math.PI / 180);
  const rotation = -transform.rotationDegrees * Math.PI / 180;
  return {
    x: east * Math.cos(rotation) - north * Math.sin(rotation),
    y: east * Math.sin(rotation) + north * Math.cos(rotation),
  };
}
