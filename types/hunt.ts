/**
 * Types for the location-based AR treasure hunt feature.
 * Roles: a game-creator authors a hunt (characters pinned to geolocations),
 * a game-player joins via game ID and discovers characters through the camera.
 */

/** Procedural 3D character archetypes rendered in the AR view. */
export type HuntCharacterType = 'guardian' | 'angel' | 'monk' | 'flame' | 'oracle';

/** Answer format for a reveal question: typed short answer or multiple choice. */
export type HuntQuestionType = 'text' | 'mcq';

/** One choice in a multiple-choice reveal question. */
export interface HuntQuestionOption {
  id: string;
  text: string;
  /**
   * The player's tapped option is compared against this flag. Exactly one
   * option per question must be correct — enforced by the editor on save and
   * by the JSON importer (a question with no correct option is dropped).
   */
  isCorrect: boolean;
}

/**
 * A question the player must answer AFTER presenting the character's key and
 * BEFORE its reveal (dialogue + video) starts. All of a character's questions
 * must be answered correctly to record the discovery.
 *
 * `text` questions fuzzy-match the player's typed answer against `answers`
 * (case- and whitespace-insensitive; ≥80% similarity counts as correct);
 * `mcq` questions present `options` and the player taps the correct one.
 */
export interface HuntQuestion {
  id: string;
  type: HuntQuestionType;
  /** The question shown to the player. */
  prompt: string;
  /** Accepted answers for a `text` question (at least one, fuzzy-matched). */
  answers?: string[];
  /** Choices for an `mcq` question (at least two, exactly one correct). */
  options?: HuntQuestionOption[];
}

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
  /**
   * Optional ID from `public/characters/manifest.json`. When present, the AR
   * camera renders that cutout video, photo cutout, or GLB model; `characterType` remains its
   * map pin, accent, and procedural fallback. Asset paths are deliberately not
   * stored in a hunt so shared hunts cannot inject arbitrary URLs.
   */
  characterAssetId?: string;
  /**
   * Optional ID from `public/marketing/manifest.json`. When present, the AR
   * camera shows that business banner in a card above the character — the
   * banner alone before the key is entered, combined with the hint/reveal
   * dialogue after it. When absent, the hint bubble keeps its current layout
   * above the character's head.
   */
  sponsorBannerId?: string | null;
  /** Clue the player receives to locate THIS character. */
  hint: string;
  /** What the character says when found — contains the clue to the next target. */
  dialogue: string;
  /**
   * Discovery key the player must present to THIS character to be discovered.
   * Character N's key is handed out by character N-1 when it is found; the
   * first character's key is given to players by the creator. Auto-generated
   * when absent (games saved before keys existed).
   */
  key?: string;
  /**
   * Questions asked once the key is accepted and before the reveal — the
   * character's dialogue, next key and video stay locked until every question
   * is answered correctly. Empty/absent = the key alone unlocks the character
   * (games predating this feature, or characters with no gate).
   */
  questions?: HuntQuestion[];
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
  /** Original creation date — preserved when publishing an imported hunt file. */
  createdAt?: string;
  title: string;
  description: string;
  creatorName: string;
  endAnnouncement: string;
  characters: HuntCharacter[];
}
