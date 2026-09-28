'use client';

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, type GoogleMapsLibraries } from '../utils/googleMapsLoader';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID } from '../utils/mapConfig';
import { CHARACTER_GLYPHS, characterPinHtml, creatorPinHtml, pinElement } from './mapPins';
import { calculateHaversineDistance } from '../utils/geo';
import type { CharacterPinMapProps, MapProviderProps } from './mapTypes';

const CHARACTER_PIN_SIZE = 40;
const CREATOR_PIN_SIZE = 18;

/** Beyond this the pin and the creator are framed together rather than the pin alone. */
const FRAME_TOGETHER_METERS = 150;

interface GoogleCharacterPinMapProps extends CharacterPinMapProps, MapProviderProps {}

/**
 * Google Maps creator's map-placement picker.
 *
 * The Google counterpart to `LeafletCharacterPinMap`, and a closer match to the
 * native app than the Leaflet version: `AdvancedMarkerElement` is genuinely
 * draggable, so the pin can be grabbed directly *and* the map still accepts a
 * tap to place it, which is what makes the control usable on desktop where a
 * touch-drag is awkward. Both interactions are preserved here.
 */
export function GoogleCharacterPinMap({
  latitude,
  longitude,
  radiusMeters,
  characterType,
  name,
  currentLocation,
  onCoordinatesChange,
  onProviderError,
}: GoogleCharacterPinMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const apiRef = useRef<GoogleMapsLibraries | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const creatorMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const creatorCircleRef = useRef<google.maps.Circle | null>(null);

  const onChangeRef = useRef(onCoordinatesChange);
  onChangeRef.current = onCoordinatesChange;
  const onProviderErrorRef = useRef(onProviderError);
  onProviderErrorRef.current = onProviderError;
  // Captures the creator's position at mount for the initial framing; the
  // marker itself is kept in sync by the effect below.
  const currentLocationRef = useRef(currentLocation);
  currentLocationRef.current = currentLocation;
  // The API loads asynchronously; flip once the map exists so the marker
  // effects run again with it available (they'd otherwise fire too early).
  const [mapReady, setMapReady] = useState(false);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let disposed = false;

    (async () => {
      const api = await loadGoogleMaps(GOOGLE_MAPS_API_KEY);
      if (disposed || !containerRef.current) return;

      const map = new api.Map(containerRef.current, {
        center: { lat: latitude, lng: longitude },
        zoom: 17,
        mapId: GOOGLE_MAPS_MAP_ID,
        colorScheme: api.ColorScheme.DARK,
        zoomControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
      });

      // Frame the pin — and the creator's own position when it would otherwise
      // fall off-screen — so both are visible when the editor opens.
      const creator = currentLocationRef.current;
      if (creator) {
        const gap = calculateHaversineDistance({ latitude, longitude }, creator);
        if (gap > FRAME_TOGETHER_METERS) {
          const bounds = new api.LatLngBounds({ lat: latitude, lng: longitude });
          bounds.extend({ lat: creator.latitude, lng: creator.longitude });
          map.fitBounds(bounds, 48);
        }
      }

      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        // `latLng` is a LatLng instance, so its lat/lng are methods, not
        // properties — hence `lat()` rather than `.lat`.
        if (e.latLng) onChangeRef.current(e.latLng.lat(), e.latLng.lng());
      });

      mapRef.current = map;
      apiRef.current = api;
      setMapReady(true);
      setTimeout(() => google.maps.event.trigger(map, 'resize'), 0);
    })().catch((err) => {
      console.error('[FaithQuest] Google Maps failed to load on the placement map.', err);
      onProviderErrorRef.current?.();
    });

    return () => {
      disposed = true;
      mapRef.current = null;
      apiRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      creatorMarkerRef.current = null;
      creatorCircleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keep the pin + radius circle in sync with the draft.
  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (!api || !map) return;

    const position = { lat: latitude, lng: longitude };
    const glyph = CHARACTER_GLYPHS[characterType] ?? '✨';

    if (markerRef.current) {
      // Writable property, not a `setPosition()` method — see the note on
      // AdvancedMarkerElement in types/google.maps.d.ts.
      markerRef.current.position = position;
      // Rebuilt rather than diffed: the pin is the only thing on screen and the
      // markup is a plain string, so replacing the element is cheap and keeps
      // the artwork in step with the character type.
      markerRef.current.content = pinElement(characterPinHtml(glyph), CHARACTER_PIN_SIZE);
      markerRef.current.title = `${glyph} ${name}`;
    } else {
      const marker = new api.AdvancedMarkerElement({
        map,
        position,
        content: pinElement(characterPinHtml(glyph), CHARACTER_PIN_SIZE),
        title: `${glyph} ${name}`,
        gmpDraggable: true,
        zIndex: 100,
      });
      marker.addListener('dragend', (e: google.maps.MarkerDragEvent) => {
        // Same LatLng-instance rule as the map click handler above.
        onChangeRef.current(e.latLng.lat(), e.latLng.lng());
      });
      markerRef.current = marker;
    }

    if (circleRef.current) {
      circleRef.current.setCenter(position);
      circleRef.current.setRadius(radiusMeters);
    } else {
      circleRef.current = new api.Circle({
        map,
        center: position,
        radius: radiusMeters,
        strokeColor: '#f59e0b',
        strokeWeight: 1.5,
        strokeOpacity: 0.8,
        fillColor: '#f59e0b',
        fillOpacity: 0.12,
        clickable: false,
      });
    }
  }, [mapReady, latitude, longitude, radiusMeters, characterType, name]);

  // Draw (and keep current) the creator's own position as a blue dot, with an
  // accuracy circle when GPS precision is known.
  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (!api || !map) return;

    if (!currentLocation) {
      creatorMarkerRef.current?.setMap(null);
      creatorMarkerRef.current = null;
      creatorCircleRef.current?.setMap(null);
      creatorCircleRef.current = null;
      return;
    }

    const position = { lat: currentLocation.latitude, lng: currentLocation.longitude };

    if (creatorMarkerRef.current) {
      creatorMarkerRef.current.position = position;
    } else {
      const content = pinElement(creatorPinHtml, CREATOR_PIN_SIZE);
      // Never block click-to-place-pin under the dot.
      content.style.pointerEvents = 'none';
      creatorMarkerRef.current = new api.AdvancedMarkerElement({
        map,
        position,
        content,
        title: 'Your current location',
        zIndex: 1000,
      });
    }

    const accuracy = currentLocation.accuracy ?? 0;
    if (accuracy > 0) {
      if (creatorCircleRef.current) {
        creatorCircleRef.current.setCenter(position);
        creatorCircleRef.current.setRadius(Math.min(accuracy, 200));
      } else {
        creatorCircleRef.current = new api.Circle({
          map,
          center: position,
          radius: Math.min(accuracy, 200),
          strokeColor: '#38bdf8',
          strokeWeight: 1,
          strokeOpacity: 0.5,
          fillColor: '#38bdf8',
          fillOpacity: 0.08,
          clickable: false,
        });
      }
    } else if (creatorCircleRef.current) {
      creatorCircleRef.current.setMap(null);
      creatorCircleRef.current = null;
    }
  }, [mapReady, currentLocation]);

  // Follow the pin when its coordinates change.
  //
  // The marker is repositioned by the effect above, but a place chosen from
  // search can be kilometres away, so the marker would silently move off-screen
  // and the creator would see nothing happen. Panning on every real change is
  // safe: when the change came from a click or a drag, that point is already
  // centred, so the pan is a no-op.
  const lastPlacedRef = useRef({ latitude, longitude });
  useEffect(() => {
    const previous = lastPlacedRef.current;
    lastPlacedRef.current = { latitude, longitude };

    // Ignore sub-metre jitter from a fresh GPS fix rather than a real move.
    if (calculateHaversineDistance(previous, { latitude, longitude }) < 1) return;

    mapRef.current?.panTo({ lat: latitude, lng: longitude });
  }, [latitude, longitude]);

  return (
    <div
      ref={containerRef}
      className="mapCanvas creatorMap"
      role="application"
      aria-label="Place character on map"
    />
  );
}
