/**
 * Which map provider the app should use.
 *
 * Google Maps is preferred whenever an API key is present, because it ships
 * native dark styling, a real Places/Geocoding roadmap and better vector tiles
 * than the keyless OpenStreetMap raster Leaflet falls back to. The key is a
 * *browser* key, so it is always visible in the client bundle — the protection
 * is Google's API + HTTP-referrer restriction, not secrecy, which is why
 * `NEXT_PUBLIC_` costs nothing here. See README for the setup.
 *
 * Leaving the key unset keeps the app fully playable on Leaflet, so a fresh
 * clone (or a mistyped key) never renders a blank map.
 */
const rawKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();

export const GOOGLE_MAPS_API_KEY = rawKey ?? '';

/** Cloud map ID for `AdvancedMarkerElement`, which refuses to load without one. */
export const GOOGLE_MAPS_MAP_ID =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_MAP_ID?.trim() || 'DEMO_MAP_ID';

/** True when a Google Maps key is configured, so the Google providers may load. */
export function isGoogleMapsEnabled(): boolean {
  return GOOGLE_MAPS_API_KEY.length > 0;
}