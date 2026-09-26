import { LocationCoordinates } from '../types/game';

/**
 * Geo-AR placement math.
 *
 * Maps a geolocated character onto screen coordinates by comparing:
 *  - the compass bearing/elevation to the character (from GPS), against
 *  - where the phone camera is pointing (heading + pitch from sensors).
 *
 * The vertical FOV is a fixed estimate for a typical phone main camera in
 * portrait (~65°); the horizontal FOV is derived from the screen aspect so
 * the math matches three.js' PerspectiveCamera projection exactly.
 */
export const AR_VERTICAL_FOV_DEG = 65;
/** Characters beyond this distance render as a direction indicator only. */
export const AR_MAX_RENDER_DISTANCE_M = 150;
/** Average eye height used for elevation calculations. */
export const AR_EYE_HEIGHT_M = 1.6;
/** Aim cone (degrees) that must be met to lock onto the character. */
export const AR_AIM_CONE_DEG = 14;
/** Vertical aim cone (degrees). */
export const AR_TILT_CONE_DEG = 18;
/** Fixed scene depth (units) in front of the camera the model is drawn at. */
export const AR_SCENE_DEPTH = 12;
/** Smallest share of the viewport height the model may occupy (distance floor). */
export const AR_MIN_APPARENT_FRACTION = 0.1;
/** Largest share of the viewport height the model may occupy (close-range cap). */
export const AR_MAX_APPARENT_FRACTION = 0.46;
/** Model width ≈ height × this, used to keep it inside the screen edges. */
export const AR_MODEL_ASPECT = 0.62;
/**
 * Share of the frame an identified character is given. Once the player has the
 * character on screen it stops being anchored to the live GPS/compass solution
 * and is framed deliberately instead — see `ARFrameOptions.identified`.
 */
export const AR_IDENTIFIED_FRAME_FRACTION = 0.8;
/** Gap (px) kept between the model and the screen edges. */
export const AR_SCREEN_MARGIN_PX = 14;
/**
 * How far past a screen edge the model's centre may drift before it is hidden.
 * Kept tight horizontally (turning away should hide it, not pin it to the edge)
 * and loose vertically (tilting away leaves the model on screen longer).
 */
export const AR_OFFSCREEN_TOLERANCE_X = 0.06;
export const AR_OFFSCREEN_TOLERANCE_Y = 0.3;

export interface ARPlacementInput {
  userLocation: LocationCoordinates;
  target: {
    latitude: number;
    longitude: number;
    altitudeMeters: number;
  };
  /** Compass heading in degrees (0 = north). */
  headingDeg: number;
  /** Camera pitch in radians (0 = horizon, +π/2 = sky). */
  pitchRad: number;
  screenW: number;
  screenH: number;
}

export interface ARPlacement {
  /** Ground distance to the character in meters. */
  distanceMeters: number;
  /** Signed angle left/right of camera centre in degrees (-180..180). */
  relativeAzimuthDeg: number;
  /** Character elevation above the horizon in degrees. */
  elevationDeg: number;
  /** Elevation minus phone pitch: positive = above screen centre. */
  verticalDeltaDeg: number;
  /** Normalised screen position, 0..1 (may fall outside when off-screen). */
  xRatio: number;
  yRatio: number;
  /** Full horizontal FOV in degrees, derived from the screen aspect. */
  horizontalFovDeg: number;
  /** Full vertical FOV in degrees (`AR_VERTICAL_FOV_DEG`). */
  verticalFovDeg: number;
  isInView: boolean;
  isWithinAimCone: boolean;
  /**
   * Strict test for "the geolocation anchor is inside the camera frustum and
   * within AR_MAX_RENDER_DISTANCE_M". The AR view renders from
   * `computeARCanvasFrame().visible` instead, which also keeps a partly
   * off-screen character on screen.
   */
  shouldRender: boolean;
  /** Direction to turn: negative = turn left, positive = turn right. */
  turnDeltaDeg: number;
  /** Positive = tilt up, negative = tilt down (degrees). */
  tiltDeltaDeg: number;
}

function normalizeDeg(deg: number): number {
  return ((deg + 540) % 360) - 180;
}

export function computeARPlacement(input: ARPlacementInput): ARPlacement {
  const { userLocation, target, headingDeg, pitchRad, screenW, screenH } = input;

  // --- Distance & bearing (ground plane) ----------------------------------
  const dLatM = (target.latitude - userLocation.latitude) * 111320;
  const dLonM =
    (target.longitude - userLocation.longitude) *
    111320 *
    Math.cos((userLocation.latitude * Math.PI) / 180);
  const distanceMeters = Math.sqrt(dLatM * dLatM + dLonM * dLonM);

  const lat1 = (userLocation.latitude * Math.PI) / 180;
  const lat2 = (target.latitude * Math.PI) / 180;
  const dLon = ((target.longitude - userLocation.longitude) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearingDeg = (Math.atan2(y, x) * 180) / Math.PI;

  const relativeAzimuthDeg = normalizeDeg(bearingDeg - headingDeg);

  // --- Elevation of the character (accounts for air placement) ------------
  const heightAboveEye =
    Math.max(target.altitudeMeters, -AR_EYE_HEIGHT_M + 0.2) - AR_EYE_HEIGHT_M;
  const elevationRad = Math.atan2(heightAboveEye, Math.max(distanceMeters, 0.5));
  const elevationDeg = (elevationRad * 180) / Math.PI;
  const verticalDeltaDeg = elevationDeg - (pitchRad * 180) / Math.PI;

  // --- Screen mapping (mirrors three.js PerspectiveCamera) ----------------
  const aspect = screenH > 0 ? screenW / screenH : 0.5;
  const verticalFovDeg = AR_VERTICAL_FOV_DEG;
  const halfVFov = (verticalFovDeg * Math.PI) / 360;
  const halfHFov = Math.atan(Math.tan(halfVFov) * aspect);
  // Full horizontal FOV — `halfHFov` is the camera's true horizontal half-angle,
  // and it is what every screen<->scene conversion below must use.
  const horizontalFovDeg = (halfHFov * 360) / Math.PI;

  const relAzRad = (relativeAzimuthDeg * Math.PI) / 180;
  const dElRad = (verticalDeltaDeg * Math.PI) / 180;

  const xRatio = 0.5 + Math.tan(relAzRad) / (2 * Math.tan(halfHFov));
  const yRatio = 0.5 - Math.tan(dElRad) / (2 * Math.tan(halfVFov));

  const inHorizontal = Math.abs(relativeAzimuthDeg) <= horizontalFovDeg / 2;
  const inVertical = Math.abs(verticalDeltaDeg) <= verticalFovDeg / 2;
  const isInView = inHorizontal && inVertical;

  const isWithinAimCone =
    Math.abs(relativeAzimuthDeg) <= AR_AIM_CONE_DEG &&
    Math.abs(verticalDeltaDeg) <= AR_TILT_CONE_DEG;

  const shouldRender = isInView && distanceMeters <= AR_MAX_RENDER_DISTANCE_M;

  return {
    distanceMeters,
    relativeAzimuthDeg,
    elevationDeg,
    verticalDeltaDeg,
    xRatio,
    yRatio,
    horizontalFovDeg,
    verticalFovDeg,
    isInView,
    isWithinAimCone,
    shouldRender,
    turnDeltaDeg: relativeAzimuthDeg,
    tiltDeltaDeg: verticalDeltaDeg,
  };
}

/**
 * Scene-space transform for the character model inside a three.js scene with
 * a camera at the origin looking down -Z. Depth is fixed; x/y reproduce the
 * angular offset so the model lands exactly where computeARPlacement says.
 */
export function placementToScenePosition(
  placement: ARPlacement,
  depth: number
): { x: number; y: number; z: number } {
  const relAz = (placement.relativeAzimuthDeg * Math.PI) / 180;
  const dEl = (placement.verticalDeltaDeg * Math.PI) / 180;

  return {
    x: depth * Math.tan(relAz),
    y: depth * Math.tan(dEl),
    z: -depth,
  };
}

/** Screen-space projection of a scene point (inverse of the mapping above). */
export function projectScenePointToScreen(
  point: { x: number; y: number; z: number },
  verticalFovDeg: number,
  horizontalFovDeg: number,
  screenW: number,
  screenH: number
): { x: number; y: number } {
  const depth = Math.max(Math.abs(point.z), 0.001);
  const halfVFov = (verticalFovDeg * Math.PI) / 360;
  const halfHFov = (horizontalFovDeg * Math.PI) / 360;

  return {
    x: screenW * (0.5 + point.x / depth / (2 * Math.tan(halfHFov))),
    y: screenH * (0.5 - point.y / depth / (2 * Math.tan(halfVFov))),
  };
}

/** Model metrics needed for perspective-correct framing. */
export interface ARCharacterSizing {
  /** Model height in scene units. */
  naturalHeight: number;
  /** Real-world height in metres the model stands for. */
  realHeightM: number;
  /** Width divided by height. Custom roster assets may override the default. */
  aspectRatio?: number;
}

export interface ARFrameOptions {
  /**
   * True once the player has identified this character on screen.
   *
   * Before that, the model tracks the live GPS/compass solution and appears at
   * its true distance. Afterwards it is pinned to the middle of the free band
   * and sized from `AR_IDENTIFIED_FRAME_FRACTION` of the frame, because a solved
   * position inherits every metre of GPS error and every degree of compass wobble
   * — which reads as the model shaking, and its distance-derived size breathing.
   * Pinning also keeps it steady while the player types the key.
   */
  identified?: boolean;
}

/** The region of the screen the model is allowed to occupy (pixels). */
export interface ARViewportBox {
  widthPx: number;
  heightPx: number;
  /** Top edge of the usable area — below the top HUD (and the hint bubble). */
  safeTopPx: number;
  /** Bottom edge of the usable area — above the clue chips/HUD. */
  safeBottomPx: number;
}

/** Where the model lands on screen (pixels) — used to anchor HTML/RN overlays. */
export interface ARCharacterScreenFrame {
  /** Horizontal centre of the model. */
  centerXPx: number;
  /** Top of the model — where the hint bubble's tail points. */
  headYPx: number;
  /** Bottom of the model (its feet / hover base). */
  baseYPx: number;
  heightPx: number;
  widthPx: number;
  visible: boolean;
  /** True when the model was nudged off its exact geolocation to stay visible. */
  nudged: boolean;
}

/** Everything the 3D layer and the screen-space overlays need for one frame. */
export interface ARCanvasFrame {
  /** Scene-space anchor of the model's base (the camera sits at the origin). */
  position: { x: number; y: number; z: number };
  scale: number;
  /** Height of the scaled model in scene units. */
  worldHeight: number;
  visible: boolean;
  /** Camera FOVs used, so overlays can project scene points identically. */
  verticalFovDeg: number;
  horizontalFovDeg: number;
  screen: ARCharacterScreenFrame;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Places the character for one rendered frame.
 *
 * The model starts out anchored at its true geolocation (feet, or hover base for
 * the floating archetypes) and is only moved when that would take it off screen:
 *  - its apparent size stays inside a readable band — never a speck at range,
 *    never larger than the free space on screen up close,
 *  - it is lifted/dropped so the whole model stays inside the safe area (between
 *    the top HUD and the clue chips) instead of sinking off the bottom edge,
 *  - it is pulled sideways so it never overhangs the left/right edges.
 *
 * `screen` reports the same box to the overlay layer, so the hint bubble can be
 * pinned to the model's head.
 */
export function computeARCanvasFrame(
  placement: ARPlacement,
  sizing: ARCharacterSizing,
  viewport: ARViewportBox,
  depth: number = AR_SCENE_DEPTH,
  options: ARFrameOptions = {}
): ARCanvasFrame {
  const halfVFov = (placement.verticalFovDeg * Math.PI) / 360;
  const halfHFov = (placement.horizontalFovDeg * Math.PI) / 360;
  const heightAtDepth = 2 * depth * Math.tan(halfVFov);
  const widthAtDepth = 2 * depth * Math.tan(halfHFov);

  const safeTop = clamp(viewport.safeTopPx, 0, viewport.heightPx);
  const safeBottom = clamp(viewport.safeBottomPx, safeTop, viewport.heightPx);
  const bandHeight = Math.max(safeBottom - safeTop, 1);

  // --- Identified: pin the character to a stable, deliberate frame ----------
  // Once the player has the character on screen the model is no longer tracking
  // GPS/compass. That matters: a solved position inherits every metre of GPS
  // error and every degree of compass wobble, which reads as the model shaking
  // and its distance-derived size breathing. A pinned frame is identical on
  // every frame, so it is rock steady while the player types the key.
  if (options.identified) {
    const aspect = Math.max(sizing.aspectRatio ?? AR_MODEL_ASPECT, 0.1);
    // Fill the requested share of the band, but never so wide that it overhangs
    // the left/right edges (a wide winged model on a narrow phone).
    const heightPx = Math.min(
      bandHeight * AR_IDENTIFIED_FRAME_FRACTION,
      Math.max((viewport.widthPx - 2 * AR_SCREEN_MARGIN_PX) / aspect, 1)
    );
    const widthPx = heightPx * aspect;
    const worldHeight = (heightPx / viewport.heightPx) * heightAtDepth;
    // Centred in the band, so it is never partially behind the HUD or bubble.
    const centerXPx = viewport.widthPx / 2;
    const headYPx = safeTop + (bandHeight - heightPx) / 2;

    return {
      position: {
        x: widthAtDepth * (centerXPx / viewport.widthPx - 0.5),
        y: heightAtDepth * (0.5 - headYPx / viewport.heightPx) - worldHeight,
        z: -depth,
      },
      scale: worldHeight / Math.max(sizing.naturalHeight, 0.001),
      worldHeight,
      visible: true,
      verticalFovDeg: placement.verticalFovDeg,
      horizontalFovDeg: placement.horizontalFovDeg,
      screen: {
        centerXPx,
        headYPx,
        baseYPx: headYPx + heightPx,
        heightPx,
        widthPx,
        visible: true,
        nudged: true,
      },
    };
  }

  // --- Apparent size: what the geometry gives vs. what stays readable ------
  const naturalHeightPx =
    ((depth * sizing.realHeightM) / Math.max(placement.distanceMeters, 1.2) / heightAtDepth) *
    viewport.heightPx;
  const aspectRatio = Math.max(sizing.aspectRatio ?? AR_MODEL_ASPECT, 0.1);
  const maxHeightPx = Math.min(
    viewport.heightPx * AR_MAX_APPARENT_FRACTION,
    bandHeight * 0.92,
    Math.max((viewport.widthPx - 2 * AR_SCREEN_MARGIN_PX) / aspectRatio, 1)
  );
  const minHeightPx = Math.min(viewport.heightPx * AR_MIN_APPARENT_FRACTION, maxHeightPx);
  const heightPx = clamp(naturalHeightPx, minHeightPx, maxHeightPx);
  const widthPx = heightPx * aspectRatio;
  const worldHeight = (heightPx / viewport.heightPx) * heightAtDepth;

  // --- Where the geo maths alone would put it ------------------------------
  const anchor = placementToScenePosition(placement, depth);
  const idealCenterXPx = viewport.widthPx * (0.5 + anchor.x / widthAtDepth);
  const idealBaseYPx = viewport.heightPx * (0.5 - anchor.y / heightAtDepth);
  const idealHeadYPx = idealBaseYPx - heightPx;
  const idealCenterYPx = idealBaseYPx - heightPx / 2;

  const toleranceX = viewport.widthPx * AR_OFFSCREEN_TOLERANCE_X;
  const toleranceY = viewport.heightPx * AR_OFFSCREEN_TOLERANCE_Y;
  const nearScreen =
    idealCenterXPx > -toleranceX &&
    idealCenterXPx < viewport.widthPx + toleranceX &&
    idealCenterYPx > -toleranceY &&
    idealCenterYPx < viewport.heightPx + toleranceY;
  const visible = nearScreen && placement.distanceMeters <= AR_MAX_RENDER_DISTANCE_M;

  // --- Nudge it back into the safe area (only while it is on screen) -------
  let headYPx = idealHeadYPx;
  let centerXPx = idealCenterXPx;
  if (visible) {
    const lowestHeadY = Math.max(safeBottom - heightPx, safeTop);
    headYPx = clamp(idealHeadYPx, safeTop, lowestHeadY);
    const halfWidth = widthPx / 2;
    centerXPx = clamp(
      idealCenterXPx,
      Math.min(halfWidth + AR_SCREEN_MARGIN_PX, viewport.widthPx / 2),
      Math.max(viewport.widthPx - halfWidth - AR_SCREEN_MARGIN_PX, viewport.widthPx / 2)
    );
  }

  return {
    position: {
      x: widthAtDepth * (centerXPx / viewport.widthPx - 0.5),
      y: heightAtDepth * (0.5 - headYPx / viewport.heightPx) - worldHeight,
      z: -depth,
    },
    scale: worldHeight / Math.max(sizing.naturalHeight, 0.001),
    worldHeight,
    visible,
    verticalFovDeg: placement.verticalFovDeg,
    horizontalFovDeg: placement.horizontalFovDeg,
    screen: {
      centerXPx,
      headYPx,
      baseYPx: headYPx + heightPx,
      heightPx,
      widthPx,
      visible,
      nudged:
        Math.abs(headYPx - idealHeadYPx) > 0.5 || Math.abs(centerXPx - idealCenterXPx) > 0.5,
    },
  };
}

