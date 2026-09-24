import { useMemo } from 'react';
import { useGame } from '../context/GameContext';
import { useHunt } from '../context/HuntContext';
import { calculateHaversineDistance, evaluateProximity, calculateBearing } from '../utils/geo';
import { HuntCharacter } from '../types/hunt';
import { ProximityState, LocationCoordinates } from '../types/game';

export interface HuntTargetInfo {
  character: HuntCharacter;
  distanceMeters: number;
  bearingDegrees: number;
  proximity: ProximityState;
}

/**
 * Live radar state for the current treasure-hunt target: ground distance,
 * compass bearing, and COLD/WARM/HOT/IN_RANGE proximity against the
 * character's discovery radius.
 */
export function useHuntRadar(): HuntTargetInfo | null {
  const { currentCharacter } = useHunt();
  const { userLocation } = useGame();

  return useMemo<HuntTargetInfo | null>(() => {
    if (!currentCharacter || !userLocation) return null;

    const distance = calculateHaversineDistance(userLocation, currentCharacter);
    const bearing = calculateBearing(
      userLocation as LocationCoordinates,
      currentCharacter
    );
    const proximity = evaluateProximity(userLocation, {
      latitude: currentCharacter.latitude,
      longitude: currentCharacter.longitude,
      radiusMeters: currentCharacter.radiusMeters,
    });

    return {
      character: currentCharacter,
      distanceMeters: distance,
      bearingDegrees: bearing,
      proximity,
    };
  }, [currentCharacter, userLocation]);
}
