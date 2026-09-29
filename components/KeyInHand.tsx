'use client';

import { useState } from 'react';
import { KeyRound, Copy, Check } from 'lucide-react';
import { useHunt } from '../context/HuntContext';
import { characterKey } from '../utils/keys';

interface KeyInHandProps {
  /** `bar` — in-page ribbon; `chip` — pill inside the AR HUD chip row. */
  variant?: 'bar' | 'chip';
  /** Extra class on the rendered element (spacing tweaks at the call site). */
  className?: string;
}

/**
 * The key the team is holding right now, shown at all times.
 *
 * Each location owns the key that opens it, and it arrives one stop early: the
 * reveal at the stop before hands it over, or — before anything has been
 * discovered — it was given when the hunt opened. So what is on screen here at
 * any moment is the key for the stop the team is walking to next.
 *
 * It used to live only inside the reveal bubble, which disappears the moment
 * the player carries on walking — so it stays on screen here while walking,
 * while sighting a character, and while typing it into the key form. Tapping
 * copies it to the clipboard, so it can be pasted straight into the form.
 */
export function KeyInHand({ variant = 'bar', className }: KeyInHandProps) {
  const { currentCharacter, activeProgress } = useHunt();
  const [copied, setCopied] = useState(false);

  if (!activeProgress) return null;

  // Completed hunts have no character left, so the key has been spent.
  const isComplete = activeProgress.status === 'completed' || currentCharacter === null;
  const key = currentCharacter ? characterKey(currentCharacter) : '';

  if (!key) {
    if (!isComplete) return null; // Legacy stop with no key — nothing to show.
    return variant === 'chip' ? (
      <span className="arChip arChipKey">Hunt complete</span>
    ) : (
      <div className={`keyBar keyBarIdle${className ? ` ${className}` : ''}`}>
        <span className="keyBarGlyph" aria-hidden="true">
          <KeyRound size={18} />
        </span>
        <span className="keyBarIdleText">Every key has been used — hunt complete.</span>
      </div>
    );
  }

  // Nothing discovered yet: this is the key given when the hunt opened, and it
  // opens the team's first location. Every key after it is the one the last
  // reveal handed over — the one that opens the stop being walked to.
  const isFirstKey = activeProgress.discoveredCharacterIds.length === 0;
  const label = isFirstKey
    ? 'Your first key — opens your first location'
    : 'Latest key received';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked (insecure origin / denied permission). The key
      // is on screen either way, which is all the player actually needs.
    }
  };

  if (variant === 'chip') {
    return (
      <button
        type="button"
        className={`arChip arChipKey arChipKeyBtn${className ? ` ${className}` : ''}`}
        onClick={() => void handleCopy()}
        title="Copy this key"
        aria-label={`${label}: ${key}. Copy to clipboard.`}
      >
        <KeyRound size={11} />
        {copied ? `Copied ${key}` : `Key in hand: ${key}`}
      </button>
    );
  }

  return (
    <div
      className={`keyBar${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={`${label}: ${key}`}
    >
      <span className="keyBarGlyph" aria-hidden="true">
        <KeyRound size={18} />
      </span>
      <div className="keyBarBody">
        <span className="keyBarLabel">{label}</span>
        <span className="keyBarValue mono">{key}</span>
      </div>
      <button
        type="button"
        className={`keyBarCopy${copied ? ' keyBarCopyDone' : ''}`}
        onClick={() => void handleCopy()}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
