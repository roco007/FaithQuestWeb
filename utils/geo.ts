import { LocationCoordinates, ProximityLevel, ProximityState } from '../types/game';

const EARTH_RADIUS_METERS = 6371000; // Earth mean radius in meters

/**
 * Converts degrees to radians.
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Converts radians to degrees.
 */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Calculates geodesic distance between two GPS coordinates using the Haversine formula.
 * Returns distance in meters.
 */
export function calculateHaversineDistance(
  coord1: LocationCoordinates,
  coord2: { latitude: number; longitude: number }
): number {
  const dLat = degreesToRadians(coord2.latitude - coord1.latitude);
  const dLon = degreesToRadians(coord2.longitude - coord1.longitude);

  const lat1Rad = degreesToRadians(coord1.latitude);
  const lat2Rad = degreesToRadians(coord2.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1Rad) * Math.cos(lat2Rad);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculates initial bearing (compass heading 0-360 degrees) from source to destination.
 */
export function calculateBearing(
  from: LocationCoordinates,
  to: { latitude: number; longitude: number }
): number {
  const lat1 = degreesToRadians(from.latitude);
  const lat2 = degreesToRadians(to.latitude);
  const dLon = degreesToRadians(to.longitude - from.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  let bearing = radiansToDegrees(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

/**
 * Formats a distance in meters into an easily readable string for teenagers.
 */
export function formatDistance(meters: number): string {
  if (meters < 1) {
    return 'Right here!';
  }
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Evaluates proximity state between player and landmark target.
 */
export function evaluateProximity(
  userLocation: LocationCoordinates,
  target: { latitude: number; longitude: number; radiusMeters?: number }
): ProximityState {
  const distance = calculateHaversineDistance(userLocation, target);
  const bearing = calculateBearing(userLocation, target);
  const activationRadius = target.radiusMeters ?? 10;
  const isWithinRadius = distance <= activationRadius;

  let level: ProximityLevel = 'COLD';
  let message = '❄️ Cold... Wander closer to this sector';

  if (isWithinRadius) {
    level = 'IN_RANGE';
    message = '🌟 DISCOVERABLE! You are within range!';
  } else if (distance <= 20) {
    level = 'HOT';
    message = '🔥 HOT! You are right at the threshold!';
  } else if (distance <= 50) {
    level = 'WARM';
    message = '⚡ Getting Warmer! Follow the radar.';
  } else {
    level = 'COLD';
    message = '❄️ Cold... Search the outer church grounds.';
  }

  // Calculate hotRatio (1.0 = at target, 0.0 = >= 100m away)
  const maxRange = 100;
  const hotRatio = Math.max(0, Math.min(1, (maxRange - distance) / maxRange));

  return {
    distanceMeters: Math.round(distance * 10) / 10,
    level,
    bearingDegrees: Math.round(bearing),
    isWithinRadius,
    message,
    hotRatio,
  };
}
