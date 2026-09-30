'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Navigation2,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Radar,
  Camera,
  KeyRound,
  Sparkles,
  Volume2,
  ListChecks,
} from 'lucide-react';
import { useHunt, DiscoverResult, assertPresentedKey } from '../context/HuntContext';
import { useGame } from '../context/GameContext';
import { useDeviceOrientation } from '../hooks/useDeviceOrientation';
import {
  computeARPlacement,
  computeARCanvasFrame,
  ARPlacement,
  AR_SCENE_DEPTH,
  ARViewportBox,
} from '../utils/arPlacement';
import {
  ARSceneView,
  AR_BUBBLE_FALLBACK_HEIGHT,
  AR_BUBBLE_TAIL_GAP,
  AR_BANNER_CARD_FALLBACK_HEIGHT,
  AR_CARD_GAP,
  AR_COMBINED_CARD_FALLBACK_HEIGHT,
} from './ar/ARSceneView';
import { getHuntCharacterMeta, getHuntCharacterSizing } from './ar/characters';
import type { CharacterAsset } from '../services/characterAssets';
import { getCharacterAssetSizing, loadCharacterAssets } from '../services/characterAssets';
import type { SponsorBanner } from '../services/sponsorBanners';
import { loadSponsorBanners } from '../services/sponsorBanners';
import { KeyInHand } from './KeyInHand';
import { LocationStatus } from './LocationStatus';
import { formatDistance } from '../utils/geo';
import { triggerHaptic, playSoundEffect } from '../utils/sound';
import { speakClue, stopSpeaking } from '../utils/speech';
import { isQuestionCorrect } from '../utils/huntQuestions';

/** Milliseconds the player must hold aim + range before the character is sighted. */
const LOCK_ON_MS = 900;
/**
 * Screen space reserved for the HUD when framing the character, so the model
 * never hides behind the top bar/guidance banner or the bottom hint/chips (and
 * the always-on key-in-hand chip that rides above them). Mirrors the native
 * `app/hunt/ar.tsx` reserves.
 */
const TOP_HUD_RESERVE_PX = 104;
const BOTTOM_HUD_RESERVE_PX = 128;
/** Extra bottom reserve while the key form is docked over the frame. */
const KEY_PANEL_RESERVE_PX = 208;
/** Extra bottom reserve while the reveal-question panel is docked over the frame. */
const QUIZ_PANEL_RESERVE_PX = 340;
/**
 * Smallest share of the viewport height the character keeps for itself. The
 * head-bubble reserve is capped by it, so a very tall bubble on a short screen
 * docks into the HUD instead of shrinking the model away to nothing.
 */
const MIN_MODEL_BAND_FRACTION = 0.18;

interface HuntARCameraProps {
  /** Mounts the fullscreen camera experience while true. */
  open: boolean;
  /** User backed out — a pending key entry is dropped and re-earned on reopen. */
  onClose: () => void;
  /**
   * Fires when the player dismisses a finished reveal. The caller uses a final
   * discovery to close the camera and celebrate the hunt; the camera itself
   * moves straight on to the next stop otherwise.
   */
  onDiscoveryComplete?: (result: DiscoverResult) => void;
}

type CameraState = 'starting' | 'active' | 'error';

/**
 * The discovery loop, every step of it on the camera frame:
 *  - `hunting`:   walk inside the radius and hold the reticle on the location's
 *                 character (the radar and the handed-over clue point the way);
 *  - `key`:       the sighted character stays on screen while the player presents
 *                 this location's key — handed over one stop early, so it is
 *                 already in hand — and nothing advances until it matches;
 *  - `quiz`:      the key matched, but a location with questions demands them
 *                 first — every question must be answered before anything
 *                 reveals, and the discovery is recorded only once they pass;
 *  - `reveal`:    the key was presented and any question gate passed: the
 *                 character's message and video, then the hand-over of the NEXT
 *                 location's clue, character and key (text + voice) until the
 *                 player continues. On the treasure there is no hand-over — the
 *                 congratulations await instead.
 */
type ARPhase = 'hunting' | 'key' | 'quiz' | 'reveal';

/** Spells a key out for the voice clue ("K7M2QX" → "K 7 M 2 Q X"). */
function spellKey(key: string): string {
  return key
    .split('')
    .map(ch => (ch === '-' ? 'dash' : ch))
    .join(' ');
}

/**
 * What the character says once the right key is presented: its dialogue, the
 * key it hands over, and the hint for whoever comes next. The native build
 * spoke the dialogue (plus the end announcement on the final find); the web
 * port reads the hand-off aloud too, so the player never has to stare at the
 * screen to catch the next key.
 */
function buildSpeech(result: DiscoverResult): string {
  if (result.isFinal) {
    return `${result.character.dialogue} ${result.game.endAnnouncement}`.trim();
  }
  return [
    result.character.dialogue,
    result.nextCharacter?.name ? `Your next location: ${result.nextCharacter.name}.` : '',
    result.nextCharacter?.key ? `Your next key is ${spellKey(result.nextCharacter.key)}.` : '',
    result.nextCharacter?.hint ? `Your next clue: ${result.nextCharacter.hint}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The character's hand-off, shown inside the speech bubble over its head (and
 * docked into the bottom HUD when WebGL cannot draw the character at all).
 */
function RevealDetails({ result }: { result: DiscoverResult }) {
  const next = result.nextCharacter;
  return (
    <div className="arBubbleExtra">
      {next?.name && (
        <div className="arBubbleMeta">
          <span className="arBubbleMetaLabel">Next location</span>
          <p className="arBubbleMetaText">{next.name}</p>
        </div>
      )}
      {next?.key && (
        <div className="arBubbleKeyRow">
          <span className="arBubbleMetaLabel">Key received</span>
          <span className="keyChip mono">{next.key}</span>
        </div>
      )}
      {next?.hint && (
        <div className="arBubbleMeta">
          <span className="arBubbleMetaLabel">Hint for your next location</span>
          <p className="arBubbleMetaText">{next.hint}</p>
        </div>
      )}
      {result.isFinal && (
        <div className="arBubbleMeta">
          <span className="arBubbleMetaLabel">Hunt complete</span>
          <p className="arBubbleMetaText">{result.game.endAnnouncement}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Fullscreen geo-AR view for the web hunt: the live rear-camera feed with the
 * animated 3D character composited at its geolocation, a focus reticle, and
 * off-screen direction guidance — the web port of `app/hunt/ar.tsx`.
 *
 * Discovery flow (every step of it on the frame, see `ARPhase`): hold the
 * reticle on the character while inside its radius, present this location's key
 * in the docked form — handed over one stop early, so the team already holds it
 * — pass the location's reveal questions when it has any, and only then the
 * character answers in text + voice with the hand-over for the stop ahead:
 * the next location's clue, character and key. Only a matching key and a passed
 * question gate advance the hunt — until then the character simply stays in
 * view. On the treasure there is no hand-over: the congratulations wait instead.
 */
export function HuntARCamera({ open, onClose, onDiscoveryComplete }: HuntARCameraProps) {
  const { currentCharacter, discoverCurrentCharacter } = useHunt();
  const { userLocation } = useGame();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** Holds the live camera stream so it can be stopped on close/unmount. */
  const streamRef = useRef<MediaStream | null>(null);
  const sightedRef = useRef(false);

  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lockRatio, setLockRatio] = useState(0);
  const [isLocking, setIsLocking] = useState(false);
  /** False once the WebGL layer reports it cannot run (hint docks to the bar). */
  const [rendererAvailable, setRendererAvailable] = useState(true);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  /** Where the player is in the discovery loop (see `ARPhase`). */
  const [phase, setPhase] = useState<ARPhase>('hunting');
  /** Key presented in the docked form during the `key` phase. */
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  /** Index of the question on screen during the `quiz` phase. */
  const [quizIndex, setQuizIndex] = useState(0);
  /** Selected option (MCQ) for the current question. */
  const [quizChoice, setQuizChoice] = useState<string | null>(null);
  /** Typed answer for the current short-answer question. */
  const [quizText, setQuizText] = useState('');
  /** Why the last submission failed — shown under the current question. */
  const [quizError, setQuizError] = useState<string | null>(null);
  /** True while the final pass is being recorded (discovery in flight). */
  const [quizChecking, setQuizChecking] = useState(false);
  /** Set once the right key is presented — drives the speech over the head. */
  const [reveal, setReveal] = useState<DiscoverResult | null>(null);
  /** Deployment-owned roster resolved from the selected character's asset ID. */
  const [characterAssets, setCharacterAssets] = useState<CharacterAsset[]>([]);
  /** True while the reveal is being read aloud (drives the replay button). */
  const [speaking, setSpeaking] = useState(false);
  /** Bumped each time the reveal voiceover (re)starts, to cue media assets. */
  const [voiceCue, setVoiceCue] = useState(0);
  /**
   * Height of the on-screen keyboard covering the docked key form. Mobile
   * browsers shrink the *visual* viewport without resizing the layout one, so
   * the fixed HUD would otherwise sit under the keyboard while typing.
   */
  const [keyboardInset, setKeyboardInset] = useState(0);
  /**
   * Height of the last dialogue drawn over the character's head — the hint
   * bubble, or the sponsor card when a banner owns that slot (0 until the
   * first one is measured). Deliberately kept while no dialogue is up, so the
   * framing cannot oscillate between "dialogue fits" and "dialogue docked".
   */
  const [topDialogueHeightPx, setTopDialogueHeightPx] = useState(0);
  /** Deployment-owned sponsor roster resolved from the marketing manifest. */
  const [sponsorBanners, setSponsorBanners] = useState<SponsorBanner[]>([]);

  /**
   * The bubble/card report their own height as they render. Only non-zero
   * readings are stored: a hidden dialogue must not wipe the estimate, or one
   * that needs the bottom dock would flicker back over the character on every
   * frame.
   */
  const handleBubbleHeightChange = useCallback((heightPx: number) => {
    if (heightPx > 0) setTopDialogueHeightPx(heightPx);
  }, []);

  // Track the viewport — framing maths and the canvas both use window pixels.
  useEffect(() => {
    if (!open) return;
    const onResize = () => setDims({ width: window.innerWidth, height: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  /**
   * The character the frame is locked to. Once a reveal starts the hunt has
   * already advanced to the next stop, so the view keeps framing the
   * character that was just unlocked — that is what stops the discovered
   * character from vanishing the moment its key is accepted.
   */
  const activeCharacter = reveal?.character ?? currentCharacter;

  // Resolve only the manifest ID saved with the hunt. Keeping paths in the
  // manifest means a pasted/shared hunt can never make the camera fetch an
  // arbitrary remote URL. A missing/deployment-removed entry uses the built-in
  // character and therefore keeps the hunt playable. A failure leaves the last
  // good roster in place rather than blanking characters already on screen.
  useEffect(() => {
    if (!activeCharacter?.characterAssetId) return;
    let mounted = true;
    loadCharacterAssets()
      .then(assets => {
        if (mounted) setCharacterAssets(assets);
      })
      .catch(loadError => {
        console.warn('Could not load the selected camera character:', loadError);
      });
    return () => {
      mounted = false;
    };
  }, [activeCharacter?.characterAssetId]);

  const characterAsset = useMemo(
    () =>
      characterAssets.find(asset => asset.id === activeCharacter?.characterAssetId) ?? null,
    [activeCharacter?.characterAssetId, characterAssets]
  );
  /**
   * A cutout-video roster character speaks through its own clip: it carries the
   * reveal audio, so the TTS voiceover stands down and the video's track plays
   * instead.
   */
  const videoCharacterVoice = characterAsset?.kind === 'video';

  /**
   * Who the reveal is credited to in the speech bubble. A location's name is the
   * *place*, so it captions the bubble rather than speaking for it: the roster
   * entry's own name is used whenever the character has one, and the location
   * name is only the fallback.
   */
  const revealSpeaker = characterAsset?.name ?? reveal?.character.name ?? null;

  const renderCharacterType = characterAsset?.fallbackType ?? activeCharacter?.characterType;

  // Sponsor banners are deployment-owned like the character roster: resolved
  // from the manifest ID only, so a shared hunt can never inject a URL. A
  // missing/failed roster simply leaves the standard bubble layout in place
  // rather than breaking the hunt.
  useEffect(() => {
    let mounted = true;
    loadSponsorBanners()
      .then(banners => {
        if (mounted) setSponsorBanners(banners);
      })
      .catch(loadError => {
        console.warn('Could not load sponsor banners:', loadError);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const sponsorBanner = useMemo(
    () => sponsorBanners.find(banner => banner.id === activeCharacter?.sponsorBannerId) ?? null,
    [sponsorBanners, activeCharacter]
  );

  const target = useMemo(() => {
    if (!activeCharacter) return null;
    return {
      latitude: activeCharacter.latitude,
      longitude: activeCharacter.longitude,
      altitudeMeters: activeCharacter.altitudeMeters,
    };
  }, [activeCharacter]);

  // Listeners stay cheap while closed; the target is nulled so auto-aim idles.
  const orientation = useDeviceOrientation(open ? target : null);

  const placement = useMemo<ARPlacement | null>(() => {
    if (!open || !userLocation || !target || orientation.heading === null || dims.width === 0) {
      return null;
    }
    // Every stop is geo-anchored on its own authored coordinates: whatever the
    // radar pointed at while walking is exactly what the camera frames here.
    return computeARPlacement({
      userLocation,
      target,
      headingDeg: orientation.heading,
      pitchRad: orientation.pitch,
      screenW: dims.width,
      screenH: dims.height,
    });
  }, [
    open,
    userLocation,
    target,
    orientation.heading,
    orientation.pitch,
    dims.width,
    dims.height,
  ]);

  const characterSizing = useMemo(() => {
    if (!activeCharacter) return null;
    return characterAsset
      ? getCharacterAssetSizing(characterAsset)
      : getHuntCharacterSizing(renderCharacterType ?? activeCharacter.characterType);
  }, [activeCharacter, characterAsset, renderCharacterType]);
  const characterMeta = useMemo(() => {
    if (!activeCharacter) return null;
    const fallbackType = renderCharacterType ?? activeCharacter.characterType;
    const meta = getHuntCharacterMeta(fallbackType);
    return characterAsset ? { ...meta, accent: characterAsset.accent } : meta;
  }, [activeCharacter, characterAsset, renderCharacterType]);

  /** Top of the usable area: clear of the top bar and the guidance banner. */
  const hudSafeTopPx = 16 + TOP_HUD_RESERVE_PX;
  /** Bottom of the usable area: above the docked hint/chips (and key form). */
  const hudSafeBottomPx = Math.max(
    dims.height -
      (phase === 'key'
        ? KEY_PANEL_RESERVE_PX
        : phase === 'quiz'
          ? QUIZ_PANEL_RESERVE_PX
          : BOTTOM_HUD_RESERVE_PX),
    hudSafeTopPx
  );
  /** What may be given to the dialogue while the model keeps a usable band. */
  const availableHeadroomPx = Math.max(
    hudSafeBottomPx - hudSafeTopPx - dims.height * MIN_MODEL_BAND_FRACTION,
    0
  );
  /** The clue pointing at the character, or its hand-off once the key matched. */
  const wantsHeadBubble =
    cameraState === 'active' &&
    activeCharacter !== null &&
    (phase === 'hunting' ? Boolean(activeCharacter.hint) : phase === 'reveal');
  /**
   * A selected banner takes over the slot above the character in every phase:
   * the banner alone before the key is entered (hunting + key entry), the
   * banner + hint card after it (reveal). The slot's occupants are mutually
   * exclusive, so the sponsor card and the plain bubble never compete for
   * headroom — and pre-key the card needs space even without a hint.
   */
  const bannerCardWanted =
    sponsorBanner !== null &&
    cameraState === 'active' &&
    activeCharacter !== null &&
    (phase === 'hunting' ||
      phase === 'key' ||
      phase === 'quiz' ||
      phase === 'reveal');
  const wantsTopDialogue = bannerCardWanted || (sponsorBanner === null && wantsHeadBubble);
  /**
   * Headroom kept free above the character for whatever occupies the slot.
   * The dialogue hangs *above* the head, so without this the model would sit
   * behind it — or the box would be clamped down over the model's body on a
   * tall, close-up character (the bug this fixes). Zero when the slot is free,
   * which hands the space back to the character.
   */
  const desiredTopReservePx = !wantsTopDialogue
    ? 0
    : bannerCardWanted
      ? Math.max(
          topDialogueHeightPx,
          phase === 'reveal' ? AR_COMBINED_CARD_FALLBACK_HEIGHT : AR_BANNER_CARD_FALLBACK_HEIGHT
        ) +
        AR_CARD_GAP +
        8
      : Math.max(topDialogueHeightPx, AR_BUBBLE_FALLBACK_HEIGHT) + AR_BUBBLE_TAIL_GAP + 8;
  const topReservePx = Math.min(desiredTopReservePx, availableHeadroomPx);
  /**
   * False only when the dialogue would cost the model more than it may lose:
   * the reveal then docks into the bottom HUD instead of covering the
   * character.
   */
  const topDialogueFits = topReservePx >= desiredTopReservePx;

  /**
   * True once the player has identified this character on screen: the focus-lock
   * is running, or the character is holding its ground waiting for the key.
   *
   * From here the model stops tracking the raw GPS/compass solution. A solved
   * position inherits every metre of GPS error and every degree of compass
   * wobble, so a character standing still still shakes and its distance-derived
   * size breathes — very obvious at close range. Pinning it to a fixed frame
   * removes the shake entirely and keeps it steady while the key is typed.
   */
  const identified =
    isLocking ||
    phase === 'key' ||
    phase === 'quiz' ||
    phase === 'reveal';

  /** The slice of the screen the character may occupy — HUD and bubble excluded. */
  const viewport = useMemo<ARViewportBox>(
    () => ({
      widthPx: dims.width,
      heightPx: dims.height,
      safeTopPx: hudSafeTopPx + topReservePx,
      safeBottomPx: hudSafeBottomPx,
    }),
    [dims, hudSafeTopPx, hudSafeBottomPx, topReservePx]
  );

  /**
   * Framing shared by the 3D layer and the hint bubble: keeps the character on
   * screen (below the HUD, above the chips) and reports where its head lands.
   */
  const canvasFrame = useMemo(
    () =>
      placement && characterSizing
        ? computeARCanvasFrame(placement, characterSizing, viewport, AR_SCENE_DEPTH, {
          identified,
        })
        : null,
    [placement, characterSizing, viewport, identified]
  );

  // --- Camera stream lifecycle ---------------------------------------------
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('error');
      setCameraError('This browser does not expose a camera to web pages.');
      return;
    }
    setCameraState('starting');
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => { });
      }
      setCameraState('active');
    } catch (err) {
      setCameraState('error');
      if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setCameraError('Camera permission was denied. Allow camera access for this site to hunt with AR.');
      } else {
        setCameraError(err instanceof Error ? err.message : 'Could not start the camera.');
      }
    }
  }, []);

  // Open/close lifecycle: reset the discovery loop, ask iOS for motion
  // permission (must happen inside the opening gesture's transient activation
  // window), start the feed, and always release camera + voice on the way out.
  useEffect(() => {
    if (!open) return;
    sightedRef.current = false;
    setLockRatio(0);
    setIsLocking(false);
    setRendererAvailable(true);
    // Closing the camera drops a pending key entry: the character has to be
    // sighted again on reopen (it is right in front of the player anyway).
    setPhase('hunting');
    setReveal(null);
    setKeyInput('');
    setKeyError(null);
    setQuizIndex(0);
    setQuizChoice(null);
    setQuizText('');
    setQuizError(null);
    setQuizChecking(false);
    setSpeaking(false);
    setVoiceCue(0);
    void orientation.requestOrientationPermission();
    void startCamera();
    return () => {
      stopCamera();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape-to-close + body scroll lock, mirroring `Modal`.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  // Lift the docked key form above the on-screen keyboard. Mobile browsers
  // shrink the *visual* viewport without resizing the layout one, so the fixed
  // HUD would otherwise sit behind the keyboard exactly while it is needed.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const covered = Math.max(window.innerHeight - vv.height - vv.offsetTop, 0);
      setKeyboardInset(covered > 80 ? Math.round(covered) : 0);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      setKeyboardInset(0);
    };
  }, [open]);

  const canLock =
    open &&
    phase === 'hunting' &&
    placement !== null &&
    activeCharacter !== null &&
    cameraState === 'active' &&
    placement.isWithinAimCone &&
    placement.distanceMeters <= activeCharacter.radiusMeters;

  /** Lock-on complete: the character holds its ground and asks for the key. */
  const handleSighted = useCallback(() => {
    if (sightedRef.current) return;
    sightedRef.current = true;
    triggerHaptic('success');
    playSoundEffect('correct');
    setKeyError(null);
    setPhase('key');
  }, []);

  // Focus-lock timer: hold aim inside the cone while within radius.
  useEffect(() => {
    if (!canLock) {
      setLockRatio(0);
      setIsLocking(false);
      return;
    }
    setIsLocking(true);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const ratio = Math.min((Date.now() - startedAt) / LOCK_ON_MS, 1);
      setLockRatio(ratio);
      if (ratio >= 1) {
        clearInterval(interval);
        handleSighted();
      }
    }, 60);
    return () => clearInterval(interval);
  }, [canLock, handleSighted]);

  /**
   * The reveal-question gate for the sighted character. Derived fresh each
   * render: during `quiz` nothing has been recorded yet, so `currentCharacter`
   * is still the character being questioned.
   */
  const quizQuestions = currentCharacter?.questions ?? [];
  const quizQuestion = phase === 'quiz' ? (quizQuestions[quizIndex] ?? null) : null;
  const quizIsLast = quizQuestion !== null && quizIndex + 1 >= quizQuestions.length;
  const quizReady =
    quizQuestion !== null &&
    (quizQuestion.type === 'mcq' ? quizChoice !== null : quizText.trim().length > 0);

  /** Back to question one for the next attempt at the gate. */
  const resetQuiz = useCallback(() => {
    setQuizIndex(0);
    setQuizChoice(null);
    setQuizText('');
    setQuizError(null);
    setQuizChecking(false);
  }, []);

  /**
   * The single path into `reveal`: records nothing itself (the context call
   * that produced `result` already did) and starts the dialogue's text + voice
   * — unless the character is a cutout video with its own audio, which rolls
   * with its own sound instead. The voice cue starts a cutout video from
   * frame 1 either way.
   */
  const beginReveal = useCallback(
    (result: DiscoverResult) => {
      setKeyInput('');
      setKeyError(null);
      setReveal(result);
      setPhase('reveal');
      triggerHaptic('success');
      playSoundEffect(result.isFinal ? 'level_up' : 'correct');
      setVoiceCue(cue => cue + 1);
      if (!videoCharacterVoice) {
        setSpeaking(true);
        void speakClue(buildSpeech(result), { onDone: () => setSpeaking(false) });
      }
    },
    [videoCharacterVoice]
  );

  /**
   * Presents the typed key. On a character with reveal questions the key only
   * earns the right to be asked — the discovery (and its reveal) stays locked
   * until every question passes, so walking away mid-quiz re-arms the whole
   * stop. Characters without questions go straight through: the context
   * throws on a mismatch and records a discovery only on a match, so between
   * them these are the only gates that can move the hunt on.
   */
  const handlePresentKey = useCallback(async () => {
    if (presenting || phase !== 'key') return;
    setPresenting(true);
    try {
      const character = currentCharacter;
      if (!character) {
        setKeyError('This hunt has nothing left to discover.');
        return;
      }
      if (character.questions && character.questions.length > 0) {
        // Same mismatch error as the context — but nothing recorded yet. The
        // key earns the right to be asked; the discovery stays locked behind
        // the questions.
        assertPresentedKey(character, keyInput);
        setKeyError(null);
        resetQuiz();
        setPhase('quiz');
        triggerHaptic('success');
        playSoundEffect('correct');
        return;
      }
      const result = await discoverCurrentCharacter(keyInput);
      if (!result) {
        setKeyError('This hunt has nothing left to discover.');
        return;
      }
      beginReveal(result);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'That key does not match — try again.');
      triggerHaptic('warning');
      playSoundEffect('wrong');
    } finally {
      setPresenting(false);
    }
  }, [
    presenting,
    phase,
    currentCharacter,
    keyInput,
    discoverCurrentCharacter,
    resetQuiz,
    beginReveal,
  ]);

  /**
   * Submits the current question's answer. A wrong answer keeps the player on
   * the same question; only once every question has passed is the discovery
   * recorded and the reveal (dialogue, next key, video) started.
   */
  const handleQuizSubmit = useCallback(async () => {
    if (quizChecking || phase !== 'quiz') return;
    const question = quizQuestions[quizIndex];
    if (!currentCharacter || !question) return;

    if (!isQuestionCorrect(question, quizChoice, quizText)) {
      setQuizError(
        question.type === 'mcq'
          ? 'Not the right choice — read the question once more and try again.'
          : "That's not the answer — think it over and try again."
      );
      triggerHaptic('warning');
      playSoundEffect('wrong');
      return;
    }

    triggerHaptic('success');
    setQuizError(null);
    const isLast = quizIndex + 1 >= quizQuestions.length;
    if (!isLast) {
      playSoundEffect('correct');
      setQuizIndex(quizIndex + 1);
      setQuizChoice(null);
      setQuizText('');
      return;
    }

    // All questions passed — now, and only now, the hunt may advance.
    setQuizChecking(true);
    try {
      const result = await discoverCurrentCharacter(keyInput);
      if (!result) {
        setQuizError('This hunt has nothing left to discover.');
        triggerHaptic('warning');
        playSoundEffect('wrong');
        return;
      }
      beginReveal(result); // brings its own success sound and voice cue
    } catch (err) {
      // The key was checked when the quiz opened; this covers the hunt having
      // moved underneath us (e.g. the character discovered elsewhere).
      setQuizError(err instanceof Error ? err.message : 'Something went wrong — try again.');
      triggerHaptic('warning');
      playSoundEffect('wrong');
    } finally {
      setQuizChecking(false);
    }
  }, [
    quizChecking,
    phase,
    currentCharacter,
    quizQuestions,
    quizIndex,
    quizChoice,
    quizText,
    keyInput,
    discoverCurrentCharacter,
    beginReveal,
  ]);

  /** Re-reads the character's message aloud (the native "replay voice clue"). */
  const handleReplayVoice = useCallback(() => {
    if (!reveal) return;
    // Restart the cutout video from frame 1 so it stays in sync with the voice.
    setVoiceCue(cue => cue + 1);
    // A video character replays its own audio — no TTS voiceover on top.
    if (videoCharacterVoice) return;
    setSpeaking(true);
    void speakClue(buildSpeech(reveal), { onDone: () => setSpeaking(false) });
  }, [reveal, videoCharacterVoice]);

  /**
   * Dismisses the reveal. A non-final discovery re-arms the frame for the next
   * target with the camera still open, so the player can walk on with the
   * message fresh; a final one is handed to the caller, which celebrates.
   */
  const handleRevealContinue = useCallback(() => {
    if (!reveal) return;
    stopSpeaking();
    setSpeaking(false);
    setVoiceCue(0);
    onDiscoveryComplete?.(reveal);
    if (reveal.isFinal) return;
    setReveal(null);
    setPhase('hunting');
    setKeyError(null);
    setLockRatio(0);
    setIsLocking(false);
    sightedRef.current = false;
  }, [reveal, onDiscoveryComplete]);

  if (!open) return null;

  const showEdgeArrow =
    phase === 'hunting' && placement !== null && !placement.isInView && activeCharacter !== null;
  const turnRight = (placement?.turnDeltaDeg ?? 0) > 0;
  /** Sensor-source badge: auto-aim fallback or live compass. */
  const sensorMode = orientation.isAutoAiming ? 'AUTO' : 'LIVE';
  const sensorTint = orientation.isAutoAiming ? '#fbbf24' : '#10b981';

  /** Single-line instruction telling the player what to do right now. */
  const guidance = (() => {
    if (reveal) {
      return reveal.isFinal
        ? 'Hunt complete — the treasure is yours!'
        : `Key received — next location: ${reveal.nextCharacter?.name ?? 'coming up'}`;
    }
    if (phase === 'key' && activeCharacter) {
      return `At ${activeCharacter.name} — present your key below`;
    }
    if (phase === 'quiz' && activeCharacter) {
      return `Key accepted — answer ${quizQuestions.length} question${
        quizQuestions.length === 1 ? '' : 's'
      } to open ${activeCharacter.name}`;
    }
    if (cameraState === 'starting') return 'Starting camera…';
    if (cameraState === 'error') return 'Camera unavailable';
    if (!userLocation) return 'Acquiring GPS signal…';
    if (!placement || activeCharacter === null) return 'Calibrating sensors…';
    if (placement.distanceMeters > activeCharacter.radiusMeters) {
      return `Move closer — ${formatDistance(placement.distanceMeters)} to go`;
    }
    if (!placement.isInView) {
      return `Turn ${placement.turnDeltaDeg > 0 ? 'right' : 'left'} ${Math.abs(
        Math.round(placement.turnDeltaDeg)
      )}°`;
    }
    if (Math.abs(placement.tiltDeltaDeg) > 6) {
      return `Tilt ${placement.tiltDeltaDeg > 0 ? 'up' : 'down'} ${Math.abs(
        Math.round(placement.tiltDeltaDeg)
      )}°`;
    }
    if (!placement.isWithinAimCone) return 'Almost there — centre the character';
    if (isLocking) return 'Hold steady…';
    return 'Aim at the character';
  })();

  /** Green banner while the player is on target — or handled the key over. */
  const guidanceActive = canLock || phase !== 'hunting';

  /**
   * True while the model — and therefore its head bubble — is on screen. A
   * bubble that cannot fit above the model counts as off screen, so the reveal
   * docks into the bottom HUD rather than being drawn over the character.
   */
  const characterOnScreen = rendererAvailable && canvasFrame?.visible === true && topDialogueFits;

  /**
   * True while the hunt clue floats over the model's head (else docks below).
   * A selected banner owns that slot instead — pre-key the card shows only the
   * banner — so the clue stays in the bottom hint bar.
   */
  const showHeadHint =
    phase === 'hunting' && characterOnScreen && !!activeCharacter && sponsorBanner === null;

  /**
   * The sponsor card owns the slot above the character while a banner is
   * selected: banner alone before the key, banner + hint once revealed. At the
   * reveal it appears only while the combined card fits on screen; docked, it
   * reports 0 and the headroom estimate holds, so the layout settles instead
   * of flickering.
   */
  const showSponsorCard = bannerCardWanted && (phase !== 'reveal' || characterOnScreen);

  /**
   * Bubble content over the model's head: the clue that points at the character
   * while hunting, then the character's own words once its key is accepted. The
   * reveal docks into the bottom HUD when the character is off screen, so
   * lowering the phone can never lose the message.
   */
  const bubbleText = reveal
    ? characterOnScreen
      ? `“${reveal.character.dialogue}”`
      : null
    : showHeadHint
      ? activeCharacter?.hint ?? null
      : null;

  return (
    <div className="arCamera" role="dialog" aria-modal="true" aria-label="AR camera view">
      {/* Live camera feed */}
      <video ref={videoRef} className="arCameraVideo" playsInline muted autoPlay />

      {/* 3D character composited over the real world */}
      {activeCharacter && canvasFrame && cameraState === 'active' && (
        <ARSceneView
          characterType={renderCharacterType ?? activeCharacter.characterType}
          characterAsset={characterAsset}
          frame={canvasFrame}
          renderActive={true}
          // Cutout videos hold frame 1 until the key is accepted; during the
          // reveal they roll while the voiceover speaks (freeze on end, restart
          // from frame 1 on replay) — or for the whole reveal when the clip is
          // its own voice, or when no TTS engine exists to sync to.
          mediaPlaying={
            phase === 'reveal' &&
            (videoCharacterVoice ||
              speaking ||
              typeof window === 'undefined' ||
              !('speechSynthesis' in window))
          }
          mediaRestartToken={voiceCue}
          hint={bubbleText}
          speaker={showHeadHint ? activeCharacter.name : null}
          label={reveal ? `${revealSpeaker ?? 'They'} — ${speaking ? 'SPEAKING…' : 'SAYS'}` : null}
          bubbleExtra={reveal ? <RevealDetails result={reveal} /> : null}
          accent={characterMeta?.accent}
          sponsorBanner={sponsorBanner}
          showSponsorCard={showSponsorCard}
          onRendererStateChange={setRendererAvailable}
          onBubbleHeightChange={handleBubbleHeightChange}
        />
      )}

      {/* ---------------- Top HUD ---------------- */}
      <div className="arTopBar">
        <button type="button" className="arCloseBtn" onClick={onClose} aria-label="Close AR camera">
          <X size={20} />
        </button>

        <div className="arTargetChip">
          <div className="arTargetChipRow">
            {characterMeta && (
              <span className="arChipDot" style={{ background: characterMeta.accent }} />
            )}
            <span className="arTargetChipText">{activeCharacter?.name ?? 'No target'}</span>
          </div>
          <div className="arTargetChipMetaRow">
            <MapPin size={10} />
            <span>
              {placement
                ? `${formatDistance(placement.distanceMeters)} • ${placement.isWithinAimCone
                  ? 'on target'
                  : `${Math.abs(Math.round(placement.relativeAzimuthDeg))}° off axis`
                }`
                : 'locating…'}
            </span>
          </div>
        </div>

        <div className="arSensorChip" style={{ borderColor: sensorTint }}>
          <Radar size={13} />
          <span style={{ color: sensorTint }}>{sensorMode}</span>
        </div>
      </div>

      {/* Guidance banner */}
      <div className={`arGuidance${guidanceActive ? ' arGuidanceActive' : ''}`}>
        {guidanceActive ? <span className="arGuidanceIcon">◎</span> : <Navigation2 size={15} />}
        <span>{guidance}</span>
      </div>

      {/* ---------------- Off-screen direction arrow ---------------- */}
      {showEdgeArrow && (
        <div
          className={`arEdgeArrow ${turnRight ? 'arEdgeArrowRight' : 'arEdgeArrowLeft'}`}
          aria-hidden="true"
        >
          {turnRight ? <ChevronRight size={26} /> : <ChevronLeft size={26} />}
          <span>{Math.abs(Math.round(placement?.turnDeltaDeg ?? 0))}°</span>
          {Math.abs(placement?.tiltDeltaDeg ?? 0) > 20 &&
            (placement && placement.tiltDeltaDeg > 0 ? (
              <ArrowUp size={16} />
            ) : (
              <ArrowDown size={16} />
            ))}
        </div>
      )}

      {/* ---------------- Focus reticle (hunting only) ---------------- */}
      {phase === 'hunting' && (
        <div className="arReticleWrap" aria-hidden="true">
          <div
            className={`arReticle${canLock ? ' arReticleActive' : ''}${isLocking ? ' arReticleLocking' : ''
              }`}
          >
            <span className="arCorner arCornerTL" />
            <span className="arCorner arCornerTR" />
            <span className="arCorner arCornerBL" />
            <span className="arCorner arCornerBR" />
            <Navigation2 size={18} />
          </div>
          {isLocking && (
            <div className="arLockTrack">
              <div className="arLockFill" style={{ width: `${Math.round(lockRatio * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* ---------------- Bottom HUD ---------------- */}
      <div
        className="arBottom"
        style={keyboardInset > 0 ? { paddingBottom: 14 + keyboardInset } : undefined}
      >
        {/* Key in hand — on the frame in every phase, so the key handed over at
            the last stop stays readable while walking, while sighting a
            character, and while typing it into the form below. */}
        {activeCharacter && (
          <div className="arChips">
            <KeyInHand variant="chip" />
          </div>
        )}

        {phase === 'hunting' && activeCharacter && !showHeadHint && (
          <div className="arHintBar">
            <span className="arHintBarLabel">HINT TO THIS LOCATION</span>
            <p className="arHintBarText">{activeCharacter.hint}</p>
          </div>
        )}

        {phase === 'hunting' && activeCharacter && (
          <div className="arChips">
            <span className="arChip">
              <MapPin size={11} />
              {`within ${activeCharacter.radiusMeters}m to unlock`}
            </span>
            {activeCharacter.altitudeMeters > 0 && (
              <span className="arChip arChipAir">
                <ArrowUp size={11} />
                {activeCharacter.altitudeMeters}m above ground
              </span>
            )}
          </div>
        )}

        {/* Raw coordinates + the manual re-check. The camera frame is exactly
            where "it still says walk closer but I am standing here" happens, so
            the answer has to live on the frame too. */}
        {phase === 'hunting' && activeCharacter && (
          <LocationStatus target={activeCharacter} variant="compact" />
        )}

        {/* Key entry lives on the frame: the sighted character stays in view
            until this location's key matches — the one handed over for it, one
            stop early (or when the hunt opened, if this is the first stop). */}
        {phase === 'key' && activeCharacter && (
          <div className="arKeyPanel">
            <span className="arKeyPanelLabel">
              <KeyRound size={12} /> Sighted — present your key
            </span>
            <form
              className="arKeyForm"
              onSubmit={event => {
                event.preventDefault();
                void handlePresentKey();
              }}
            >
              <input
                className="arKeyInput"
                value={keyInput}
                onChange={e => {
                  setKeyInput(e.target.value);
                  if (keyError) setKeyError(null);
                }}
                placeholder="Key handed over for this location"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-label="Discovery key"
                autoFocus
              />
              <button
                type="submit"
                className="arKeySubmit"
                disabled={presenting || keyInput.trim().length === 0}
              >
                <Sparkles size={15} />
                {presenting ? 'Checking…' : 'Present'}
              </button>
            </form>
            {keyError && (
              <p className="arKeyError" role="alert">
                {keyError}
              </p>
            )}
            <p className="arKeyHelper">
              {`${activeCharacter.name} stays right here until the right key is presented — the hunt does not move on without it.`}
            </p>
          </div>
        )}

        {/* Question gate: a character that has reveal questions keeps its
            message and video locked until every one of them is answered —
            the discovery itself is recorded only after the last pass. */}
        {phase === 'quiz' && activeCharacter && quizQuestion && (
          <div className="arQuizPanel">
            <span className="arKeyPanelLabel">
              <ListChecks size={12} /> Question {quizIndex + 1} of {quizQuestions.length} — answer
              to unlock
            </span>
            <form
              className="arQuizForm"
              onSubmit={event => {
                event.preventDefault();
                if (quizReady) void handleQuizSubmit();
              }}
            >
              <p className="arQuizPrompt">{quizQuestion.prompt}</p>
              {quizQuestion.type === 'mcq' ? (
                <div className="arQuizOptions" role="group" aria-label="Answer options">
                  {(quizQuestion.options ?? []).map(option => (
                    <button
                      key={option.id}
                      type="button"
                      className={`arQuizOption${quizChoice === option.id ? ' arQuizOptionOn' : ''}`}
                      aria-pressed={quizChoice === option.id}
                      onClick={() => {
                        setQuizChoice(option.id);
                        if (quizError) setQuizError(null);
                        triggerHaptic('light');
                      }}
                    >
                      {option.text}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  className="arQuizInput"
                  value={quizText}
                  onChange={e => {
                    setQuizText(e.target.value);
                    if (quizError) setQuizError(null);
                  }}
                  placeholder="Type your answer"
                  autoComplete="off"
                  autoCapitalize="sentences"
                  spellCheck={false}
                  aria-label="Answer"
                  autoFocus
                />
              )}
              {quizError && (
                <p className="arKeyError" role="alert">
                  {quizError}
                </p>
              )}
              <button
                type="submit"
                className="arKeySubmit arQuizSubmit"
                disabled={!quizReady || quizChecking}
              >
                <Sparkles size={15} />
                {quizChecking
                  ? 'Checking…'
                  : quizIsLast
                    ? 'Unlock the reveal'
                    : 'Submit answer'}
              </button>
            </form>
            <p className="arKeyHelper">
              Nothing at {activeCharacter.name} is revealed — no message, no video — until every
              question is answered correctly.
            </p>
          </div>
        )}

        {/* Reveal: the message + key float over the character's head; this row
            is the control for it, and the message docks here when the
            character is off screen (or WebGL cannot draw it at all). */}
        {phase === 'reveal' && reveal && (
          <>
            {!characterOnScreen && (
              <div className="arRevealDock">
                <div className="arBubbleHeader">
                  <span className="arBubbleDot" style={{ background: characterMeta?.accent }} />
                  <span className="arBubbleSpeaker" style={{ color: characterMeta?.accent }}>
                    {revealSpeaker ?? 'They'} — {speaking ? 'SPEAKING…' : 'SAYS'}
                  </span>
                </div>
                <p className="arBubbleText">“{reveal.character.dialogue}”</p>
                <RevealDetails result={reveal} />
              </div>
            )}
            <div className="arRevealActions">
              <button
                type="button"
                className="arRevealBtn arRevealReplay"
                onClick={handleReplayVoice}
              >
                <Volume2 size={15} />
                {speaking ? 'Speaking…' : 'Replay message'}
              </button>
              <button
                type="button"
                className="arRevealBtn arRevealContinue"
                onClick={handleRevealContinue}
              >
                {reveal.isFinal ? 'Finish hunt' : 'Continue'}
                <ChevronRight size={16} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* ---------------- Camera failure gate ---------------- */}
      {cameraState === 'error' && phase === 'hunting' && (
        <div className="arErrorCard" role="alert">
          <Camera size={30} />
          <h3>Camera unavailable</h3>
          <p>{cameraError}</p>
          <p className="arErrorHint">
            Sighting the character and presenting the key both happen on this frame — allow camera
            access and try again, or skip the sighting and type the key here.
          </p>
          <div className="arErrorActions">
            <button type="button" className="btnPrimary" onClick={() => void startCamera()}>
              Try again
            </button>
            <button
              type="button"
              className="btnGhost"
              onClick={handleSighted}
              title="Fallback for devices without a camera"
            >
              No camera here — go to the key form
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
