/**
 * Place search for the creator's placement picker.
 *
 * Two backends, chosen at runtime:
 *
 * - **Google Places API (New)** — used when a Maps key is configured *and* the
 *   "Places API (New)" is enabled for it. This is the good path: it
 *   fuzzy-matches business names ("good flippin' burgers vasai" →
 *   "GOOD FLIPPIN' BURGERS®, Vasai West") exactly like google.com/maps, and is
 *   biased toward the area the creator is working in.
 * - **Keyless cascade** — Nominatim over degraded query variants, then Photon's
 *   fuzzy OSM index. Plain fetch-based geocoding, so it needs no SDK and no
 *   `places` library, and it is the only path that works in the Leaflet
 *   provider.
 *
 * The Google path is attempted first and *falls back on any failure*, which
 * matters because a key with only the Maps JavaScript API enabled (Places
 * disabled) is a common misconfiguration that only shows up at call time as an
 * HTTP 403 / `REQUEST_DENIED` (verified against the live API). Search is a
 * convenience — a hunt must still be authorable by tapping the map — so it
 * degrades quietly instead of breaking.
 */

import { GOOGLE_MAPS_API_KEY } from './mapConfig';

/** One suggestion in the dropdown. */
export interface PlaceSuggestion {
  id: string;
  /** Primary label, e.g. "Mission Basilica". */
  title: string;
  /** Secondary line, e.g. "San Francisco, California, USA". */
  subtitle: string;
  latitude: number;
  longitude: number;
}

/** Coordinates used to bias search results, so nearby places rank first. */
export interface SearchBias {
  latitude: number;
  longitude: number;
}

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
/** Their usage policy caps result counts and requires identifying the client. */
const NOMINATIM_LIMIT = 6;
/**
 * Photon (Komoot, OSM-based POI index) — the second keyless tier. Unlike
 * Nominatim, which AND-matches every token ("good flippin' vasai" matches no
 * single row), Photon fuzzy-matches business names ("Good Flippin' Burgers"
 * in Mumbai/Bengaluru/Pune) and ranks with the `lat`/`lon` bias when given.
 */
const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';
const PHOTON_LIMIT = 6;
export const SEARCH_DEBOUNCE_MS = 300;
export const MIN_QUERY_LENGTH = 3;
/**
 * Upper bound on a single Places (New) call.
 *
 * The REST endpoint always answers or fails fast — unlike the legacy
 * callback API, where a disabled Places API with a `locationBias` never
 * invoked the callback at all — so this only guards against a true network
 * stall. Falling back immediately beats leaving the spinner up.
 */
const GOOGLE_CALL_TIMEOUT_MS = 6000;
/** Upper bound on one keyless geocode call before trying the next variant. */
const KEYLESS_CALL_TIMEOUT_MS = 8000;

/**
 * Nominatim rejects requests whose `User-Agent` looks like a bare script, and
 * browsers forbid overriding it, so the app's own Referer is what identifies
 * it — the documented way to call this from a browser.
 */
function nominatimUrl(query: string, bias?: SearchBias): string {
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: String(NOMINATIM_LIMIT),
    addressdetails: '0',
  });
  // A viewbox nudges results toward the creator's area without excluding
  // anywhere else — a hard `bounded` filter would hide valid distant matches.
  if (bias) {
    const span = 0.5;
    params.set(
      'viewbox',
      [
        bias.longitude - span,
        bias.latitude + span,
        bias.longitude + span,
        bias.latitude - span,
      ].join(','),
    );
  }
  return `${NOMINATIM_ENDPOINT}?${params.toString()}`;
}

interface NominatimResult {
  place_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
}

async function searchNominatim(query: string, bias?: SearchBias): Promise<PlaceSuggestion[]> {
  const response = await fetchWithTimeout(
    nominatimUrl(query, bias),
    { headers: { Accept: 'application/json' } },
    KEYLESS_CALL_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);

  const results = (await response.json()) as NominatimResult[];
  return results
    .filter((r) => typeof r.lat === 'string' && typeof r.lon === 'string')
    .map((r, i) => {
      const [title, ...rest] = (r.display_name ?? r.name ?? 'Unnamed place').split(', ');
      return {
        // Nominatim ids are numeric and unique per result; the index keeps
        // React keys stable even when `place_id` is absent.
        id: String(r.place_id ?? `nominatim-${i}`),
        title,

        subtitle: rest.join(', '),
        latitude: Number(r.lat),
        longitude: Number(r.lon),
      };
    })
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
}

/**
 * `fetch` with an upper bound, so one stalled geocode call never holds the
 * search spinner — the caller moves on to the next query variant instead.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Degraded rewrites of a query, most specific first.
 *
 * Verified against live Nominatim: "good flippin' burgers" finds the chain's
 * Mumbai outlet, but appending a locality ("good flippin' burgers vasai")
 * empties the result — Nominatim requires every token to appear in ONE row,
 * so one unmatched word wipes out the whole search while Google Maps
 * fuzzy-matches the business name anyway. Each variant therefore drops one
 * more trailing word (the locality the user usually tacks on), and the search
 * stops at the first variant that returns anything.
 */
function queryVariants(query: string): string[] {
  const words = query.split(/\s+/).filter(Boolean);
  const variants: string[] = [words.join(' ')];
  for (let end = words.length - 1; end >= 2; end -= 1) {
    variants.push(words.slice(0, end).join(' '));
  }
  return [...new Set(variants)];
}

function photonUrl(query: string, bias?: SearchBias): string {
  const params = new URLSearchParams({ q: query, limit: String(PHOTON_LIMIT) });
  // Photon ranks by distance to this point when present; without it results
  // come back in index order (verified: a biased query surfaces the Mumbai
  // outlets first, an unbiased one does not).
  if (bias) {
    params.set('lat', String(bias.latitude));
    params.set('lon', String(bias.longitude));
  }
  return `${PHOTON_ENDPOINT}?${params.toString()}`;
}

interface PhotonProperties {
  name?: string;
  street?: string;
  district?: string;
  city?: string;
  state?: string;
  country?: string;
  osm_id?: number;
}

interface PhotonFeature {
  properties?: PhotonProperties;
  geometry?: { coordinates?: [number, number] };
}

/**
 * Fuzzy business-name tier: finds "Good Flippin' Burgers" from the colloquial
 * "good flippin' vasai" where Nominatim returns nothing. Runs with the raw
 * query only — Photon's own tokenizer already handles the informal words, so
 * the degraded variants add nothing here.
 */
async function searchPhoton(query: string, bias?: SearchBias): Promise<PlaceSuggestion[]> {
  const response = await fetchWithTimeout(
    photonUrl(query, bias),
    { headers: { Accept: 'application/json' } },
    KEYLESS_CALL_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`Photon responded ${response.status}`);

  const body = (await response.json()) as { features?: PhotonFeature[] };
  const features = Array.isArray(body.features) ? body.features : [];
  return features
    .map((feature, i) => {
      const props = feature.properties ?? {};
      const coords = feature.geometry?.coordinates;
      const area = [props.district, props.city, props.state, props.country]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(', ');
      return {
        id: `photon-${String(props.osm_id ?? i)}`,
        title: props.name ?? 'Unnamed place',
        subtitle: [props.street, area].filter((part) => part !== undefined && part.length > 0).join(', '),
        latitude: coords?.[1] ?? Number.NaN,
        longitude: coords?.[0] ?? Number.NaN,
      } satisfies PlaceSuggestion;
    })
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
}

/**
 * Keyless cascade: Nominatim over the degraded query variants first (exact
 * addresses and named landmarks live there), then Photon's fuzzy business-name
 * index. Returns the first non-empty tier so a partial match never shadows a
 * better exact one.
 */
async function searchKeyless(query: string, bias?: SearchBias): Promise<PlaceSuggestion[]> {
  for (const variant of queryVariants(query)) {
    try {
      const results = await searchNominatim(variant, bias);
      if (results.length > 0) return results;
    } catch {
      // A failed variant must not abort the cascade — keep degrading.
    }
  }
  return searchPhoton(query, bias);
}

/**
 * Set once a Places call has failed with an auth/config error, so later
 * searches skip straight to the keyless cascade.
 *
 * Without this latch every keystroke would pay the failure again — and a
 * denied or disabled Places API can never recover without a page reload, so
 * retrying is pure latency for the rest of the session. Only auth/config
 * failures latch: a query with genuinely no matches (empty `places`) must NOT
 * latch, or one odd query would turn Google off for the rest of the session.
 */
let googlePlacesUnusable = false;

interface PlacesNewPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

interface PlacesNewResponse {
  places?: PlacesNewPlace[];
}

/**
 * Google Places API (New) `searchText` — the supported replacement for the
 * legacy `AutocompleteService` + `getDetails` pair.
 *
 * One call returns names, addresses AND coordinates (the legacy flow needed a
 * separately billed `getDetails` per prediction), and it fuzzy-matches
 * business names the way google.com/maps does. Your pasted network trace
 * (`google.com/s?tbm=map…`) is google.com's private UI endpoint — it needs a
 * logged-in session (`SID`/`SAPISID` cookies), is not licensed for third-party
 * apps, and breaks without notice, so this public, key-authenticated API is
 * the correct way to get the same results in the app.
 *
 * The call goes through the same-origin `/api/places-search` proxy: the API
 * key is website-restricted and the Places endpoint rejects browser `Referer`
 * headers, so the server (which sends no browser referrer) makes the upstream
 * call with the key kept out of the client bundle.
 */
async function searchGooglePlaces(
  query: string,
  bias?: SearchBias,
): Promise<PlaceSuggestion[]> {
  const response = await fetchWithTimeout(
    '/api/places-search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        textQuery: query,
        ...(bias ? { latitude: bias.latitude, longitude: bias.longitude } : {}),
      }),
    },
    GOOGLE_CALL_TIMEOUT_MS,
  );
  if (response.status === 502) {
    // Proxy reports a key/config problem (Places API not enabled, bad key):
    // latch Google off and fall back.
    throw new PlacesConfigError(`Places proxy returned ${response.status}`);
  }
  if (!response.ok) throw new Error(`Places API (New) returned ${response.status}`);

  const data = (await response.json()) as PlacesNewResponse;
  const places = Array.isArray(data.places) ? data.places : [];
  return places
    .map((place, i) => {
      const name = place.displayName?.text?.trim() || 'Unnamed place';
      const address = place.formattedAddress?.trim() ?? '';
      return {
        id: place.id ?? `google-${i}`,
        title: name,
        subtitle: address.startsWith(`${name},`) ? address.slice(name.length + 1).trim() : address,
        latitude: place.location?.latitude ?? Number.NaN,
        longitude: place.location?.longitude ?? Number.NaN,
      } satisfies PlaceSuggestion;
    })
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
}

/** Marks an auth/config failure that should latch Google off for the session. */
class PlacesConfigError extends Error {}

/**
 * Finds places matching a free-text query, preferring Google Places (New) and
 * falling back to the keyless cascade (Nominatim variants, then Photon).
 * Never throws: every backend failing yields no results.
 */
export async function searchPlaces(
  query: string,
  bias?: SearchBias,
): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  if (GOOGLE_MAPS_API_KEY && !googlePlacesUnusable) {
    try {
      const google = await searchGooglePlaces(trimmed, bias);
      // Google (like Nominatim) returns an empty list on no match — fall
      // through to the keyless cascade rather than showing "No places found"
      // while Photon would have had an answer.
      if (google.length > 0) return google;
    } catch (error) {
      // Only latch on auth/config failures: genuinely-no-match (empty places)
      // and transient errors must not turn Google off for the session, or one
      // odd query would degrade every later keystroke to the keyless cascade.
      if (error instanceof PlacesConfigError) googlePlacesUnusable = true;
      else {
        try {
          return await searchKeyless(trimmed, bias);
        } catch {
          return [];
        }
      }
    }
  }
  try {
    return await searchKeyless(trimmed, bias);
  } catch {
    return [];
  }
}

