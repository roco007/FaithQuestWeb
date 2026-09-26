export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';
export type SoundEffectType = 'radar_ping' | 'in_range' | 'correct' | 'wrong' | 'level_up' | 'badge_unlock';

/**
 * Browsers reject `navigator.vibrate` until the frame has been activated by a
 * real user gesture (Chrome logs a console error when it is called blind).
 * Game feedback also fires from effects on page load — e.g. entering range
 * automatically when the player already stands on the target — so haptic calls
 * are gated on the document actually having been interacted with.
 *
 * Primary signal is the User Activation API (`navigator.userActivation`). Where
 * it is missing we fall back to a one-shot listener that flips a flag on the
 * first real interaction, rather than guessing from focus/visibility (a page
 * can be focused without ever having been tapped).
 */
let userInteracted = false;

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const markInteracted = () => {
    userInteracted = true;
  };
  // Capture phase + passive so this observes gestures without delaying them.
  for (const evt of ['pointerdown', 'touchstart', 'keydown', 'mousedown'] as const) {
    window.addEventListener(evt, markInteracted, { capture: true, passive: true });
  }
}

function hasUserActivation(): boolean {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false;
  // The User Activation API hangs off `navigator`, not `document`.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation;
  if (typeof activation?.hasBeenActive === 'boolean') return activation.hasBeenActive;
  return userInteracted;
}

/**
 * Triggers tactile feedback via the Vibration API.
 *
 * iOS Safari has no `navigator.vibrate`, so this is a silent no-op there —
 * the same progressive-enhancement contract the native build relied on.
 */
export async function triggerHaptic(style: HapticStyle = 'medium'): Promise<void> {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;

  // Vibration lengths mirror the feel of the native impact/notification styles.
  // A number array is a vibrate "pattern" (alternate off/on durations).
  const DURATION_MS: Record<HapticStyle, number | number[]> = {
    light: 10,
    medium: 20,
    heavy: 35,
    success: [12, 40, 18],
    warning: [18, 60, 18],
    error: [25, 50, 25, 50, 25],
  };

  if (!hasUserActivation()) return;

  try {
    navigator.vibrate(DURATION_MS[style]);
  } catch {
    // Haptics are optional polish — never let them break a user action.
  }
}

/**
 * Plays an audio sound effect or synthesizes a frequency tone.
 */
export async function playSoundEffect(type: SoundEffectType): Promise<void> {
  try {
    // If running in browser or Web Audio environment, we can synthesize rich game audio tones
    if (typeof window !== 'undefined' && (window as any).AudioContext) {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      if (type === 'correct' || type === 'in_range') {
        // High ascending cheerful chord
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.2); // G5
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      } else if (type === 'level_up' || type === 'badge_unlock') {
        // Fanfare
        osc.frequency.setValueAtTime(440, now); // A4
        osc.frequency.setValueAtTime(554.37, now + 0.12); // C#5
        osc.frequency.setValueAtTime(659.25, now + 0.24); // E5
        osc.frequency.setValueAtTime(880, now + 0.36); // A5
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        osc.start(now);
        osc.stop(now + 0.7);
      } else if (type === 'wrong') {
        // Low buzzing dissonance
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(140, now + 0.25);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'radar_ping') {
        // Sonar submarine ping
        osc.type = 'sine';
        osc.frequency.setValueAtTime(987.77, now); // B5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    }
  } catch (e) {
    // Audio synthesis fallback
  }
}
