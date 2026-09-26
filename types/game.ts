import { InventoryItem, Badge } from './inventory';

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  altitude?: number | null;
}

export type ProximityLevel = 'COLD' | 'WARM' | 'HOT' | 'IN_RANGE';

export interface ProximityState {
  distanceMeters: number;
  level: ProximityLevel;
  bearingDegrees: number;
  isWithinRadius: boolean;
  message: string;
  hotRatio: number; // 0 (cold) to 1 (in range)
}

export interface PlayerProgress {
  playerName: string;
  level: number;
  currentXp: number;
  xpForNextLevel: number;
  totalXp: number;
  rankTitle: string;
  completedNodeIds: string[];
  inventory: InventoryItem[];
  badges: Badge[];
  streakDays: number;
  lastActiveDate: string;
}

export interface GameSettings {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  targetActivationRadiusMeters: number;
}
