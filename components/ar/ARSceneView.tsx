'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { HuntCharacterType } from '../../types/hunt';
import type { CharacterAsset } from '../../services/characterAssets';
import {
  ARCanvasFrame,
  AR_VERTICAL_FOV_DEG,
  projectScenePointToScreen,
} from '../../utils/arPlacement';
import { createARCharacter, ARCharacterInstance } from './characters';
import { createARCharacterAsset } from './characterAssets';

/** Time constant (seconds) of the smoothing that removes sensor jitter. */
const MOTION_SMOOTHING_S = 0.13;
/** Minimum gap (ms) between hint-bubble anchor pushes to the overlay layer. */
const ANCHOR_PUBLISH_MS = 80;
/** Anchor movement (px) below which the bubble does not need to move. */
const ANCHOR_MOVE_EPSILON_PX = 2;
/**
 * Gap (px) between the model's head and the bottom of the hint bubble. Also
 * exported so the AR screen can reserve exactly this much headroom for it.
 */
export const AR_BUBBLE_TAIL_GAP = 16;
/** Widest hint bubble (px); shrunk further on narrow screens. */
const BUBBLE_MAX_WIDTH = 268;
/**
 * Bubble height (px) assumed until the first real measurement — exported so the
 * AR screen's headroom reservation starts from the same number this layer uses.
 */
export const AR_BUBBLE_FALLBACK_HEIGHT = 86;

interface ARSceneViewProps {
  characterType: HuntCharacterType;
  /** Optional validated manifest asset selected by the hunt creator. */
  characterAsset?: CharacterAsset | null;
  /** Framing computed by the parent AR screen (includes screen-space anchors). */
  frame: ARCanvasFrame;
  /** When false the GL loop idles (camera still shows underneath). */
  renderActive: boolean;
  /**
   * Text of the dialogue box over the character's head — the hint pointing at
   * it while hunting, or what it says once its key has been accepted.
   */
  hint?: string | null;
  /** Who is speaking, shown as the bubble's header. */
  speaker?: string | null;
  /**
   * Full header override, used once the character stops hinting at the player
   * and starts talking ("Zara — SPEAKING…").
   */
  label?: string | null;
  /** Rows appended under the bubble text — the revealed key + next hint. */
  bubbleExtra?: React.ReactNode;
  /**
   * Reports the head bubble's measured height in px (0 while it is hidden) so
   * the parent AR screen can keep that much space free above the character and
   * the bubble never has to be clamped down over the model.
   */
  onBubbleHeightChange?: (heightPx: number) => void;
  /** Accent colour for the bubble. */
  accent?: string;
  /** Reported when WebGL/three.js cannot run, so the HUD can adapt. */
  onRendererStateChange?: (available: boolean) => void;
}

/** Screen-space position of the model's head, in pixels. */
interface HeadAnchor {
  centerXPx: number;
  headYPx: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Transparent WebGL layer rendered on top of the live camera preview, plus the
 * dialogue box that hovers over the character's head — the web port of the
 * native `expo-gl` view, using a plain HTML canvas instead.
 *
 * The parent AR screen owns the framing maths (`computeARCanvasFrame`) so the
 * model and its hint bubble always agree on where the character is; this layer
 * only smooths the motion frame-to-frame and draws it.
 */
export const ARSceneView: React.FC<ARSceneViewProps> = ({
  characterType,
  characterAsset = null,
  frame,
  renderActive,
  hint,
  speaker,
  label,
  bubbleExtra,
  onBubbleHeightChange,
  accent = '#38bdf8',
  onRendererStateChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const frameRef = useRef(frame);
  frameRef.current = frame;
  const activeRef = useRef(renderActive);
  activeRef.current = renderActive;
  const typeRef = useRef(characterType);
  typeRef.current = characterType;
  /** Latest bubble-height reporter, so the ref callback never goes stale. */
  const onBubbleHeightRef = useRef(onBubbleHeightChange);
  onBubbleHeightRef.current = onBubbleHeightChange;

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const characterRef = useRef<ARCharacterInstance | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const frameFailuresRef = useRef(0);
  /** Smoothed scene transform, eased towards the framed target every frame. */
  const motionRef = useRef({ x: 0, y: 0, scale: 1, ready: false, lastTs: 0 });
  /** Last anchor pushed to the bubble, or null while the character is hidden. */
  const anchorRef = useRef<HeadAnchor | null>(null);
  const lastPublishRef = useRef(0);
  /** Head anchor of the smoothed model, mirrored into React for the bubble. */
  const [anchor, setAnchor] = useState<HeadAnchor | null>(null);
  /** Set when WebGL/three.js cannot run, so the AR screen can degrade gracefully. */
  const [initError, setInitError] = useState<string | null>(null);
  /** Turns true after the scene exists, allowing its async asset loader to run. */
  const [sceneReady, setSceneReady] = useState(false);

  // Replace procedural/custom instances as the creator's target changes. The
  // asset load is async, so a generation guard prevents a slower old load from
  // replacing a character the player has already advanced to.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !sceneReady) return;
    // The currently installed character is kept until its replacement is ready
    // (an asset load is async), so a slow connection never blanks the model.
    let cancelled = false;

    const install = (replacement: ARCharacterInstance) => {
      if (cancelled || sceneRef.current !== scene) {
        replacement.dispose();
        return;
      }
      const previous = characterRef.current;
      if (previous && previous !== replacement) {
        scene.remove(previous.group);
        previous.dispose();
      }
      scene.add(replacement.group);
      replacement.group.visible = false;
      characterRef.current = replacement;
      motionRef.current.ready = false;
    };

    if (characterAsset) {
      createARCharacterAsset(characterAsset)
        .then(install)
        .catch(loadError => {
          if (cancelled || sceneRef.current !== scene) return;
          console.warn(
            `Could not load camera character “${characterAsset.name}”; using its built-in fallback.`,
            loadError
          );
          install(createARCharacter(characterType));
        });
    } else {
      install(createARCharacter(characterType));
    }

    return () => {
      cancelled = true;
    };
  }, [sceneReady, characterType, characterAsset]);

  // --- Renderer + render loop ----------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    // three.js is pinned to 0.162.x for parity with the native build (see the
    // root README for the expo-gl rationale); on the web any WebGL1/2-capable
    // browser runs it fine.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch (err) {
      console.warn('AR scene: WebGL renderer unavailable —', err);
      setInitError(err instanceof Error ? err.message : 'WebGL renderer unavailable');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, true);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      AR_VERTICAL_FOV_DEG,
      width / Math.max(height, 1),
      0.1,
      400
    );
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);

    // Lighting rig — bright ambient keeps characters legible against daylight.
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.6);
    fillLight.position.set(-3, 1, -2);
    scene.add(fillLight);

    const character = createARCharacter(typeRef.current);
    scene.add(character.group);
    character.group.visible = false;

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    characterRef.current = character;
    startedAtRef.current = Date.now();
    setSceneReady(true);

    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      renderer.setSize(w, h, true);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      setInitError('WebGL context lost');
      onRendererStateChange?.(false);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    /** Pushes the head anchor to the bubble, throttled to keep React quiet. */
    const publishAnchor = (next: HeadAnchor | null, now: number) => {
      const prev = anchorRef.current;
      if (next === null) {
        if (prev !== null) {
          anchorRef.current = null;
          setAnchor(null);
        }
        return;
      }
      const isFirst = prev === null;
      if (!isFirst && now - lastPublishRef.current < ANCHOR_PUBLISH_MS) return;
      if (
        !isFirst &&
        Math.abs(prev.centerXPx - next.centerXPx) < ANCHOR_MOVE_EPSILON_PX &&
        Math.abs(prev.headYPx - next.headYPx) < ANCHOR_MOVE_EPSILON_PX
      ) {
        return;
      }
      anchorRef.current = next;
      lastPublishRef.current = now;
      setAnchor(next);
    };

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      try {
        const current = characterRef.current;
        const f = frameRef.current;
        const motion = motionRef.current;
        const now = Date.now();
        const shouldShow = activeRef.current && current !== null && f.visible;

        if (current && shouldShow) {
          const dt = Math.min(Math.max((now - motion.lastTs) / 1000, 0), 0.1);
          if (!motion.ready) {
            // First frame, or back after being hidden: snap instead of gliding.
            motion.x = f.position.x;
            motion.y = f.position.y;
            motion.scale = f.scale;
            motion.ready = true;
          } else {
            // Frame-rate independent easing removes compass/accelerometer jitter.
            const k = 1 - Math.exp(-dt / MOTION_SMOOTHING_S);
            motion.x += (f.position.x - motion.x) * k;
            motion.y += (f.position.y - motion.y) * k;
            motion.scale += (f.scale - motion.scale) * k;
          }
          motion.lastTs = now;

          current.group.position.set(motion.x, motion.y, f.position.z);
          current.group.scale.setScalar(motion.scale);
          current.group.visible = true;
          current.update((now - startedAtRef.current) / 1000);

          // Track the *smoothed* head so the hint bubble never lags the model.
          const w = container.clientWidth || window.innerWidth;
          const h = container.clientHeight || window.innerHeight;
          const head = projectScenePointToScreen(
            { x: motion.x, y: motion.y + motion.scale * current.naturalHeight, z: f.position.z },
            f.verticalFovDeg,
            f.horizontalFovDeg,
            w,
            h
          );
          publishAnchor({ centerXPx: head.x, headYPx: head.y }, now);
        } else {
          if (current) current.group.visible = false;
          motion.ready = false;
          publishAnchor(null, now);
        }

        renderer.render(scene, camera);
        frameFailuresRef.current = 0;
      } catch (err) {
        // Keep the loop alive across transient GL hiccups, but stop covering the
        // camera with a frozen overlay if rendering is permanently broken.
        console.warn('AR render loop error:', err);
        frameFailuresRef.current += 1;
        if (frameFailuresRef.current >= 3) {
          if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          publishAnchor(null, Date.now());
          setInitError(err instanceof Error ? err.message : 'WebGL render loop failed');
          onRendererStateChange?.(false);
          return;
        }
      }
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (characterRef.current) {
        characterRef.current.dispose();
        characterRef.current = null;
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
      sceneRef.current = null;
      cameraRef.current = null;
      setSceneReady(false);
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tell the parent AR screen when the 3D layer is dead, so it can adapt.
  useEffect(() => {
    if (initError) onRendererStateChange?.(false);
  }, [initError, onRendererStateChange]);

  /** Viewport size — the layer is fullscreen, so window size is the container. */
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [bubbleHeight, setBubbleHeight] = useState(AR_BUBBLE_FALLBACK_HEIGHT);
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** True while the head bubble is actually on screen. */
  const bubbleVisible = Boolean((hint || bubbleExtra) && anchor && viewport.width > 0);

  // Report the bubble's height to the AR screen so it can reserve that much
  // headroom above the character: the bubble is always drawn *above* the head,
  // so the model has to start below it. Declared before the WebGL-failure
  // branch below — hooks may not run conditionally.
  useEffect(() => {
    onBubbleHeightRef.current?.(bubbleVisible ? bubbleHeight : 0);
  }, [bubbleVisible, bubbleHeight]);

  // The clue lock-on works from GPS + orientation alone, so if the 3D overlay
  // cannot start the hunt stays completable — we just explain what happened.
  if (initError) {
    return (
      <div className="arFallback" role="status">
        <span className="arFallbackTitle">3D character overlay unavailable</span>
        <span className="arFallbackText">
          This browser would not start a WebGL renderer for the character models. Keep following
          the arrow and hold the reticle on the marker — the clue still unlocks by distance and
          direction.
        </span>
      </div>
    );
  }

  // Hint dialogue box, pinned *above* the (smoothed) model's head with its tail
  // pointing down at it. `bottom` is measured from the viewport bottom, so the
  // bubble's lower edge has to land `AR_BUBBLE_TAIL_GAP` above `headYPx` —
  // subtracting the bubble's height there (what this used to do) dropped the
  // whole box over the character's body instead. The AR screen reserves the
  // bubble's height above the model, so the clamps below only bite when that
  // headroom is genuinely unavailable.
  const bubbleWidth = Math.min(BUBBLE_MAX_WIDTH, Math.max(viewport.width - 24, 120));
  let bubble: React.ReactElement | null = null;
  if (bubbleVisible && anchor) {
    const left = clamp(
      anchor.centerXPx - bubbleWidth / 2,
      12,
      Math.max(viewport.width - 12 - bubbleWidth, 12)
    );
    // Keep it on screen: top edge >= 8px from the top, bottom edge >= 12px up.
    const maxBottom = Math.max(viewport.height - 8 - bubbleHeight, 12);
    const bottom = clamp(viewport.height - anchor.headYPx + AR_BUBBLE_TAIL_GAP, 12, maxBottom);
    const tailLeft = clamp(anchor.centerXPx - left - 8, 14, Math.max(bubbleWidth - 30, 14));

    bubble = (
      <div
        className="arBubble"
        style={{ left, bottom, width: bubbleWidth }}
        aria-live="polite"
        ref={el => {
          if (!el) return;
          const measured = Math.round(el.getBoundingClientRect().height);
          setBubbleHeight(previous => (Math.abs(previous - measured) > 1 ? measured : previous));
        }}
      >
        <div className="arBubbleHeader">
          <span className="arBubbleDot" style={{ background: accent }} />
          <span className="arBubbleSpeaker" style={{ color: accent }}>
            {label ?? (speaker ? `${speaker} — HINT` : 'HINT TO THIS CHARACTER')}
          </span>
        </div>
        {hint && <p className="arBubbleText">{hint}</p>}
        {bubbleExtra}
        <span className="arBubbleTail" style={{ left: tailLeft }} />
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />
      {bubble}
    </>
  );
};
