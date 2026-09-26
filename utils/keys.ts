import { HuntCharacter } from '../types/hunt';

/**
 * Alphabet for discovery keys — human-readable (no 0/O/1/I) so keys can be
 * spoken or written down without ambiguity, matching the game-ID alphabet.
 */
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KEY_LENGTH = 6;

/** Generates a fresh discovery key, e.g. "K7M2QX". */
export function generateCharacterKey(): string {
  let out = '';
  const values = new Uint32Array(KEY_LENGTH);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < KEY_LENGTH; i++) values[i] = Math.floor(Math.random() * 0xffffffff);
  }
  for (let i = 0; i < KEY_LENGTH; i++) {
    out += KEY_ALPHABET[values[i] % KEY_ALPHABET.length];
  }
  return out;
}

/**
 * Normalises a key for comparison: trims, drops inner whitespace, and
 * uppercases, so a key read off paper or a screen always matches regardless
 * of case or spacing the player typed.
 */
export function normaliseKey(raw: string | undefined | null): string {
  return (raw ?? '').replace(/\s+/g, '').toUpperCase();
}

/** True when `presented` matches the character's key (or the character has none — legacy games). */
export function keyMatches(presented: string | undefined | null, expected?: string): boolean {
  if (!expected) return true; // Legacy characters created before keys existed.
  const a = normaliseKey(presented);
  const b = normaliseKey(expected);
  return a.length > 0 && a === b;
}

/** Convenience accessor that backfills a missing key on read (legacy data). */
export function characterKey(character: Pick<HuntCharacter, 'key'>): string {
  return character.key?.trim() || '';
}