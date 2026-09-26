import { useEffect, useState, useCallback, useRef } from 'react';
import { useGame } from '../context/GameContext';
import { LocationCoordinates } from '../types/game';

/** Mirrors the native hook's permission union, using the W3C values. */
export type WebPermissionStatus = 'granted' | 'denied' | 'prompt';

/**
 * Chromium exposes `distanceInterval` on `watchPosition`, but the DOM lib's
 * `PositionOptions` only declares the three `getCurrentPosition` fields. These
 * sampling hints are passed straight through, and simply ignored elsewhere.
 */
interface WatchPositionOptions extends PositionOptions {
  distanceInterval?: number;
  timeInterval?: number;
}
const POSITION_ERROR_MESSAGES: Record<number, string> = {
  1: 'Location permission was denied. Enable location access to explore.',
  2: 'Your position is unavailable. Check your device settings and try again.',
  3: 'Location timed out. Move to an area with a clearer signal.',
};

/** Shown whenever the browser withholds the Geolocation API entirely. */
const GEOLOCATION_UNAVAILABLE_MESSAGE =
  'Geolocation is unavailable. Open this page over HTTPS (or on localhost) and allow location access.';

/** Everything the app needs from the device's position provider. */
export interface LocationTracker {
  permissionStatus: WebPermissionStatus | null;
  errorMsg: string | null;
  isWatching: boolean;
  /** Epoch ms of the last fix applied to the game state (null = never). */
  lastFixAt: number | null;
  /** Starts (or restarts) the continuous GPS watch. */
  startTracking: () => Promise<void>;
  /**
   * One-shot high-accuracy fix that bypasses the browser's cache and is applied
   * to the game state right away — this is what the manual "am I in range?"
   * button calls when auto-detection has gone quiet. Resolves with the fix, or
   * `null` when reading it failed (`errorMsg` explains why).
   */
  requestFreshFix: () => Promise<LocationCoordinates | null>;
}

/**
 * Streams the player's position from the browser's Geolocation API.
 *
 * Replaces the native `expo-location` hook. The browser has no explicit
 * permission pre-flight — `watchPosition` triggers the prompt itself — so this
 * calls `getCurrentPosition` once for a quick first fix, then keeps a continuous
 * watch open (1 m / 1 s) so proximity stays responsive while walking.
 *
 * Geolocation is HTTPS-only: over plain `http://` (other than localhost) the
 * API is absent, which surfaces as the "unavailable" error below.
 *
 * Deliberately mounted **once, app-wide**, by `LocationProvider`: the watch has
 * to outlive any single screen. Calling this inside a page stopped the stream as
 * soon as the player navigated away, which froze `userLocation` at the last
 * reading — walking into a character's radius after that went unnoticed and the
 * hunt could not progress.
 */
export function useLocationTracker() {
  const { updateLocationFromGPS } = useGame();
  const [permissionStatus, setPermissionStatus] = useState<WebPermissionStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState<boolean>(false);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsWatching(false);
  }, []);

  const toCoords = useCallback(
    (pos: GeolocationPosition): LocationCoordinates => ({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      altitude: pos.coords.altitude,
    }),
    []
  );

  /**
   * Records a geolocation failure. Only a denied permission tears the watch
   * down — a timeout or an unavailable position is usually transient, and
   * killing auto-detection for it is exactly what leaves a hunt stuck at
   * "keep exploring" with no way to walk back in.
   */
  const handleError = useCallback(
    (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) {
        setPermissionStatus('denied');
        stopWatching();
      }
      setErrorMsg(POSITION_ERROR_MESSAGES[err.code] ?? err.message);
    },
    [stopWatching]
  );

  /** Applies one fix to the game state and records when it arrived. */
  const applyFix = useCallback(
    (pos: GeolocationPosition) => {
      setPermissionStatus('granted');
      setErrorMsg(null);
      updateLocationFromGPS(toCoords(pos));
      setLastFixAt(Date.now());
    },
    [toCoords, updateLocationFromGPS]
  );

  /** False (with the reason recorded) when the browser has no Geolocation API. */
  const ensureGeolocation = useCallback((): boolean => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setPermissionStatus('denied');
      setErrorMsg(GEOLOCATION_UNAVAILABLE_MESSAGE);
      return false;
    }
    return true;
  }, []);

  /**
   * Manual re-check: one high-accuracy fix, never the browser's cached copy.
   *
   * A `watchPosition` stream can go quiet — a locked screen, a throttled
   * background tab, a valley between satellites — and then the in-range test
   * silently keeps comparing against an old position: the player steps into the
   * radius and nothing happens. Tapping "check now" therefore asks for a
   * brand-new reading instead of reusing whatever the watch last managed.
   */
  const requestFreshFix = useCallback(async (): Promise<LocationCoordinates | null> => {
    if (!ensureGeolocation()) return null;

    return new Promise<LocationCoordinates | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          applyFix(pos);
          resolve(toCoords(pos));
        },
        (err) => {
          handleError(err);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }, [applyFix, ensureGeolocation, handleError, toCoords]);

  const startTracking = useCallback(async () => {
    if (!ensureGeolocation()) return;

    try {
      setErrorMsg(null);

      // Initial quick fix — gives the map something to draw immediately. A
      // failure here is not fatal (no signal yet, a timeout): the watch started
      // below is what keeps the position live, so it always runs.
      try {
        await new Promise<void>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              applyFix(pos);
              resolve();
            },
            (err) => {
              handleError(err);
              reject(err);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
          );
        });
      } catch {
        // handleError already recorded the user-facing message.
      }

      // Continuous watch for responsiveness while walking. `maximumAge: 0` keeps
      // every update a real reading: a cached (walked-past) position is exactly
      // what makes "I stepped inside the radius" go unnoticed.
      stopWatching();
      watchIdRef.current = navigator.geolocation.watchPosition(
        applyFix,
        handleError,
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          distanceInterval: 1,
          timeInterval: 1000,
        } as WatchPositionOptions
      );
      setIsWatching(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not start location tracking.');
      stopWatching();
    }
  }, [applyFix, ensureGeolocation, handleError, stopWatching]);

  useEffect(() => {
    startTracking();
    return stopWatching;
  }, [startTracking, stopWatching]);

  return {
    permissionStatus,
    errorMsg,
    isWatching,
    lastFixAt,
    startTracking,
    requestFreshFix,
  };
}