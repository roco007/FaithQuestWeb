'use client';

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { loadGoogleMaps, type GoogleMapsLibraries } from '../utils/googleMapsLoader';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID } from '../utils/mapConfig';
import { nodePinHtml, pinElement, userPinHtml, type NodePinState } from './mapPins';
import type { GameMapProps, GameMapRef, MapProviderProps, MapViewport } from './mapTypes';

const NODE_PIN_SIZE = 38;
const USER_PIN_SIZE = 26;

interface GoogleGameMapProps extends GameMapProps, MapProviderProps {}

/**
 * Google Maps quest map.
 *
 * Behaviour-for-behaviour equivalent to `LeafletGameMap` — the same
 * `GameMapRef` imperative handle drives it, so `app/page.tsx` does not know or
 * care which provider is mounted. `GameMap` picks between the two.
 *
 * Two differences from the Leaflet original are forced by the API rather than
 * chosen:
 *
 * - Dark styling is native (`colorScheme: DARK`). Leaflet needed a CSS
 *   `invert()` filter over the raster tiles, which cannot be used here because
 *   Google forbids obscuring its logo/attribution.
 * - The imperative `centerOn(view, animate)` signature keeps its `animate`
 *   argument for compatibility, but Google's `panTo` is always animated, so the
 *   flag cannot be honoured the way Leaflet's `setView({animate})` could.
 */
export const GoogleGameMap = forwardRef<GameMapRef, GoogleGameMapProps>(
  function GoogleGameMap(
    {
      nodes,
      userLocation,
      activeTargetNode,
      completedNodeIds,
      initialView,
      onSelectNode,
      followUser = false,
      onProviderError,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<google.maps.Map | null>(null);
    const apiRef = useRef<GoogleMapsLibraries | null>(null);

    /**
     * Bumped once the map exists, so the layer effects below re-run *after* the
     * API has loaded. Without it every one of them would observe a null `mapRef`
     * on the first commit and silently draw nothing — the same reason the
     * Leaflet version carries a `mapReady` counter.
     */
    const [mapReady, setMapReady] = useState(0);

    /**
     * Advanced markers need a `mapId` and a capable map. When they are
     * unavailable the app cannot draw its HTML pins, so we report the failure
     * and let the dispatcher fall back to Leaflet rather than render a map the
     * player cannot use.
     */
    const [advancedMarkersUnavailable, setAdvancedMarkersUnavailable] = useState(false);

    // Layer handles, kept in refs so panning never re-renders.
    const nodeMarkersRef = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
    const radiusCircleRef = useRef<google.maps.Circle | null>(null);
    const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
    const accuracyCircleRef = useRef<google.maps.Circle | null>(null);

    // Latest props for callbacks that must not re-create the map instance.
    const onSelectNodeRef = useRef(onSelectNode);
    onSelectNodeRef.current = onSelectNode;
    const onProviderErrorRef = useRef(onProviderError);
    onProviderErrorRef.current = onProviderError;

    useImperativeHandle(ref, () => ({
      centerOn: (view: MapViewport) => {
        const map = mapRef.current;
        if (!map) return;
        map.setZoom(view.zoom ?? 16);
        map.panTo({ lat: view.latitude, lng: view.longitude });
      },
      zoomIn: () => {
        const map = mapRef.current;
        if (map) map.setZoom((map.getZoom() ?? 16) + 1);
      },
      zoomOut: () => {
        const map = mapRef.current;
        if (map) map.setZoom((map.getZoom() ?? 16) - 1);
      },
    }));
    // --- Create the map once -------------------------------------------------
    useEffect(() => {
      if (!containerRef.current || mapRef.current) return;

      let disposed = false;

      (async () => {
        const api = await loadGoogleMaps(GOOGLE_MAPS_API_KEY);
        if (disposed || !containerRef.current) return;

        const map = new api.Map(containerRef.current, {
          center: { lat: initialView.latitude, lng: initialView.longitude },
          zoom: initialView.zoom ?? 16,
          // Required for AdvancedMarkerElement. `DEMO_MAP_ID` works for testing;
          // production should pass a real Cloud map ID.
          mapId: GOOGLE_MAPS_MAP_ID,
          colorScheme: api.ColorScheme.DARK,
          // The app renders its own zoom rail in `.questZoomRail`; the built-in
          // corner controls were unreachable behind the HUD cards (see the note
          // on `GameMapRef`). Attribution and the Google logo are NOT disabled —
          // they must stay visible to satisfy the Maps ToS.
          zoomControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
        });

        mapRef.current = map;
        apiRef.current = api;

        // Advanced-marker support is reported asynchronously. If it is missing
        // the map still draws tiles, but our HTML pins cannot be placed on it.
        const checkCapabilities = () => {
          if (map.getMapCapabilities()?.isAdvancedMarkersAvailable === false) {
            setAdvancedMarkersUnavailable(true);
          }
        };
        map.addListener('mapcapabilities_changed', checkCapabilities);
        checkCapabilities();

        // The container can still be settling when the map is constructed (it
        // mounts inside a flex/grid layout), so nudge it once laid out.
        setTimeout(() => {
          google.maps.event.trigger(map, 'resize');
        }, 0);

        setMapReady((n) => n + 1);
      })().catch((err) => {
        // Surfaced in the console because the fallback path is user-visible but
        // a bad key / blocked script is a developer problem, not a player one.
        console.error('[FaithQuest] Google Maps failed to load on the quest map.', err);
        onProviderErrorRef.current?.();
      });

      return () => {
        disposed = true;
        nodeMarkersRef.current.forEach((marker) => marker.setMap(null));
        nodeMarkersRef.current.clear();
        radiusCircleRef.current?.setMap(null);
        userMarkerRef.current?.setMap(null);
        accuracyCircleRef.current?.setMap(null);
        mapRef.current = null;
        apiRef.current = null;
      };
      // Intentionally mount-only: the map instance outlives prop changes, which
      // are applied by the effects below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Hand back to the dispatcher if this provider cannot serve the map.
    useEffect(() => {
      if (advancedMarkersUnavailable) onProviderErrorRef.current?.();
    }, [advancedMarkersUnavailable]);
    // --- Node markers --------------------------------------------------------
    useEffect(() => {
      const api = apiRef.current;
      const map = mapRef.current;
      if (!api || !map) return;

      // Rebuilt wholesale on each change, matching the Leaflet implementation:
      // there are only a handful of nodes, and a full redraw keeps the pin
      // artwork in sync with state changes without diffing by node id.
      nodeMarkersRef.current.forEach((marker) => marker.setMap(null));
      nodeMarkersRef.current.clear();

      nodes.forEach((node) => {
        const state: NodePinState =
          node.id === activeTargetNode?.id
            ? 'active'
            : completedNodeIds.includes(node.id)
              ? 'done'
              : 'idle';

        const marker = new api.AdvancedMarkerElement({
          map,
          position: { lat: node.latitude, lng: node.longitude },
          content: pinElement(nodePinHtml(state), NODE_PIN_SIZE),
          title: node.title,
          // `click` is ignored on an advanced marker unless this is set.
          gmpClickable: true,
          zIndex: state === 'active' ? 1000 : 0,
        });

        marker.addListener('click', () => onSelectNodeRef.current?.(node));
        nodeMarkersRef.current.set(node.id, marker);
      });
    }, [nodes, activeTargetNode, completedNodeIds, mapReady]);

    // --- Discovery-radius circle for the active target -----------------------
    useEffect(() => {
      const api = apiRef.current;
      const map = mapRef.current;
      if (!api || !map) return;

      radiusCircleRef.current?.setMap(null);
      radiusCircleRef.current = null;

      if (!activeTargetNode) return;

      radiusCircleRef.current = new api.Circle({
        map,
        center: { lat: activeTargetNode.latitude, lng: activeTargetNode.longitude },
        radius: activeTargetNode.radiusMeters,
        strokeColor: '#38bdf8',
        strokeWeight: 1.5,
        strokeOpacity: 0.7,
        fillColor: '#38bdf8',
        fillOpacity: 0.12,
        clickable: false,
      });
    }, [activeTargetNode, mapReady]);

    // --- Live player position ------------------------------------------------
    useEffect(() => {
      const api = apiRef.current;
      const map = mapRef.current;
      if (!api || !map) return;

      if (!userLocation) {
        userMarkerRef.current?.setMap(null);
        userMarkerRef.current = null;
        accuracyCircleRef.current?.setMap(null);
        accuracyCircleRef.current = null;
        return;
      }

      const position = { lat: userLocation.latitude, lng: userLocation.longitude };

      if (userMarkerRef.current) {
        // `position` is a writable property on AdvancedMarkerElement; there is no
        // `setPosition()` method (unlike Circle, which does have setCenter).
        userMarkerRef.current.position = position;
      } else {
        const content = pinElement(userPinHtml, USER_PIN_SIZE);
        // Never intercept a tap meant for a node pin or the map itself.
        content.style.pointerEvents = 'none';
        userMarkerRef.current = new api.AdvancedMarkerElement({
          map,
          position,
          content,
          zIndex: 2000,
        });
      }

      if (typeof userLocation.accuracy === 'number' && userLocation.accuracy > 0) {
        if (accuracyCircleRef.current) {
          accuracyCircleRef.current.setCenter(position);
          accuracyCircleRef.current.setRadius(userLocation.accuracy);
        } else {
          accuracyCircleRef.current = new api.Circle({
            map,
            center: position,
            radius: userLocation.accuracy,
            strokeColor: '#38bdf8',
            strokeWeight: 1,
            strokeOpacity: 0.5,
            fillColor: '#38bdf8',
            fillOpacity: 0.1,
            clickable: false,
          });
        }
      }

      if (followUser) map.panTo(position);
    }, [userLocation, followUser, mapReady]);

    return (
      <div ref={containerRef} className="mapCanvas" role="application" aria-label="Quest map" />
    );
  }
);

