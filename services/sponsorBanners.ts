/** One deploy-time sponsor banner a hunt creator may attach to a character. */
export interface SponsorBanner {
  id: string;
  name: string;
  description: string;
  /** Same-origin public path under `/marketing/`. The manifest validator rejects remote URLs. */
  src: string;
  /** Accessible label for the banner image. */
  alt: string;
}

const MANIFEST_URL = '/marketing/manifest.json';
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_SRC = /^\/marketing\/[A-Za-z0-9 _\-.]+\.(png|webp|jpg|jpeg)$/;

let manifestPromise: Promise<SponsorBanner[]> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label} in sponsor roster.`);
  return value.trim();
}

/** Encodes each path segment so filenames with spaces still load (`encodeURI` leaves `/` intact). */
export function encodePublicPath(path: string): string {
  return encodeURI(path);
}

function parseManifest(value: unknown): SponsorBanner[] {
  if (!isRecord(value) || !Array.isArray(value.banners)) {
    throw new Error('Sponsor roster is missing its banners list.');
  }
  const seen = new Set<string>();
  return value.banners.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Invalid sponsor roster entry ${index + 1}.`);
    const id = requiredString(entry.id, 'sponsor id');
    if (!SAFE_ID.test(id) || seen.has(id)) {
      throw new Error(`Sponsor roster IDs must be unique and URL-safe: “${id}”.`);
    }
    seen.add(id);
    const src = requiredString(entry.src, `src for ${id}`);
    if (!SAFE_SRC.test(src) || src.includes('..') || src.includes('//marketing//')) {
      throw new Error(`Invalid marketing path for sponsor roster entry “${id}”.`);
    }
    return {
      id,
      name: requiredString(entry.name, `name for ${id}`),
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      src,
      alt: typeof entry.alt === 'string' && entry.alt.trim() ? entry.alt.trim() : requiredString(entry.name, `name for ${id}`),
    };
  });
}

async function fetchManifest(): Promise<SponsorBanner[]> {
  const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Could not load the sponsor roster (${response.status}).`);
  return parseManifest(await response.json());
}

/** Loads and validates the deployment sponsor roster once per browser session. */
export function loadSponsorBanners(): Promise<SponsorBanner[]> {
  if (!manifestPromise) {
    manifestPromise = fetchManifest().catch(error => {
      manifestPromise = null;
      throw error;
    });
  }
  return manifestPromise;
}
