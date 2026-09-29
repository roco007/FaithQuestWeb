/**
 * Types for the location-based AR treasure hunt feature.
 * Roles: a game-creator authors a hunt (a list of locations, each with a hint,
 * a character, questions and a key), a game-player joins via game ID and
 * discovers the characters through the camera.
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
  /** 1-based position in the creator's list of locations. */
  order: number;
  /** Name of the character that appears here — what the reveal is titled with. */
  name: string;
  subtitle: string;
  /**
   * Where this location is: the place the team walks to, and the pin the
   * character appears on when they get there.
   */
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
  /**
   * **H** — the clue that leads players to this location. A team is handed it
   * one stop early: by the reveal that ends the stop before this one in their
   * route, or when the round opens when this location is their first. It is
   * therefore the clue on screen while they walk here, which is why it must
   * describe the place and not the character waiting on it.
   */
  hint: string;
  /** What the character says when found — played with its video on arrival. */
  dialogue: string;
  /**
   * **K** — the key that unlocks this location's questions. Authored here and
   * handed to the team one stop early (see `hint`), so it is in their hand while
   * they walk here and is presented on arrival to open `questions`. The round's
   * opening hand-over gives every team the key to their first location; the
   * treasure location's key is the last one handed out. Auto-generated when
   * absent (games saved before keys existed).
   */
  key?: string;
  /**
   * **Q** — the questions asked here, once the key is accepted: this location's
   * character, dialogue, video and the hand-over that follows all stay locked
   * until every question is answered correctly. Empty/absent = the key alone
   * unlocks the location (games predating this feature, or locations with no
   * gate).
   */
  questions?: HuntQuestion[];
  /**
   * Marks the **treasure location**: the place the hunt ends. It is never
   * shuffled into a team's route — it is dealt last, so every team finishes at
   * the treasure whatever order they walked. Clearing its questions is what
   * shows the congratulations: the end-of-hunt announcement plus the character
   * chosen for it (`HuntGame.endCharacterAssetId`). A hunt needs exactly one;
   * publishing is refused without one.
   */
  isTreasure?: boolean;
  /**
   * Legacy name of `isTreasure`, still read so hunts saved (or shared) before
   * the model was re-framed around locations keep playing. Never written.
   * @deprecated use `isTreasure`
   */
  isCongratulations?: boolean;
}

export interface HuntGame {
  /** Short human-readable ID, e.g. "FQ-7K2M9X". */
  id: string;
  title: string;
  description: string;
  creatorName: string;
  createdAt: string;
  updatedAt: string;
  /** Announcement spoken/shown when the treasure location is cleared. */
  endAnnouncement: string;
  /**
   * Optional ID from `public/characters/manifest.json`: the character that
   * appears with the end-of-hunt announcement on the congratulations screen.
   * Chosen by the creator next to the announcement (publishing asks for one);
   * hunts shared before it existed fall back to the treasure location's own
   * character.
   */
  endCharacterAssetId?: string | null;
  /** The hunt's locations sorted by `order` ascending — the treasure last. */
  characters: HuntCharacter[];
}

export type HuntStatus = 'active' | 'completed';

/** Per-player progress for a joined hunt. */
export interface HuntProgress {
  gameId: string;
  joinedAt: string;
  discoveredCharacterIds: string[];
  /**
   * This team's stop order, dealt once when the round starts (on join): the
   * hunt's **walkable** location IDs shuffled at random. The treasure location
   * is never dealt — it is appended last, so every team's hunt finishes at the
   * treasure whatever path their shuffle took. Discovery always follows this
   * order, so no two teams walk the same path. Absent on progress saved before
   * routes existed — those fall back to the authored order and are never
   * reshuffled mid-hunt (see `resolveRoute`).
   */
  route?: string[];
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
  /** Character shown with the announcement — required when publishing. */
  endCharacterAssetId?: string | null;
  characters: HuntCharacter[];
}
