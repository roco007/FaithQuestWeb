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
 * The discovery key the player is holding right now, shown at all times.
 *
 * Character N's key is handed over by character N-1 (the creator gives players
 * the first one) and has to be presented at the next stop. It used to live only
 * inside the reveal bubble, which disappears the moment the player carries on
 * walking — so it stays on screen here while walking, while sighting a
 * character, and while typing it into the key form. Tapping copies it to the
 * clipboard, so it can be pasted straight into the form.
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

  const label =
    activeProgress.discoveredCharacterIds.length === 0
      ? 'Key from the creator'
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
