'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker, Circle, LeafletMouseEvent } from 'leaflet';
import type { HuntCharacter, HuntCharacterType } from '../types/hunt';
import type { LocationCoordinates } from '../types/game';

/**
 * OpenStreetMap standard tiles (keyless, z0-19), darkened via CSS to fit the
 * app's navy theme. See the matching note in GameMap.tsx for why the previous
 * CARTO/Esri dark providers were dropped.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CHARACTER_GLYPHS: Record<HuntCharacterType, string> = {
  guardian: '🛡',
  angel: '👼',
  monk: '📿',
  flame: '🔥',
  oracle: '🔮',
};

interface CharacterPinMapProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  characterType: HuntCharacterType;
  name: string;
  /** The creator's live position — shown as a blue dot for reference. */
  currentLocation?: LocationCoordinates | null;
  onCoordinatesChange: (latitude: number, longitude: number) => void;
}

/**
 * Creator's map-placement picker.
 *
 * Stands in for the native draggable `Marker` on `react-native-maps`. The pin is
 * dragged by clicking/tapping the map, which keeps the interaction identical on
 * desktop (no touch-drag required) and mobile. The circle shows the discovery
 * radius players will need to walk within.
 */
export function CharacterPinMap({
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
          html: `<div style="width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-size:20px;background:#38bdf8;border:2.5px solid #e0f2fe;box-shadow:0 3px 10px rgba(0,0,0,.6)">${glyph}</div>`,
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
          html: '<div title="Your current location" style="width:18px;height:18px;border-radius:50%;background:#38bdf8;border:3px solid #fff;box-shadow:0 0 0 2px rgba(56,189,248,.45),0 2px 6px rgba(0,0,0,.5);box-sizing:border-box"></div>',
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

  return (
    <div
      ref={containerRef}
      className="mapCanvas creatorMap"
      role="application"
      aria-label="Place character on map"
    />
  );
}