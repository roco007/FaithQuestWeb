import { webStorage } from '../utils/webStorage';
import { HuntGame, HuntProgress } from '../types/hunt';

const STORAGE_KEY_GAMES = '@faithquest:hunt_games';
const STORAGE_KEY_PROGRESS = '@faithquest:hunt_progress';
const STORAGE_KEY_ACTIVE_HUNT = '@faithquest:active_hunt_game_id';

/** Prefix so decoded payloads are recognisable as FaithQuest game shares. */
const SHARE_CODE_PREFIX = 'FQ1:';
/**
 * A hunt is identified by a plain whole number that counts up from 0 across the
 * device: `0`, `1`, `2` … `100`, `101`. Numbers are stored as strings because
 * the hunt record is keyed by ID, but nothing but digits is ever accepted.
 */
const INTEGER_ID_PATTERN = /^\d+$/;
/**
 * Hunt keys used before integer IDs. Both are still accepted so hunts already
 * saved on a device keep working; new hunts never produce them.
 */
const LEGACY_ID_PATTERN = /FQ1:[A-Z0-9]{6}/i;
const LEGACY_HYPHEN_ID_PATTERN = /FQ-[A-Z0-9]{6}/i;

/**
 * Storage contract for hunts and progress. The default implementation uses
 * browser-local storage; swap in a Firebase/Supabase/REST implementation
 * later without touching any UI code (cross-device sync is the only feature
 * that would require a backend).
 */
export interface GameRepository {
  saveGame(game: HuntGame): Promise<void>;
  getGame(id: string): Promise<HuntGame | null>;
  listGames(): Promise<HuntGame[]>;
  deleteGame(id: string): Promise<void>;

  saveProgress(progress: HuntProgress): Promise<void>;
  getProgress(gameId: string): Promise<HuntProgress | null>;
  deleteProgress(gameId: string): Promise<void>;

  getActiveGameId(): Promise<string | null>;
  setActiveGameId(gameId: string | null): Promise<void>;
}

// ---------------------------------------------------------------------------
// Base64 helpers (UTF-8 safe) — avoids depending on Buffer/btoa, which are
// absent in some runtimes and awkward to polyfill on older Safari.
// ---------------------------------------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

function base64ToBytes(b64: string): number[] {
  const clean = b64.replace(/=+$/, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4);
    const idx = (c: string) => {
      const n = B64_ALPHABET.indexOf(c);
      if (n < 0) throw new Error('Invalid base64 character');
      return n;
    };
    const c0 = idx(chunk[0]);
    const c1 = idx(chunk[1] ?? 'A');
    bytes.push((c0 << 2) | (c1 >> 4));
    if (chunk.length > 2 && chunk[2] !== '=') {
      const c2 = idx(chunk[2]);
      bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
      if (chunk.length > 3 && chunk[3] !== '=') {
        const c3 = idx(chunk[3]);
        bytes.push(((c2 & 0x03) << 6) | c3);
      }
    }
  }
  return bytes;
}

function utf8Encode(str: string): number[] {
  const bytes: number[] = [];
  const encoded = encodeURIComponent(str);
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return bytes;
}

function utf8Decode(bytes: number[]): string {
  let encoded = '';
  for (let i = 0; i < bytes.length; i++) {
    encoded += `%${bytes[i].toString(16).padStart(2, '0')}`;
  }
  return decodeURIComponent(encoded);
}

// ---------------------------------------------------------------------------
// Game ID + share code helpers
// ---------------------------------------------------------------------------

/**
 * Parses a hunt number, or returns null for anything that is not one. Leading
 * zeros are normalised, so `007` and `7` address the same hunt.
 */
export function parseGameId(value: string): number | null {
  const text = value.trim();
  if (!INTEGER_ID_PATTERN.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** True when a string is a hunt number: digits only, e.g. `0`, `7`, `100`. */
export function isGameId(value: string): boolean {
  return parseGameId(value) !== null;
}

/**
 * Picks the next hunt number: one past the highest number already in use, so a
 * fresh device starts at `0` and the sequence then runs `1`, `2` … `100`, `101`.
 *
 * The count deliberately never fills gaps. Because a share code embeds the hunt
 * it came from, handing a deleted hunt's number to an unrelated new hunt would
 * silently send anyone still holding that code to the wrong treasure. Legacy
 * non-numeric keys are ignored, so they cannot distort the sequence.
 */
export function nextGameId(takenIds: Iterable<string>): string {
  let highest = -1;
  for (const id of takenIds) {
    const parsed = parseGameId(id);
    if (parsed !== null && parsed > highest) highest = parsed;
  }
  return String(Math.min(highest + 1, Number.MAX_SAFE_INTEGER));
}

/**
 * Builds a self-contained share code containing the entire game payload.
 * Players on any device can join by pasting this code (no backend needed).
 */
export function encodeGameShareCode(game: HuntGame): string {
  const json = JSON.stringify(game);
  const b64 = bytesToBase64(utf8Encode(json));
  // URL-safe variant so the code survives messaging apps / QR encoders intact.
  return SHARE_CODE_PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Decodes a share code produced by {@link encodeGameShareCode}.
 * Returns null when the payload is malformed.
 */
export function decodeGameShareCode(code: string): HuntGame | null {
  try {
    const trimmed = code.trim();
    if (!trimmed.startsWith(SHARE_CODE_PREFIX)) return null;
    const b64 = trimmed
      .slice(SHARE_CODE_PREFIX.length)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const parsed = JSON.parse(utf8Decode(base64ToBytes(b64)));
    if (parsed && typeof parsed.id === 'string' && Array.isArray(parsed.characters)) {
      return parsed as HuntGame;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Finds a full share code in arbitrary pasted text.
 *
 * Two forms matter in practice, because players paste whatever the creator sent
 * them rather than tapping the link:
 *  1. a bare share code, e.g. "FQ1:eyJpZCI6…";
 *  2. a deep link, where the same code is percent-encoded inside the URL
 *     fragment, e.g. "…/games#join=FQ1%3AeyJpZCI6…".
 *
 * The URL form is decoded here so the fragment survives the trip through a
 * chat app that may re-encode it. Returns null when the text holds no payload.
 */
export function extractShareCode(input: string): string | null {
  const text = input.trim();
  if (text.startsWith(SHARE_CODE_PREFIX)) return text;

  const fromLink = text.match(/#join=([A-Za-z0-9%\-_]+)/);
  if (fromLink) {
    const raw = fromLink[1];
    const candidates = [raw, safeDecodeURIComponent(raw), safeDecodeURIComponent(safeDecodeURIComponent(raw))];
    for (const candidate of candidates) {
      if (candidate.startsWith(SHARE_CODE_PREFIX)) return candidate;
    }
  }
  return null;
}

/** `decodeURIComponent` that returns the input unchanged instead of throwing. */
function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Extracts a hunt number from free-form pasted text (the creator's full share
 * message, a deep link, or a bare number). A share code or link is handled
 * earlier by {@link extractShareCode}.
 *
 * A bare number is the normal case and is returned canonicalised, so `007`
 * becomes `7` and matches hunt 7. Legacy `FQ1:XXXXXX` and `FQ-XXXXXX` keys are
 * still matched so hunts saved before integer IDs can still be joined.
 */
export function extractGameId(input: string): string | null {
  const text = input.trim();

  // A hunt number on its own. This is checked first because a pasted share
  // message can contain both a number and a legacy key, and the number is the
  // one that identifies the hunt the player is actually joining.
  const bare = parseGameId(text);
  if (bare !== null) return String(bare);

  // A number quoted in a message, e.g. "Hunt number: 12".
  const labelled = text.match(/(?:hunt|game)\s*(?:number|id|key)\s*[:#]?\s*(\d+)/i);
  if (labelled) {
    const parsed = parseGameId(labelled[1]);
    if (parsed !== null) return String(parsed);
  }

  const legacy = text.match(LEGACY_ID_PATTERN) ?? text.match(LEGACY_HYPHEN_ID_PATTERN);
  if (legacy) return legacy[0].toUpperCase();

  return null;
}

// ---------------------------------------------------------------------------
// localStorage-backed repository (default, offline-first)
// ---------------------------------------------------------------------------

async function readRecord<T>(key: string): Promise<Record<string, T>> {
  try {
    const raw = await webStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, T>;
  } catch (err) {
    console.error(`Failed to read ${key}:`, err);
    return {};
  }
}

async function writeRecord<T>(key: string, record: Record<string, T>): Promise<void> {
  try {
    await webStorage.setItem(key, JSON.stringify(record));
  } catch (err) {
    console.error(`Failed to write ${key}:`, err);
    throw err;
  }
}

export const localGameRepository: GameRepository = {
  async saveGame(game: HuntGame): Promise<void> {
    const games = await readRecord<HuntGame>(STORAGE_KEY_GAMES);
    games[game.id] = game;
    await writeRecord(STORAGE_KEY_GAMES, games);
  },

  async getGame(id: string): Promise<HuntGame | null> {
    const games = await readRecord<HuntGame>(STORAGE_KEY_GAMES);
    return games[id] ?? null;
  },

  async listGames(): Promise<HuntGame[]> {
    const games = await readRecord<HuntGame>(STORAGE_KEY_GAMES);
    return Object.values(games).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  },

  async deleteGame(id: string): Promise<void> {
    const games = await readRecord<HuntGame>(STORAGE_KEY_GAMES);
    delete games[id];
    await writeRecord(STORAGE_KEY_GAMES, games);

    const progress = await readRecord<HuntProgress>(STORAGE_KEY_PROGRESS);
    if (progress[id]) {
      delete progress[id];
      await writeRecord(STORAGE_KEY_PROGRESS, progress);
    }

    const activeId = await webStorage.getItem(STORAGE_KEY_ACTIVE_HUNT);
    if (activeId === id) {
      await webStorage.removeItem(STORAGE_KEY_ACTIVE_HUNT);
    }
  },

  async saveProgress(progress: HuntProgress): Promise<void> {
    const all = await readRecord<HuntProgress>(STORAGE_KEY_PROGRESS);
    all[progress.gameId] = progress;
    await writeRecord(STORAGE_KEY_PROGRESS, all);
  },

  async getProgress(gameId: string): Promise<HuntProgress | null> {
    const all = await readRecord<HuntProgress>(STORAGE_KEY_PROGRESS);
    return all[gameId] ?? null;
  },

  async deleteProgress(gameId: string): Promise<void> {
    const all = await readRecord<HuntProgress>(STORAGE_KEY_PROGRESS);
    delete all[gameId];
    await writeRecord(STORAGE_KEY_PROGRESS, all);
  },

  async getActiveGameId(): Promise<string | null> {
    return webStorage.getItem(STORAGE_KEY_ACTIVE_HUNT);
  },

  async setActiveGameId(gameId: string | null): Promise<void> {
    if (gameId === null) {
      await webStorage.removeItem(STORAGE_KEY_ACTIVE_HUNT);
    } else {
      await webStorage.setItem(STORAGE_KEY_ACTIVE_HUNT, gameId);
    }
  },
};


