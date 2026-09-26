'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useGame } from '../context/GameContext';
import { LocationCoordinates } from '../types/game';
import { calculateBearing } from '../utils/geo';

export interface DeviceOrientation {
  /** Compass heading in degrees (0 = north, clockwise). */
  heading: number | null;
  /** Camera pitch in radians. 0 = aiming at horizon, +π/2 = aiming at the sky. */
  pitch: number;
  /** True when a real compass reading is available. */
  hasCompass: boolean;
  /**
   * True when the app is auto-aiming (no usable compass) — the heading/pitch
   * are synced to point at the current hunt target.
   */
  isAutoAiming: boolean;
  /**
   * iOS 13+ motion-permission prompt. Must be invoked from a user gesture
   * (the click that opens the AR camera); resolves true when granted.
   */
  requestOrientationPermission: () => Promise<boolean>;
}

/** Minimal shape of the DeviceOrientationEvent fields we consume. */
interface OrientationEventLike {
  alpha: number | null;
  beta: number | null;
  absolute: boolean;
  /** Safari-only compass heading (degrees clockwise from north). */
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

/**
 * Tracks where the phone is pointing: compass heading and camera pitch from the
 * browser's DeviceOrientation events (the web port of the native
 * `expo-location` heading stream + `expo-sensors` accelerometer).
 *
 * iOS 13+ requires a `DeviceOrientationEvent.requestPermission()` call from a
 * user gesture — `requestOrientationPermission` should be invoked from the
 * click that opens the AR camera. When no compass is available (desktop
 * browsers, denied permission), the orientation auto-aims at
 * the provided target so the AR experience stays usable anywhere — mirroring
 * the native fallback.
 */
export function useDeviceOrientation(
  target: { latitude: number; longitude: number; altitudeMeters?: number } | null
): DeviceOrientation {
  const { userLocation } = useGame();
  const [sensorHeading, setSensorHeading] = useState<number | null>(null);
  const [sensorPitch, setSensorPitch] = useState<number>(0);
  const [hasCompassReading, setHasCompassReading] = useState(false);
  const hasCompassRef = useRef(false);

  // --- Compass heading + pitch (DeviceOrientation) -------------------------
  useEffect(() => {
    if (typeof window === 'undefined') {
      hasCompassRef.current = false;
      setHasCompassReading(false);
      setSensorHeading(null);
      setSensorPitch(0);
      return;
    }

    const onOrientation = (evt: Event) => {
      const e = evt as unknown as OrientationEventLike;

      // --- Heading: Safari's webkitCompassHeading, or absolute alpha on Android.
      let nextHeading: number | null = null;
      const webkitHeading = e.webkitCompassHeading;
      if (
        typeof webkitHeading === 'number' &&
        !Number.isNaN(webkitHeading) &&
        webkitHeading >= 0 &&
        (e.webkitCompassAccuracy === undefined || e.webkitCompassAccuracy >= 0)
      ) {
        nextHeading = (webkitHeading + 360) % 360;
      } else if (e.absolute && typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) {
        // Absolute alpha rotates counter-clockwise; heading is clockwise.
        nextHeading = (360 - e.alpha) % 360;
      }

      if (nextHeading !== null) {
        hasCompassRef.current = true;
        setSensorHeading(nextHeading);
        setHasCompassReading(true);
      }

      // --- Pitch: beta = front/back tilt, 0 = flat face-up (camera at the
      // ground, -π/2), 90 = upright facing the horizon (0), 180 = face-down
      // (camera at the sky, +π/2).
      if (typeof e.beta === 'number' && !Number.isNaN(e.beta)) {
        const degAboveHorizon = Math.max(-89, Math.min(89, e.beta - 90));
        setSensorPitch((degAboveHorizon * Math.PI) / 180);
      }
    };

    // Android Chrome fires `deviceorientationabsolute` for compass data;
    // iOS Safari fires `deviceorientation` with webkitCompassHeading.
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, []);

  /**
   * iOS 13+ gate: must be called from a user gesture (the click that opens the
   * AR camera). Resolves true when compass events will be delivered.
   */
  const requestOrientationPermission = useCallback(async (): Promise<boolean> => {
    const DOE = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> })
      | undefined;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission();
        return result === 'granted';
      } catch {
        return false;
      }
    }
    return true; // No gate on this platform (desktop/Android).
  }, []);

  const hasCompass = hasCompassRef.current && hasCompassReading;
  const isAutoAiming = !hasCompass;

  const heading = useCallback((): number | null => {
    if (!isAutoAiming) return sensorHeading;
    // Auto-aim: point the "camera" directly at the current target.
    if (target && userLocation) {
      return calculateBearing(userLocation as LocationCoordinates, target);
    }
    return sensorHeading ?? 0;
  }, [isAutoAiming, sensorHeading, target, userLocation]);

  const pitch = useCallback((): number => {
    if (!isAutoAiming) return sensorPitch;
    // Auto-aim vertically: elevation angle from eye level up to the character.
    if (target && userLocation) {
      const dx = (target.latitude - userLocation.latitude) * 111320;
      const dy =
        (target.longitude - userLocation.longitude) *
        111320 *
        Math.cos((userLocation.latitude * Math.PI) / 180);
      const groundDistance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const altitude = target.altitudeMeters ?? 0;
      return Math.atan2(Math.max(altitude - 1.6, -1.5), groundDistance);
    }
    return 0;
  }, [isAutoAiming, sensorPitch, target, userLocation]);

  return {
    heading: heading(),
    pitch: pitch(),
    hasCompass,
    isAutoAiming,
    requestOrientationPermission,
  };
}
