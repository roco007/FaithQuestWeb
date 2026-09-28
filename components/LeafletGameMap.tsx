'use client';

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import type { Map as LeafletMap, LayerGroup, Marker, Circle } from 'leaflet';
import type { ChurchNode } from '../types/node';
import type { LocationCoordinates } from '../types/game';
import { nodePinHtml, userPinHtml, type NodePinState } from './mapPins';
import type { GameMapProps, GameMapRef, MapViewport } from './mapTypes';

/**
 * OpenStreetMap standard tiles.
 *
 * Previously CARTO `dark_all`, which now watermarks every tile with
 * "API KEY REQUIRED" for unauthenticated requests, and Esri's World Dark Gray
 * Canvas, whose dark raster only publishes down to z16 (the map runs at z17-18
 * and returned "Map data not yet available"). OSM covers z0-19 keylessly, and
 * the app darkens it with a CSS filter in globals.css to match its navy theme.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const markerIconSize: [number, number] = [38, 38];
const userIconSize: [number, number] = [26, 26];

/**
 * Leaflet + OpenStreetMap quest map.
 *
 * The original, keyless provider and the automatic fallback whenever no Google
 * Maps API key is configured (see `utils/mapConfig.ts`). `GameMap` renders this
 * or the Google equivalent; consumers always import `GameMap`.
 *
 * Replaces `react-native-maps` with Leaflet + OpenStreetMap tiles, which is the
 * only way to get a real, pannable map in a browser without a paid SDK. Leaflet
 * touches `window` at import time, so it is loaded via dynamic `import()` inside
 * an effect — importing it at module scope would break server rendering.
 */
export const LeafletGameMap = forwardRef<GameMapRef, GameMapProps>(function LeafletGameMap(
  {
    nodes,
    userLocation,
    activeTargetNode,
    completedNodeIds,
    initialView,
    onSelectNode,
    followUser = false,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const LRef = useRef<typeof import('leaflet') | null>(null);

  /**
   * Flips to true once Leaflet has finished loading and the map exists.
   *
   * `leaflet` is imported asynchronously, so on the first render `LRef.current`
   * is still null and every layer effect below bails out. Without this signal
   * those effects would never re-run (no other state changes at that moment),
   * leaving the map permanently blank of markers. Bumping this counter is what
   * re-triggers them.
   */
  // Incremented once the map exists, so the layer effects below re-run *after*
  // Leaflet has finished loading. Without this they would all observe a null
  // LRef on the first commit and silently draw nothing.
  const [mapReady, setMapReady] = useState(0);

  // Layer handles, kept outside React state so panning never re-renders.
  const nodeLayerRef = useRef<LayerGroup | null>(null);
  const radiusCircleRef = useRef<Circle | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const accuracyCircleRef = useRef<Circle | null>(null);

  // Latest props for callbacks that must not re-create the map instance.
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;

  useImperativeHandle(ref, () => ({
    centerOn: (view: MapViewport, animate = true) => {
      mapRef.current?.setView([view.latitude, view.longitude], view.zoom ?? 16, {
        animate,
      });
    },
    zoomIn: () => {
      mapRef.current?.zoomIn();
    },
    zoomOut: () => {
      mapRef.current?.zoomOut();
    },
  }));

  // --- Create the map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let disposed = false;

    (async () => {
      const L = await import('leaflet');
      if (disposed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [initialView.latitude, initialView.longitude],
        zoom: initialView.zoom ?? 16,
        // No built-in zoom corners: the quest HUD overlays cover them on
        // mobile (taps were intercepted by .xpCard/.hudCard). Zooming is
        // exposed via the imperative GameMapRef and rendered in the side rail.
        // Also prevents the duplicate control that a second explicit
        // L.control.zoom() used to add alongside the default one.
        zoomControl: false,
        attributionControl: true,
      });

      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

      nodeLayerRef.current = L.layerGroup().addTo(map);

      LRef.current = L;
      mapRef.current = map;

      // Leaflet needs a nudge when it mounts inside a flex/grid container that
      // was still settling; invalidateSize recalculates the tile grid.
      setTimeout(() => map.invalidateSize(), 0);

      // Let the dependent effects know the map is now available.
      setMapReady((n) => n + 1);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      nodeLayerRef.current = null;
      radiusCircleRef.current = null;
      userMarkerRef.current = null;
      accuracyCircleRef.current = null;
      LRef.current = null;
    };
    // Intentionally mount-only: the map instance outlives prop changes, which
    // are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Node markers --------------------------------------------------------
  useEffect(() => {
    const L = LRef.current;
    const layer = nodeLayerRef.current;
    if (!L || !layer) return;

    layer.clearLayers();

    nodes.forEach((node) => {
      const state: NodePinState =
        node.id === activeTargetNode?.id
          ? 'active'
          : completedNodeIds.includes(node.id)
            ? 'done'
            : 'idle';

      const marker = L.marker([node.latitude, node.longitude], {
        icon: L.divIcon({
          html: nodePinHtml(state),
          className: 'fq-marker',
          iconSize: markerIconSize,
          iconAnchor: [19, 19],
        }),
        title: node.title,
        zIndexOffset: state === 'active' ? 1000 : 0,
      });

      marker.on('click', () => onSelectNodeRef.current?.(node));
      marker.addTo(layer);
    });
  }, [nodes, activeTargetNode, completedNodeIds, mapReady]);

  // --- Discovery-radius circle for the active target -----------------------
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    radiusCircleRef.current?.remove();
    radiusCircleRef.current = null;

    if (!activeTargetNode) return;

    radiusCircleRef.current = L.circle([activeTargetNode.latitude, activeTargetNode.longitude], {
      radius: activeTargetNode.radiusMeters,
      color: '#38bdf8',
      weight: 1.5,
      opacity: 0.7,
      fillColor: '#38bdf8',
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(map);
  }, [activeTargetNode, mapReady]);

  // --- Live player position ------------------------------------------------
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (!userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      accuracyCircleRef.current?.remove();
      accuracyCircleRef.current = null;
      return;
    }

    const latLng: [number, number] = [userLocation.latitude, userLocation.longitude];

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng(latLng);
    } else {
      userMarkerRef.current = L.marker(latLng, {
        icon: L.divIcon({
          html: userPinHtml,
          className: 'fq-user-marker',
          iconSize: userIconSize,
          iconAnchor: [13, 13],
        }),
        interactive: false,
        zIndexOffset: 2000,
      }).addTo(map);
    }

    if (typeof userLocation.accuracy === 'number' && userLocation.accuracy > 0) {
      if (accuracyCircleRef.current) {
        accuracyCircleRef.current.setLatLng(latLng).setRadius(userLocation.accuracy);
      } else {
        accuracyCircleRef.current = L.circle(latLng, {
          radius: userLocation.accuracy,
          color: '#38bdf8',
          weight: 1,
          opacity: 0.5,
          fillColor: '#38bdf8',
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(map);
      }
    }

    if (followUser) map.panTo(latLng, { animate: true, duration: 0.5 });
  }, [userLocation, followUser, mapReady]);

  return <div ref={containerRef} className="mapCanvas" role="application" aria-label="Quest map" />;
});
