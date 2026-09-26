export interface SpeakOptions {
  /** Speech speed (1 = normal). Clues read slightly slower for clarity. */
  rate?: number;
  /** Voice pitch (1 = normal). */
  pitch?: number;
  /** Called after the utterance finishes. */
  onDone?: () => void;
}

/**
 * Speaks a clue aloud using the browser's built-in text-to-speech engine.
 * Cancels any utterance already in progress so clues never overlap.
 * This powers the "voice" half of character clues (text is shown alongside).
 */
export async function speakClue(text: string, options: SpeakOptions = {}): Promise<void> {
  if (!text || text.trim().length === 0) return;

  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) {
    // Browser without TTS support — silently skip; text is always shown too.
    options.onDone?.();
    return;
  }

  try {
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = 'en-US';
    utterance.rate = options.rate ?? 0.95;
    utterance.pitch = options.pitch ?? 1.0;

    // The SpeechSynthesis API is event-based, so the native onDone/onError
    // callbacks are wired up here instead of passed to a single call.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      options.onDone?.();
    };
    utterance.onend = settle;
    utterance.onerror = settle;

    synth.speak(utterance);
  } catch (err) {
    // Fail silently: spoken clue is a progressive enhancement over on-screen text.
    options.onDone?.();
  }
}

/**
 * Stops any active spoken clue.
 */
export function stopSpeaking(): void {
  try {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  } catch (err) {
    // No-op
  }
}
