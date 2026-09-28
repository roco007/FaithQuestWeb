/**
 * Minimal ambient declarations for the Google Maps JavaScript API.
 *
 * Hand-written rather than pulled from `@types/google.maps` so the app keeps
 * its current dependency list; it declares only the surface `GoogleGameMap`
 * and `GoogleCharacterPinMap` actually use. That is a deliberate trade — the
 * types are verified by `npx tsc --noEmit` against real call sites, but they
 * are not a mirror of the full API surface, so treat them as a starting point
 * rather than a contract.
 */

declare namespace google.maps {
  /** Map colour theme. Google renders these natively, so no CSS filter is needed. */
  enum ColorScheme {
    LIGHT = 'LIGHT',
    DARK = 'DARK',
  }

  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  /** Live capabilities of a map instance, used to detect advanced-marker support. */
  interface MapCapabilities {
    isAdvancedMarkersAvailable: boolean;
  }

  interface MapOptions {
    center?: LatLngLiteral;
    zoom?: number;
    mapId?: string;
    colorScheme?: ColorScheme | null;
    disableDefaultUI?: boolean;
    clickableIcons?: boolean;
    gestureHandling?: string;
    /** Disables the +/- buttons; the app renders its own zoom rail instead. */
    zoomControl?: boolean;
    streetViewControl?: boolean;
    fullscreenControl?: boolean;
    mapTypeControl?: boolean;
  }

  /** Google map instance. */
  class Map extends MVCObject {
    constructor(container: HTMLElement, options?: MapOptions);
    setCenter(center: LatLngLiteral): void;
    getCenter(): LatLngLiteral | undefined;
    setZoom(zoom: number): void;
    getZoom(): number | undefined;
    panTo(center: LatLngLiteral): void;
    fitBounds(bounds: LatLngBounds, padding?: number): void;
    getMapCapabilities(): MapCapabilities | undefined;
  }

  class LatLngBounds {
    constructor(sw?: LatLngLiteral, ne?: LatLngLiteral);
    extend(point: LatLngLiteral): LatLngBounds;
  }

  /**
   * A geographic point.
   *
   * Note `lat`/`lng` are **methods** here, not properties — event payloads such
   * as `MapMouseEvent.latLng` and `AdvancedMarkerDragEvent.latLng` carry a
   * `LatLng` instance, so they must be read with `lat()` / `lng()`. Verified
   * against the live API.
   */
  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }

  interface CircleOptions {
    center?: LatLngLiteral;
    radius?: number;
    map?: Map | null;
    clickable?: boolean;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
    fillColor?: string;
    fillOpacity?: number;
    zIndex?: number;
  }

  /** Discovers a target's radius on the map. */
  class Circle {
    constructor(options?: CircleOptions);
    setCenter(center: LatLngLiteral): void;
    getCenter(): LatLngLiteral | undefined;
    setRadius(radius: number): void;
    getRadius(): number | undefined;
    setMap(map: Map | null): void;
    getMap(): Map | null;
  }

  interface MapMouseEvent {
    /**
     * The clicked point, as a `LatLng` instance — read it with `lat()` / `lng()`.
     * It is not a `{lat, lng}` literal, so `e.latLng.lat.toFixed()` throws.
     */
    latLng: LatLng | null;
  }

  interface MapsEventListener {
    remove(): void;
  }

  /** Base class for objects that emit events (`click`, `dragend`, …). */
  class MVCObject {
    addListener(eventName: string, handler: (...args: never[]) => void): MapsEventListener;
  }

  interface DragEvent extends MapMouseEvent {}

  /**
   * Payload for the `dragend` event on a draggable advanced marker.
   *
   * As with `MapMouseEvent`, `latLng` is a `LatLng` instance and must be read
   * with `lat()` / `lng()` rather than as plain properties.
   */
  interface MarkerDragEvent {
    latLng: LatLng;
  }

  namespace marker {
    interface AdvancedMarkerElementOptions {
      map?: Map | null;
      position?: LatLngLiteral;
      /** Any DOM node; this is how the app's HTML pins are rendered. */
      content?: Node | string;
      title?: string;
      /** Required for `click` to fire on an advanced marker. */
      gmpClickable?: boolean;
      gmpDraggable?: boolean;
      zIndex?: number;
    }

    /**
     * Marker that renders arbitrary DOM.
     *
     * Requires the map to be constructed with a `mapId`; without one it throws
     * "AdvancedMarkerElement cannot load without a Map ID".
     *
     * Note the asymmetry, which is easy to get wrong: `map` has a real
     * `setMap()` method, but there is **no `setPosition()`** — position is a
     * writable property only. Verified against the live API: the prototype
     * exposes `addListener` and `setMap`, while `position`, `content`, `title`
     * and `zIndex` are accessor properties assigned directly. Calling
     * `setPosition()` here throws "is not a function".
     */
    class AdvancedMarkerElement extends MVCObject {
      constructor(options?: AdvancedMarkerElementOptions);
      map: Map | null;
      position?: LatLngLiteral;
      content?: Node | string;
      title?: string;
      zIndex?: number;
      gmpClickable?: boolean;
      gmpDraggable?: boolean;
      setMap(map: Map | null): void;
    }
  }

  /**
   * The object returned by `importLibrary('maps')`.
   *
   * Deliberately narrow: verified against the live API, this object carries
   * Map, Circle, Polygon, InfoWindow, OverlayView, Data and similar — it does
   * *not* carry `ColorScheme` or `LatLngBounds`, which exist only on the
   * `google.maps` namespace. Getting this wrong throws at runtime, so the
   * loader reads those two from the namespace instead.
   */
  interface MapsLibrary {
    Map: typeof Map;
    Circle: typeof Circle;
  }

  /** The library object returned by `importLibrary('marker')`. */
  interface MarkerLibrary {
    AdvancedMarkerElement: typeof marker.AdvancedMarkerElement;
  }

  /** One autocomplete suggestion, as returned by `PlacesService.getPlacePredictions`. */
  interface AutocompletePrediction {
    /** Opaque id to pass to `PlacesService.getDetails` for coordinates. */
    place_id: string;
    /** Full human-readable line, e.g. "Mission Basilica, San Francisco, CA, USA". */
    description: string;
    /** Place name and its containing area, split for two-line rendering. */
    structured_formatting?: {
      main_text: string;
      secondary_text: string;
    };
  }

  interface GetPlacePredictionsRequest {
    input: string;
    /**
     * Bias results toward an area.
     *
     * Accepts a `Circle` (`{circle: {center, radius}}`) or a `Rectangle`
     * (`{rectangle: {north, south, east, west}}`). Verified: a bare
     * `{lat, lng}` is silently ignored, so biasing requires the wrapped form.
     */
    locationBias?: { circle: { center: LatLngLiteral; radius: number } } | { bounds: LatLngBounds };
  }

  /** The `geometry.location` returned by `getDetails`. */
  interface PlaceGeometry {
    location: LatLng;
  }

  interface GetDetailsRequest {
    placeId: string;
    /** Field mask — the API bills per requested field group, so keep it minimal. */
    fields: string[];
  }

  /**
   * Legacy autocomplete types ("places" library). Search no longer uses these
   * — `utils/placeSearch.ts` calls Places API (New) `searchText` instead —
   * but they are kept so `utils/googleMapsLoader.ts` still typechecks.
   *
   * Verified against the live API: `getPlacePredictions` lives on
   * `AutocompleteService`, **not** on `PlacesService` — `PlacesService` exposes
   * only `getDetails` / `textSearch` / `nearbySearch` / `findPlaceFromQuery` /
   * `findPlaceFromPhoneNumber`. Both are needed: predictions supply the
   * `place_id`, `PlacesService` turns that id into coordinates.
   *
   * `AutocompleteService` takes no constructor argument.
   */
  class AutocompleteService {
    getPlacePredictions(
      request: GetPlacePredictionsRequest,
      callback: (predictions: AutocompletePrediction[] | null, status: string) => void,
    ): void;
  }

  /**
   * Place details, keyed by `place_id` (from `AutocompleteService`).
   *
   * `PlacesService` needs a node to attach its internal controls to, even though
   * this app uses neither those controls nor an autocomplete widget — it calls
   * `getDetails` directly. The node must stay referenced or it can be collected.
   */
  class PlacesService {
    constructor(node: HTMLElement);
    getDetails(
      request: GetDetailsRequest,
      callback: (place: { geometry?: PlaceGeometry } | null, status: string) => void,
    ): void;
  }

  /** The library object returned by `importLibrary('places')`. */
  interface PlacesLibrary {
    AutocompleteService: typeof AutocompleteService;
    PlacesService: typeof PlacesService;
  }

  function importLibrary(name: string): Promise<unknown>;

  /**
   * Low-level event helpers. `trigger` forces a map to re-measure its
   * container, the equivalent of Leaflet's `invalidateSize()`.
   */
  namespace event {
    function trigger(instance: object, eventName: string, ...args: unknown[]): void;
  }
}