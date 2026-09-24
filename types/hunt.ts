/**
 * Types for the location-based AR treasure hunt feature.
 * Roles: a game-creator authors a hunt (characters pinned to geolocations),
 * a game-player joins via game ID and discovers characters through the camera.
 */

/** Procedural 3D character archetypes rendered in the AR view. */
export type HuntCharacterType = 'guardian' | 'angel' | 'monk' | 'flame' | 'oracle';

export interface HuntCharacter {
  id: string;
  /** 1-based sequence in the treasure hunt route. */
  order: number;
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  /**
   * Height above ground in meters where the creator placed the character.
   * 0 = standing on the ground. Players must tilt their phone up to see
   * characters floating higher in the air.
   */
  altitudeMeters: number;
  /** Discovery radius in meters (player must be within this to collect). */
  radiusMeters: number;
  characterType: HuntCharacterType;
  /** Clue the player receives to locate THIS character. */
  hint: string;
  /** What the character says when found — contains the clue to the next target. */
  dialogue: string;
}

export interface HuntGame {
  /** Short human-readable ID, e.g. "FQ-7K2M9X". */
  id: string;
  title: string;
  description: string;
  creatorName: string;
  createdAt: string;
  updatedAt: string;
  /** Announcement spoken/shown when the final character is discovered. */
  endAnnouncement: string;
  /** Characters sorted by `order` ascending. */
  characters: HuntCharacter[];
}

export type HuntStatus = 'active' | 'completed';

/** Per-player progress for a joined hunt. */
export interface HuntProgress {
  gameId: string;
  joinedAt: string;
  discoveredCharacterIds: string[];
  status: HuntStatus;
  completedAt?: string | null;
}

/** Draft used by the creator editor before an ID is assigned. */
export interface HuntGameDraft {
  id?: string;
  title: string;
  description: string;
  creatorName: string;
  endAnnouncement: string;
  characters: HuntCharacter[];
}
