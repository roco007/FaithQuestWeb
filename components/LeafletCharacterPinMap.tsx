'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker, Circle, LeafletMouseEvent } from 'leaflet';
import type { LocationCoordinates } from '../types/game';
import {
  CHARACTER_GLYPHS,
  characterPinHtml,
  creatorPinHtml,
} from './mapPins';
import { calculateHaversineDistance } from '../utils/geo';
import type { CharacterPinMapProps } from './mapTypes';

/**
 * OpenStreetMap standard tiles (keyless, z0-19), darkened via CSS to fit the
 * app's navy theme. See the matching note in LeafletGameMap.tsx for why the
 * previous CARTO/Esri dark providers were dropped.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Leaflet + OpenStreetMap creator's map-placement picker.
 *
 * The keyless fallback for `CharacterPinMap`; see that component for how the
 * provider is chosen.
 *
 * Stands in for the native draggable `Marker` on `react-native-maps`. The pin is
 * dragged by clicking/tapping the map, which keeps the interaction identical on
 * desktop (no touch-drag required) and mobile. The circle shows the discovery
 * radius players will need to walk within.
 */
export function LeafletCharacterPinMap({
  latitude,
  longitude,
  radiusMeters,
  characterType,
  name,
  currentLocation,
  onCoordinatesChange,
}: CharacterPinMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const LRef = useRef<typeof import('leaflet') | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const circleRef = useRef<Circle | null>(null);
  const creatorMarkerRef = useRef<Marker | null>(null);
  const creatorCircleRef = useRef<Circle | null>(null);
  const onChangeRef = useRef(onCoordinatesChange);
  onChangeRef.current = onCoordinatesChange;
  // Captures the creator's position at mount for the initial framing; the
  // marker itself is kept in sync by the effect below.
  const currentLocationRef = useRef(currentLocation);
  currentLocationRef.current = currentLocation;
  // Leaflet loads asynchronously; flip once the map exists so the marker
  // effects run again with L available (they'd otherwise fire too early).
  const [mapReady, setMapReady] = useState(false);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let disposed = false;

    (async () => {
      const L = await import('leaflet');
      if (disposed || !containerRef.current) return;

      const map = L.map(containerRef.current).setView([latitude, longitude], 17);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

      // Frame the pin — and the creator's own position when it would otherwise
      // fall off-screen — so both are visible when the editor opens.
      const creator = currentLocationRef.current;
      if (creator) {
        const pinLatLng = L.latLng(latitude, longitude);
        const creatorLatLng = L.latLng(creator.latitude, creator.longitude);
        if (map.distance(pinLatLng, creatorLatLng) > 150) {
          map.fitBounds(L.latLngBounds([pinLatLng, creatorLatLng]).pad(0.3));
        }
      }

      map.on('click', (e: LeafletMouseEvent) => {
        onChangeRef.current(e.latlng.lat, e.latlng.lng);
      });

      mapRef.current = map;
      LRef.current = L;
      setMapReady(true);
      setTimeout(() => map.invalidateSize(), 0);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      LRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      creatorMarkerRef.current = null;
      creatorCircleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pin + radius circle in sync with the draft.
  useEffect(() => {
    const L = LRef.current;
    if (!L || !mapRef.current) return;

    const latLng: [number, number] = [latitude, longitude];
    const glyph = CHARACTER_GLYPHS[characterType] ?? '✨';

    if (markerRef.current) {
      markerRef.current.setLatLng(latLng);
      markerRef.current.setTooltipContent(`${glyph} ${name}`);
    } else {
      markerRef.current = L.marker(latLng, {
        draggable: true,
        title: name,
        icon: L.divIcon({
          html: characterPinHtml(glyph),
          className: 'fq-marker',
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        }),
      })
        .addTo(mapRef.current)
        .bindTooltip(`${glyph} ${name}`, { direction: 'top', offset: [0, -20] })
        .on('dragend', (e) => {
          const pos = (e.target as Marker).getLatLng();
          onChangeRef.current(pos.lat, pos.lng);
        });
    }

    if (circleRef.current) {
      circleRef.current.setLatLng(latLng).setRadius(radiusMeters);
    } else {
      circleRef.current = L.circle(latLng, {
        radius: radiusMeters,
        color: '#f59e0b',
        weight: 1.5,
        opacity: 0.8,
        fillColor: '#f59e0b',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(mapRef.current);
    }
  }, [mapReady, latitude, longitude, radiusMeters, characterType, name]);

  // Draw (and keep current) the creator's own position as a blue dot, with an
  // accuracy circle when GPS precision is known.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (!currentLocation) {
      creatorMarkerRef.current?.remove();
      creatorMarkerRef.current = null;
      creatorCircleRef.current?.remove();
      creatorCircleRef.current = null;
      return;
    }

    const latLng: [number, number] = [currentLocation.latitude, currentLocation.longitude];

    if (creatorMarkerRef.current) {
      creatorMarkerRef.current.setLatLng(latLng);
    } else {
      creatorMarkerRef.current = L.marker(latLng, {
        interactive: false, // never block click-to-place-pin under the dot
        zIndexOffset: 1000,
        icon: L.divIcon({
          html: creatorPinHtml,
          className: 'fq-marker',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      }).addTo(map);
    }

    const accuracy = currentLocation.accuracy ?? 0;
    if (accuracy > 0) {
      if (creatorCircleRef.current) {
        creatorCircleRef.current.setLatLng(latLng).setRadius(Math.min(accuracy, 200));
      } else {
        creatorCircleRef.current = L.circle(latLng, {
          radius: Math.min(accuracy, 200),
          color: '#38bdf8',
          weight: 1,
          opacity: 0.5,
          fillColor: '#38bdf8',
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(map);
      }
    } else if (creatorCircleRef.current) {
      creatorCircleRef.current.remove();
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

    mapRef.current?.panTo([latitude, longitude]);
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