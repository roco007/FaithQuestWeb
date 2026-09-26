'use client';

import React, { createContext, useContext } from 'react';
import { useLocationTracker, LocationTracker } from '../hooks/useLocationTracker';

const LocationContext = createContext<LocationTracker | undefined>(undefined);

/**
 * Holds the single GPS watch the whole app shares.
 *
 * The tracker deliberately sits above the router's pages: the position stream
 * has to keep running while the player moves between the map and a hunt. When it
 * was started from a page instead, navigating away stopped the watch and froze
 * `userLocation` at the last reading — a player who then walked into a
 * character's discovery radius was never detected as being in range, and the
 * hunt stalled at "keep exploring".
 *
 * Screens read it through `useLocation()`; the manual "check my position" button
 * calls the tracker's `requestFreshFix()` for a brand-new reading.
 */
export const LocationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const tracker = useLocationTracker();
  return <LocationContext.Provider value={tracker}>{children}</LocationContext.Provider>;
};

export const useLocation = (): LocationTracker => {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return context;
};
