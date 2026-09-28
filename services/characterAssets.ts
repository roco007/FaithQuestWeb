import type { HuntCharacterType } from '../types/hunt';
import type { ARCharacterSizing } from '../utils/arPlacement';

export type CharacterAssetKind = 'model' | 'image' | 'video';

/** One deploy-time camera asset that a hunt creator may place on the map. */
export interface CharacterAsset {
  id: string;
  name: string;
  description: string;
  kind: CharacterAssetKind;
  /** Same-origin public path. The manifest validator rejects remote URLs. */
  src: string;
  /**
   * Optional second file for `video` assets (e.g. an HEVC `.mov` playing the
   * same clip for iOS Safari, which cannot play VP9 alpha). Same-origin and
   * validated like `src`; ignored for other kinds.
   */
  fallbackSrc?: string;
  /** Built-in character used for the pin, accent, and failed-load fallback. */
  fallbackType: HuntCharacterType;
  accent: string;
  /** Apparent height in metres, used for perspective-correct camera framing. */
  realHeightM: number;
  /** Visible width divided by visible height. */
  aspectRatio: number;
  attribution?: string;
}

/** Normalised height of a loaded custom instance before camera frame scaling. */
export const CHARACTER_ASSET_NATURAL_HEIGHT = 1;

const FALLBACK_TYPES: HuntCharacterType[] = ['guardian', 'angel', 'monk', 'flame', 'oracle'];
const ASSET_EXTENSIONS: Record<CharacterAssetKind, string[]> = {
  model: ['glb'],
  image: ['png', 'webp', 'jpg', 'jpeg'],
  video: ['webm', 'mp4', 'mov'],
};
const MANIFEST_URL = '/characters/manifest.json';
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let manifestPromise: Promise<CharacterAsset[]> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label} in roster.`);
  return value.trim();
}

function positiveNumber(value: unknown, label: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`Invalid ${label} in character roster.`);
  }
  return value;
}

function safeAssetPath(value: unknown, kind: CharacterAssetKind, id: string): string {
  const path = requiredString(value, 'asset src');
  const normalised = path.toLowerCase();
  const extension = normalised.split('.').pop() ?? '';
  if (
    !path.startsWith('/characters/') ||
    path.includes('..') ||
    path.includes('//') ||
    !ASSET_EXTENSIONS[kind].includes(extension)
  ) {
    throw new Error(`Invalid ${kind} path for character roster entry “${id}”.`);
  }
  return path;
}

function parseManifest(value: unknown): CharacterAsset[] {
  if (!isRecord(value) || !Array.isArray(value.characters)) {
    throw new Error('Character roster is missing its characters list.');
  }
  const seen = new Set<string>();
  return value.characters.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Invalid character roster entry ${index + 1}.`);
    const id = requiredString(entry.id, 'character id');
    if (!SAFE_ID.test(id) || seen.has(id)) {
      throw new Error(`Character roster IDs must be unique and URL-safe: “${id}”.`);
    }
    seen.add(id);
    const kind = entry.kind;
    if (kind !== 'model' && kind !== 'image' && kind !== 'video') {
      throw new Error(`Invalid kind for character roster entry “${id}”.`);
    }
    const fallbackType = entry.fallbackType;
    if (typeof fallbackType !== 'string' || !FALLBACK_TYPES.includes(fallbackType as HuntCharacterType)) {
      throw new Error(`Invalid fallbackType for character roster entry “${id}”.`);
    }
    const accent = requiredString(entry.accent, `accent for ${id}`);
    if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new Error(`Invalid accent colour for “${id}”.`);
    return {
      id,
      name: requiredString(entry.name, `name for ${id}`),
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      kind,
      src: safeAssetPath(entry.src, kind, id),
      ...(kind === 'video' &&
      typeof entry.fallbackSrc === 'string' &&
      entry.fallbackSrc.trim()
        ? { fallbackSrc: safeAssetPath(entry.fallbackSrc, 'video', id) }
        : {}),
      fallbackType: fallbackType as HuntCharacterType,
      accent,
      realHeightM: positiveNumber(entry.realHeightM, `realHeightM for ${id}`, 20),
      aspectRatio: positiveNumber(entry.aspectRatio, `aspectRatio for ${id}`, 10),
      ...(typeof entry.attribution === 'string' && entry.attribution.trim()
        ? { attribution: entry.attribution.trim() }
        : {}),
    };
  });
}

async function fetchManifest(): Promise<CharacterAsset[]> {
  const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load the camera character roster (${response.status}).`);
  return parseManifest(await response.json());
}

/** Loads and validates the deployment roster once per browser session. */
export function loadCharacterAssets(): Promise<CharacterAsset[]> {
  if (!manifestPromise) {
    manifestPromise = fetchManifest().catch(error => {
      manifestPromise = null;
      throw error;
    });
  }
  return manifestPromise;
}

export function getCharacterAssetSizing(asset: CharacterAsset): ARCharacterSizing {
  return {
    naturalHeight: CHARACTER_ASSET_NATURAL_HEIGHT,
    realHeightM: asset.realHeightM,
    aspectRatio: asset.aspectRatio,
  };
}
