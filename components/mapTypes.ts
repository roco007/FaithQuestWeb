import type { ChurchNode } from '../types/node';
import type { LocationCoordinates } from '../types/game';
import type { HuntCharacterType } from '../types/hunt';

/**
 * Map component contracts shared by every provider.
 *
 * Both the Google and Leaflet implementations satisfy these types, which is
 * what lets `GameMap` / `CharacterPinMap` stay stable dispatchers: consumers
 * (e.g. `app/page.tsx`) import these and never learn which provider rendered.
 */

/** Map viewport options, equivalent to the native `initialRegion` deltas. */
export interface MapViewport {
  latitude: number;
  longitude: number;
  /** Zoom level; ~16 shows roughly the same span as the native 0.0035 delta. */
  zoom?: number;
}

export interface GameMapProps {
  nodes: ChurchNode[];
  userLocation: LocationCoordinates | null;
  activeTargetNode: ChurchNode | null;
  completedNodeIds: string[];
  initialView: MapViewport;
  onSelectNode?: (node: ChurchNode) => void;
  /** Continuously pans the map to follow the player's live position. */
  followUser?: boolean;
}

export interface GameMapRef {
  centerOn: (view: MapViewport, animate?: boolean) => void;
  /**
   * Zoom controls are rendered by the app (in `.questSideControls`) rather than
   * by the map library's built-in corners: on phone-width viewports the quest
   * HUD cards (`.xpCard` / `.hudCard`) overlay the map's top-left and
   * bottom-right corners, so the built-in controls were rendered underneath
   * them — visible only as slivers and untappable (the overlay intercepted the
   * pointer events). The side rail sits clear of both cards.
   */
  zoomIn: () => void;
  zoomOut: () => void;
}

export interface CharacterPinMapProps {
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
 * Props every provider accepts so a failure can hand control back to the
 * dispatcher, which then renders the fallback provider instead.
 */
export interface MapProviderProps {
  /** Called when the provider cannot start, so the host can fall back. */
  onProviderError?: () => void;
}