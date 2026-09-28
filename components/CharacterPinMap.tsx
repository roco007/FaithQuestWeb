'use client';

import { useState } from 'react';
import { isGoogleMapsEnabled } from '../utils/mapConfig';
import { GoogleCharacterPinMap } from './GoogleCharacterPinMap';
import { LeafletCharacterPinMap } from './LeafletCharacterPinMap';
import type { CharacterPinMapProps } from './mapTypes';

export type { CharacterPinMapProps } from './mapTypes';

/**
 * Creator's map-placement picker.
 *
 * Provider-agnostic wrapper, mirroring `GameMap`: Google Maps when an API key
 * is configured, otherwise the keyless Leaflet/OpenStreetMap picker. Falls back
 * to Leaflet if the Google provider cannot start, so a hunt can always be
 * authored even when Google is unavailable.
 */
export function CharacterPinMap(props: CharacterPinMapProps) {
  const [googleFailed, setGoogleFailed] = useState(false);

  if (isGoogleMapsEnabled() && !googleFailed) {
    return (
      <GoogleCharacterPinMap {...props} onProviderError={() => setGoogleFailed(true)} />
    );
  }

  return <LeafletCharacterPinMap {...props} />;
}