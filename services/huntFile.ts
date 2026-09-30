import { resolveRoute } from '../utils/huntRoute';
import type {
  HuntCharacter,
  HuntCharacterType,
  HuntGame,
  HuntQuestion,
  HuntQuestionOption,
  HuntQuestionType,
} from '../types/hunt';

/**
 * Portable JSON export/import for hunts.
 *
 * Publishing a hunt downloads a `.json` file (see `downloadHuntGame`); the
 * Create Game screen uploads it back (`parseHuntGameJson`) to reload the hunt
 * for editing and appending — the round-trip that lets a creator move a hunt
 * between devices with no backend.
 *
 * The file wraps the game in a small self-describing envelope
 * (`{ format, version, exportedAt, order, game }`) so future schema changes can
 * be detected, while the parser also accepts a bare `HuntGame` (the exact shape
 * the share-code payload uses) so hand-written files work too.
 *
 * `order` is the hunt's authored order written out for a human — the location
 * names from `START` through to the stop the game must end on (see
 * `buildHuntOrder`). It is derived from `game.characters`, so the parser
 * ignores it: the order of record is the locations' own `order` field, and a
 * stale or hand-edited `order` in a file cannot desynchronise the hunt.
 *
 * A location travels complete: its place, hint, character, questions and key are
 * all its own. The only game-level additions are the end-of-hunt announcement
 * and the character shown with it (`endCharacterAssetId`).
 *
 * Only manifest IDs travel (`characterAssetId`, `sponsorBannerId`,
 * `endCharacterAssetId`) — never asset URLs — matching the hunt format itself,
 * so an imported hunt cannot inject remote resources and simply falls back to
 * the procedural character when a manifest entry is missing on the importing
 * device.
 */

/** Marker written into every exported file. */
export const HUNT_EXPORT_FORMAT = 'faithquest-hunt';
/** Bump when the hunt shape changes; readers reject newer files than they know. */
export const HUNT_EXPORT_VERSION = 1;

/** Runtime list of archetypes — `types/hunt.ts` only carries the type itself. */
const HUNT_CHARACTER_TYPES: readonly HuntCharacterType[] = [
  'guardian',
  'angel',
  'monk',
  'flame',
  'oracle',
];

/** Defaults mirror the character editor for fields a file may omit. */
const DEFAULT_RADIUS_METERS = 25;
const DEFAULT_ALTITUDE_METERS = 0;

/** One stop in the exported order. */
export interface HuntExportOrderStop {
  /** 1-based position in the hunt's order; the last stop is the end. */
  position: number;
  /** The location's name, as the creator wrote it. */
  name: string;
  /** True for the stop the game must end on (the treasure location). */
  isEnd: boolean;
}

/**
 * The hunt's order, written beside the game so the file reads on its own: where
 * a team starts, which location they walk next, and where the game ends. Purely
 * descriptive — the game itself carries the locations, and each team is still
 * dealt its own order of them when they join (see `utils/huntRoute`).
 */
export interface HuntExportOrder {
  /** Where the hunt starts: always `START`, since no stop is a fixed opener. */
  start: string;
  /** The location names in order; the last entry is where the game ends. */
  stops: HuntExportOrderStop[];
  /**
   * The same order as one line — `START -> The Old Well -> Riverside Steps ->
   * The Bell Tower (the game must end here)` — so someone skimming the file can
   * read the route without expanding the JSON.
   */
  summary: string;
}

/** Envelope written around the game in exported files. */
export interface HuntExportFile {
  format: typeof HUNT_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  /** The hunt's order, start to end (see {@link HuntExportOrder}). */
  order: HuntExportOrder;
  game: HuntGame;
}

/**
 * Builds the exported order from a game's locations.
 *
 * This is the order teams are handed, read from `resolveRoute` so the file
 * cannot disagree with play: the order the publish dealt (`game.route` — a fresh
 * shuffle on every Publish / Save Changes), or the authored order for a hunt
 * saved before routes existed. The treasure, when one is tagged, closes the
 * order; when none is, the last location the deal produced is where the hunt
 * ends.
 *
 * It is still the *published* order rather than any one team's route: a round
 * already in progress keeps the order it joined with (`HuntProgress.route`), so
 * a later re-publish can leave a team walking an older order than this file
 * describes.
 */
export function buildHuntOrder(game: Pick<HuntGame, 'characters' | 'route'>): HuntExportOrder {
  const stops: HuntExportOrderStop[] = resolveRoute(game, null).map(
    (character, index, all) => ({
      position: index + 1,
      name: character.name,
      isEnd: index === all.length - 1,
    })
  );
  const names = stops.map(stop => stop.name);
  const summary =
    names.length === 0
      ? 'START -> (no locations)'
      : `START -> ${names.join(' -> ')} (the game must end here)`;
  return { start: 'START', stops, summary };
}

/**
 * A hunt read from a file. `id` is optional: exports always carry the hunt
 * number, but a hand-written file may omit it — publishing then allocates the
 * next free number on the device (see `HuntContext.createGame`).
 */
export type ImportedHunt = Omit<HuntGame, 'id'> & { id?: string };

/** Wraps a game in the export envelope. */
export function buildHuntExport(game: HuntGame): HuntExportFile {
  return {
    format: HUNT_EXPORT_FORMAT,
    version: HUNT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    order: buildHuntOrder(game),
    game,
  };
}

/** Pretty-printed file contents (two-space indent, so the JSON stays readable). */
export function serialiseHuntGame(game: HuntGame): string {
  return JSON.stringify(buildHuntExport(game), null, 2);
}

/** `faithquest-<title-slug>-<hunt-number>.json`. */
export function huntGameFileName(game: HuntGame): string {
  const slug = game.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return `faithquest-${slug || 'hunt'}-${game.id}.json`;
}

/**
 * Saves the hunt as a `.json` download on the current device. Only ever
 * triggered explicitly by the creator (the share sheet's "Download JSON"
 * button) — publishing never downloads a file on its own.
 */
export function downloadHuntGame(game: HuntGame): void {
  const blob = new Blob([serialiseHuntGame(game)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = huntGameFileName(game);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke only after the browser has had a chance to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Import (parsing + validation)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** String field with fallback; non-strings collapse to `fallback`. */
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Finite number, also accepting numeric strings from hand-written files. */
function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** An ISO-ish timestamp from the file, or the current time when absent/bad. */
function timestamp(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return new Date().toISOString();
}

/**
 * Coerces the optional reveal-question gate on an imported character.
 *
 * Questions are validated per entry and malformed ones are dropped rather
 * than imported: a question with no prompt, no accepted answers, fewer than
 * two options, or no correct option marked could never be answered, and a
 * gate the player cannot pass is worse than no gate at all. Returns undefined
 * when nothing usable remains, so the character falls back to key-only.
 */
function normaliseImportedQuestions(raw: unknown): HuntQuestion[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const questions: HuntQuestion[] = [];
  raw.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const type: HuntQuestionType | null =
      entry.type === 'text' ? 'text' : entry.type === 'mcq' ? 'mcq' : null;
    if (type === null) return;
    const prompt = text(entry.prompt).trim();
    if (!prompt) return;
    const id = text(entry.id).trim() || `q_imp_${index}`;

    if (type === 'text') {
      const answers = Array.isArray(entry.answers)
        ? entry.answers.map(answer => text(answer).trim()).filter(Boolean)
        : [];
      if (answers.length === 0) return;
      questions.push({ id, type, prompt, answers });
      return;
    }

    const rawOptions: unknown[] = Array.isArray(entry.options) ? entry.options : [];
    const options: HuntQuestionOption[] = [];
    rawOptions.forEach((rawOption, optionIndex) => {
      if (!isRecord(rawOption)) return;
      const optionText = text(rawOption.text).trim();
      if (!optionText) return;
      options.push({
        id: text(rawOption.id).trim() || `opt_imp_${index}_${optionIndex}`,
        text: optionText,
        isCorrect: rawOption.isCorrect === true,
      });
    });
    // Needs at least two choices and a marked answer — else drop the question.
    if (options.length < 2 || !options.some(option => option.isCorrect)) return;
    questions.push({ id, type, prompt, options });
  });

  return questions.length > 0 ? questions : undefined;
}

/**
 * Coerces one raw array entry into a `HuntCharacter`, filling defaults for
 * anything optional and throwing a creator-readable error when the entry
 * cannot be placed on a map (no coordinates) — the one thing an editor cannot
 * sensibly guess.
 */
function normaliseImportedCharacter(raw: unknown, index: number): HuntCharacter {
  const position = `Location ${index + 1}`;
  if (!isRecord(raw)) {
    throw new Error(`${position} in this file isn't a valid entry.`);
  }

  const latitude = finiteNumber(raw.latitude);
  const longitude = finiteNumber(raw.longitude);
  if (
    latitude === null ||
    longitude === null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new Error(`${position} has no valid map position (latitude/longitude).`);
  }

  const characterType =
    typeof raw.characterType === 'string' &&
    (HUNT_CHARACTER_TYPES as readonly string[]).includes(raw.characterType)
      ? (raw.characterType as HuntCharacterType)
      : 'guardian';

  const questions = normaliseImportedQuestions(raw.questions);

  return {
    // Exports always carry ids; hand-written files may not (fresh ones are fine —
    // player progress is keyed per device anyway).
    id: text(raw.id).trim() || `imported-${Date.now().toString(36)}-${index}`,
    order: index + 1,
    name: text(raw.name).trim() || position,
    subtitle: text(raw.subtitle),
    latitude,
    longitude,
    altitudeMeters: finiteNumber(raw.altitudeMeters) ?? DEFAULT_ALTITUDE_METERS,
    radiusMeters: finiteNumber(raw.radiusMeters) ?? DEFAULT_RADIUS_METERS,
    characterType,
    characterAssetId: text(raw.characterAssetId).trim() || undefined,
    sponsorBannerId: text(raw.sponsorBannerId).trim() || null,
    hint: text(raw.hint),
    dialogue: text(raw.dialogue),
    key: text(raw.key).trim() || undefined,
    // Strict boolean: a hand-written file only marks the treasure when the value
    // is literally true. The legacy `isCongratulations` name is still accepted
    // (files written before the model was re-framed around locations) but only
    // `isTreasure` is ever written back. Duplicate flags survive import but are
    // reduced to the first one when the hunt is next published (`normaliseGame`).
    ...(raw.isTreasure === true || raw.isCongratulations === true
      ? { isTreasure: true }
      : {}),
    // Present only when at least one usable question survived validation —
    // `undefined` would serialise away anyway, but keeping the key absent
    // keeps hand-inspected files clean too.
    ...(questions ? { questions } : {}),
  };
}

/**
 * Parses a hunt file (envelope or bare `HuntGame`) into editor-ready state.
 * Throws an `Error` with a creator-readable message for anything that is not a
 * usable hunt — the caller surfaces it in the page's error banner.
 */
export function parseHuntGameJson(input: string): ImportedHunt {
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    throw new Error(`That file isn't valid JSON.`);
  }
  if (!isRecord(data)) {
    throw new Error(`That file isn't a FaithQuest hunt export.`);
  }

  // Envelope vs bare game (the shape the share code embeds).
  let payload: unknown = data;
  if ('format' in data || 'game' in data) {
    if (data.format !== HUNT_EXPORT_FORMAT) {
      throw new Error(`That file isn't a FaithQuest hunt export.`);
    }
    const version = finiteNumber(data.version);
    if (version !== null && version > HUNT_EXPORT_VERSION) {
      throw new Error('This hunt file was created by a newer version of FaithQuest.');
    }
    payload = data.game;
  }

  if (!isRecord(payload)) {
    throw new Error(`This file doesn't contain a hunt.`);
  }
  if (!Array.isArray(payload.characters)) {
    throw new Error('This file has no locations.');
  }
  const title = text(payload.title).trim();
  if (!title) {
    throw new Error(`This file doesn't look like a FaithQuest hunt — it has no title.`);
  }

  return {
    id: text(payload.id).trim() || undefined,
    title,
    description: text(payload.description).trim(),
    creatorName: text(payload.creatorName).trim(),
    createdAt: timestamp(payload.createdAt),
    updatedAt: timestamp(payload.updatedAt),
    endAnnouncement: text(payload.endAnnouncement).trim(),
    // The character shown with the announcement. Imported with the hunt so
    // reopening a file does not force the creator to pick it again before
    // publishing.
    endCharacterAssetId: text(payload.endCharacterAssetId).trim() || null,
    characters: payload.characters.map(normaliseImportedCharacter),
  };
}
