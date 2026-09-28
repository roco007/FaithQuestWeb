/**
 * Single-entry loader for the Google Maps JavaScript API.
 *
 * The API is a browser global that must be fetched from a script tag, so it
 * cannot be a normal `import()` — the same reason Leaflet is dynamically
 * imported inside an effect in `LeafletGameMap.tsx`. Everything below runs
 * client-side only; this module is never evaluated during server rendering.
 *
 * Google asks that the script be loaded once per page, so the in-flight
 * promise is memoised: React StrictMode's double-effect and two maps sharing a
 * screen both reuse the same request. A failed load is not memoised, so a
 * transient network error can be retried by the next mount.
 */

/** Libraries the app actually uses. `marker` backs `AdvancedMarkerElement`. */
const LIBRARIES = ['maps', 'marker'] as const;

type LibraryName = (typeof LIBRARIES)[number];
/** The subset of the API surface this app touches, resolved from `maps`/`marker`. */
export interface GoogleMapsLibraries {
  Map: typeof google.maps.Map;
  Circle: typeof google.maps.Circle;
  LatLngBounds: typeof google.maps.LatLngBounds;
  ColorScheme: typeof google.maps.ColorScheme;
  AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement;
}

let pending: Promise<GoogleMapsLibraries> | null = null;

/**
 * Injects the Maps script with a JSONP-style callback, as Google's loader
 * bootstrap does, and resolves once `google.maps` is usable. We then pull
 * individual libraries out of it via `importLibrary`, which is the supported
 * way to tree-shake features and is what the official bootstrap exposes too.
 */
function injectScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const callbackName = '__faithQuestMapsReady__';
    const win = window as unknown as Record<string, unknown>;
    win[callbackName] = () => {
      delete win[callbackName];
      resolve();
    };

    const script = document.createElement('script');
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(apiKey)}` +
      // Pin the channel so an upstream release cannot change rendering or
      // break a deployed build overnight. Bump deliberately, never implicitly.
      '&v=weekly' +
      // Required for the callback above to fire rather than the API running
      // inline, which would block the parser.
      '&loading=async' +
      `&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      delete win[callbackName];
      reject(new Error('Google Maps script failed to load'));
    };
    document.head.appendChild(script);
  });
}

/**
 * Loads the Maps script and resolves the libraries the app needs.
 *
 * Rejects if the script cannot be fetched or the key is rejected, which is the
 * signal the provider components use to fall back to Leaflet.
 */
export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsLibraries> {
  if (pending) return pending;

  pending = (async () => {
    await injectScript(apiKey);

    const resolved = await Promise.all(
      LIBRARIES.map((name) => google.maps.importLibrary(name) as Promise<unknown>),
    );
    const [maps, marker] = resolved as [
      google.maps.MapsLibrary,
      google.maps.MarkerLibrary,
    ];

    return {
      Map: maps.Map,
      Circle: maps.Circle,
      AdvancedMarkerElement: marker.AdvancedMarkerElement,
      // `ColorScheme` and `LatLngBounds` are *not* members of the `maps`
      // library object — verified against the live API, whose `importLibrary
      // ('maps')` keys are Map, Circle, Polygon, InfoWindow, OverlayView and
      // friends. They are only reachable off the `google.maps` namespace, which
      // the bootstrap has populated by the time the callback above fires.
      LatLngBounds: google.maps.LatLngBounds,
      ColorScheme: google.maps.ColorScheme,
    };
  })();

  // Do not cache failures — a later mount should be free to try again.
  pending.catch(() => {
    pending = null;
  });

  return pending;
}

/** The `places` library, resolved lazily so only searching for it pays the cost. */
export interface GooglePlacesLibraries {
  AutocompleteService: typeof google.maps.AutocompleteService;
  PlacesService: typeof google.maps.PlacesService;
}

let placesPending: Promise<GooglePlacesLibraries> | null = null;

/**
 * Legacy `places`-library loader, kept for the map tiles path that needs it.
 * Place *search* no longer uses it — `utils/placeSearch.ts` calls the Places
 * API (New) `searchText` REST endpoint directly, which needs no library, no
 * session token, and no per-prediction `getDetails` round-trip.
 */
export function loadGooglePlaces(apiKey: string): Promise<GooglePlacesLibraries> {
  if (placesPending) return placesPending;

  placesPending = (async () => {
    // The bootstrap script has to exist before `importLibrary` is available.
    await loadGoogleMaps(apiKey);
    const places = (await google.maps.importLibrary('places')) as google.maps.PlacesLibrary;
    return {
      AutocompleteService: places.AutocompleteService,
      PlacesService: places.PlacesService,
    };
  })();

  placesPending.catch(() => {
    placesPending = null;
  });

  return placesPending;
}