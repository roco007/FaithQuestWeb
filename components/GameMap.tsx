'use client';

import { useState, forwardRef } from 'react';
import { isGoogleMapsEnabled } from '../utils/mapConfig';
import { GoogleGameMap } from './GoogleGameMap';
import { LeafletGameMap } from './LeafletGameMap';
import type { GameMapProps, GameMapRef } from './mapTypes';

export type { GameMapProps, GameMapRef, MapViewport } from './mapTypes';

/**
 * Interactive quest map.
 *
 * Renders Google Maps when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is configured and
 * the keyless Leaflet/OpenStreetMap map otherwise. Both providers satisfy the
 * same `GameMapProps` / `GameMapRef` contract, so callers (`app/page.tsx`) are
 * provider-agnostic and need no changes.
 *
 * The Leaflet map is not a stub: it is the full original implementation, used
 * whenever there is no key and as the recovery path if the Google provider
 * cannot start (rejected key, blocked script, advanced markers unavailable).
 * Falling back rather than erroring matters because a blank map makes the whole
 * quest unplayable.
 */
export const GameMap = forwardRef<GameMapRef, GameMapProps>(function GameMap(props, ref) {
  // Latched once a provider has failed, so the app does not thrash between
  // providers retrying on every render.
  const [googleFailed, setGoogleFailed] = useState(false);

  if (isGoogleMapsEnabled() && !googleFailed) {
    return <GoogleGameMap {...props} ref={ref} onProviderError={() => setGoogleFailed(true)} />;
  }

  return <LeafletGameMap {...props} ref={ref} />;
});