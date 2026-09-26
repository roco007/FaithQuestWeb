'use client';

import { useRef, useState } from 'react';
import { MapPin, Locate, Plus, Minus } from 'lucide-react';
import { useGame } from '../context/GameContext';
import { GameMap, type GameMapRef } from '../components/GameMap';
import { XPProgressBar } from '../components/XPProgressBar';
import { RadarHUD } from '../components/RadarHUD';
import { ClueModal } from '../components/ClueModal';
import { useLocation } from '../context/LocationContext';
import { triggerHaptic } from '../utils/sound';

/** Fallback view: the hunt's first landmark when no location is known yet. */
const FALLBACK_VIEW = { latitude: 37.774929, longitude: -122.419416, zoom: 17 };

export default function QuestMapPage() {
  const {
    nodes,
    userLocation,
    activeTargetNode,
    proximity,
    progress,
    setActiveTargetNode,
  } = useGame();

  // The watch itself lives in `LocationProvider` (app-wide) so it survives
  // navigating to the hunts; the map only reads its status and can retry.
  const { errorMsg, startTracking } = useLocation();

  const mapRef = useRef<GameMapRef>(null);
  const [clueOpen, setClueOpen] = useState(false);
  const [followUser, setFollowUser] = useState(false);

  // Start the map on the player when we have a fix, otherwise on the hunt.
  const initialView = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude, zoom: 17 }
    : FALLBACK_VIEW;

  const centerOnPlayer = () => {
    // No fix yet: ask the device for one rather than centring on a stale guess.
    if (!userLocation) {
      void startTracking();
      return;
    }
    setFollowUser(true);
    mapRef.current?.centerOn({
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
      zoom: 17,
    });
    triggerHaptic('light');
  };

  const handleSelectNode = (node: (typeof nodes)[number]) => {
    triggerHaptic('light');
    setActiveTargetNode(node);
    mapRef.current?.centerOn({ latitude: node.latitude, longitude: node.longitude, zoom: 18 });
  };

  return (
    <div className="questScreen">
      <GameMap
        ref={mapRef}
        nodes={nodes}
        userLocation={userLocation}
        activeTargetNode={activeTargetNode}
        completedNodeIds={progress.completedNodeIds}
        initialView={initialView}
        onSelectNode={handleSelectNode}
        followUser={followUser}
      />

      <div className="questOverlayTop">
        <XPProgressBar />

        {errorMsg && (
          <div className="banner bannerWarn" style={{ maxWidth: 560, marginTop: 10 }}>
            <MapPin size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {errorMsg}{' '}
              <button
                type="button"
                className="chipBtn"
                style={{ marginLeft: 6 }}
                onClick={startTracking}
              >
                Retry
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="questSideControls">
        <button
          type="button"
          className="mapBtn"
          onClick={centerOnPlayer}
          title="Centre on my position"
          aria-label="Centre on my position"
        >
          <Locate size={20} />
        </button>
        <button
          type="button"
          className={`mapBtn${followUser ? ' mapBtnActive' : ''}`}
          onClick={() => setFollowUser((prev) => !prev)}
          title={followUser ? 'Stop following me' : 'Follow my position'}
          aria-label={followUser ? 'Stop following me' : 'Follow my position'}
          aria-pressed={followUser}
        >
          <Locate size={20} />
        </button>
      </div>

      {/*
        Zoom lives in its own left-edge rail (midway down the map), not in
        Leaflet's built-in corner controls: on phone-width viewports the
        .xpCard / .hudCard overlays cover the map's top-left and bottom-right
        corners and intercept those taps. It can't live in the right rail
        either: on short phones (e.g. iPhone SE) the stacked buttons reach
        .hudCard and the last ones get covered. Top 40% height on the left
        clears both cards at every screen size.
      */}
      <div className="questZoomRail">
        <button
          type="button"
          className="mapBtn"
          onClick={() => {
            mapRef.current?.zoomIn();
            triggerHaptic('light');
          }}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus size={20} />
        </button>
        <button
          type="button"
          className="mapBtn"
          onClick={() => {
            mapRef.current?.zoomOut();
            triggerHaptic('light');
          }}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus size={20} />
        </button>
      </div>

      <div className="questOverlayBottom">
        <RadarHUD
          onDiscoverPress={() => setClueOpen(true)}
          onSelectAnotherTarget={() => setActiveTargetNode(null)}
        />
      </div>

      <ClueModal
        open={clueOpen}
        node={activeTargetNode}
        onClose={() => setClueOpen(false)}
      />
    </div>
  );
}