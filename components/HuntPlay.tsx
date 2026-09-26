'use client';

import { useState } from 'react';
import { ArrowLeft, Radar, MapPin, Compass, Lock, PartyPopper, Camera } from 'lucide-react';
import { useHunt, DiscoverResult } from '../context/HuntContext';
import { useHuntRadar } from '../hooks/useHuntRadar';
import { formatDistance } from '../utils/geo';
import { Modal } from './Modal';
import { HuntARCamera } from './HuntARCamera';
import { KeyInHand } from './KeyInHand';
import { LocationStatus } from './LocationStatus';
import type { HuntCharacter } from '../types/hunt';

/** Colour + copy for each proximity level, mirroring the native radar HUD. */
function themeFor(level: string) {
  switch (level) {
    case 'IN_RANGE':
      return { color: '#10b981', label: 'IN RANGE • DISCOVERABLE' };
    case 'HOT':
      return { color: '#f97316', label: 'HOT • VERY CLOSE' };
    case 'WARM':
      return { color: '#f59e0b', label: 'GETTING WARMER' };
    default:
      return { color: '#38bdf8', label: 'COLD • KEEP EXPLORING' };
  }
}

/** Emoji stand-ins for the 3D character archetypes the native build rendered in 3D. */
const CHARACTER_EMOJI: Record<HuntCharacter['characterType'], string> = {
  guardian: '🛡️',
  angel: '👼',
  monk: '🧘',
  flame: '🔥',
  oracle: '🔮',
};

interface HuntPlayProps {
  onExit: () => void;
}

/**
 * Plays the active hunt in the browser.
 *
 * Discovery runs entirely on the AR camera frame (`HuntARCamera`), the web port
 * of the native view: walk inside a character's radius, open the camera and
 * hold the reticle on the 3D character composited over the live feed. The
 * sighted character then stays on screen while the key from the previous stop
 * is presented in the form docked at the bottom of the frame — nothing
 * advances until it matches — and answers in text + voice with the key and
 * hint for the next target. Strict visibility applies outside the radius: the
 * character's name, clue, distance, bearing and route entry are all hidden, and
 * players navigate from the characters' dialogue — except for the first stop,
 * whose clue comes from the creator and is shown the moment the hunt opens.
 * The key the player is holding (`KeyInHand`) rides under the progress bar in
 * every state of the hunt, so it is never lost with a dismissed reveal.
 * Devices without a camera get a labelled fallback in the AR view itself, so a
 * hunt is never soft-locked.
 */
export function HuntPlay({ onExit }: HuntPlayProps) {
  const { activeGame, activeProgress, currentCharacter } = useHunt();
  const radar = useHuntRadar();

  const [celebration, setCelebration] = useState(false);
  /** Whether the fullscreen AR camera view is open. */
  const [arOpen, setArOpen] = useState(false);

  /**
   * The camera owns the whole discovery loop, so the only outcome this screen
   * reacts to is the end of the hunt: a final discovery closes the camera and
   * parades the end announcement.
   */
  const handleDiscoveryComplete = (result: DiscoverResult) => {
    if (result.isFinal) {
      setArOpen(false);
      setCelebration(true);
    }
  };

  if (!activeGame || !activeProgress) {
    return (
      <div className="page">
        <div className="card emptyState">
          <div className="emptyTitle">No active hunt</div>
          <p>Join or start a hunt first.</p>
        </div>
      </div>
    );
  }

  const isComplete = activeProgress.status === 'completed';
  const theme = themeFor(radar?.proximity.level ?? 'COLD');
  const inRange = radar?.proximity.isWithinRadius ?? false;
  const foundCount = activeProgress.discoveredCharacterIds.length;
  const total = activeGame.characters.length;
  /** The already-discovered character whose dialogue points at the current one. */
  const previousCharacter =
    currentCharacter && currentCharacter.order > 1
      ? activeGame.characters.find(ch => ch.order === currentCharacter.order - 1) ?? null
      : null;

  return (
    <div className="page">
      <div className="playHeader">
        <button type="button" className="btnGhost" onClick={onExit}>
          <ArrowLeft size={15} />
          Back to hunts
        </button>
        <div className="playTitleBlock">
          <h1 className="pageTitle" style={{ marginBottom: 2 }}>
            {activeGame.title}
          </h1>
          <p className="cardSubtitle">
            {foundCount}/{total} found
            {currentCharacter &&
              (inRange ? ` · looking for ${currentCharacter.name}` : ' · keep exploring')}
          </p>
        </div>
      </div>

      <div className="playProgressTrack" aria-hidden="true">
        <div
          className="playProgressFill"
          style={{ width: `${total === 0 ? 0 : (foundCount / total) * 100}%` }}
        />
      </div>

      {/* The key the player is holding, on screen in every state of the hunt —
          out of range, in range, on the camera frame and after the last find. */}
      <KeyInHand />

      {isComplete || !currentCharacter ? (
        <div className="card playComplete">
          <PartyPopper size={34} color="var(--amber)" />
          <h2 className="victoryHeading" style={{ marginTop: 12 }}>
            Hunt complete!
          </h2>
          <p className="victorySubtitle">{activeGame.endAnnouncement}</p>
          <button type="button" className="btnGhost" onClick={onExit}>
            Return to hunts
          </button>
        </div>
      ) : (
        <div className="playGrid">
          {/* --- Target card ------------------------------------------------ */}
          {inRange ? (
            /* Revealed: the player walked inside the discovery radius. */
            <div className="card targetCard" style={{ borderColor: theme.color }}>
              <div className="targetHeader">
                <div
                  className="targetAvatar"
                  style={{ background: `${theme.color}22`, borderColor: theme.color }}
                  aria-hidden="true"
                >
                  {CHARACTER_EMOJI[currentCharacter.characterType]}
                </div>
                <div>
                  <span className="sectionLabel" style={{ marginBottom: 2 }}>
                    Current target
                  </span>
                  <h2 className="targetName">{currentCharacter.name}</h2>
                  <p className="cardSubtitle">{currentCharacter.subtitle}</p>
                </div>
              </div>

              <div className="loreCard" style={{ margin: '16px 0' }}>
                <span className="sectionLabel">Clue</span>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
                  {currentCharacter.hint}
                </p>
              </div>

              <div
                className="hudStatusStrip"
                style={{ background: `${theme.color}22`, color: theme.color }}
              >
                <Radar size={14} />
                {theme.label}
              </div>

              {radar && (
                <div className="radarReadout">
                  <div className="radarStat">
                    <MapPin size={15} />
                    <span>{formatDistance(radar.distanceMeters)}</span>
                  </div>
                  <div className="radarStat">
                    <Compass size={15} />
                    <span>{Math.round(radar.bearingDegrees)}°</span>
                  </div>
                </div>
              )}

              {/* Raw coordinates + the manual re-check, for when the live watch
                  has gone quiet and walking in is not being noticed. */}
              <LocationStatus target={currentCharacter} />

              {/* --- AR camera gate -------------------------------------------
                  Discovery happens on the camera frame itself: sighting the
                  character, presenting the key and hearing its answer all live
                  in `HuntARCamera`, so this card only opens the view. */}
              <div className="hudLockedBar" style={{ marginTop: 16, marginBottom: 0 }}>
                <Lock size={14} />
                Spot {currentCharacter.name} in the AR camera — the key is presented on the frame.
              </div>
              <button
                type="button"
                className="hudDiscoverBtn"
                style={{ animation: 'none', marginTop: 12 }}
                onClick={() => setArOpen(true)}
              >
                <Camera size={18} />
                Open AR Camera
              </button>
            </div>
          ) : (
            /* Hidden: outside the discovery radius nothing about the character
               is revealed — no name, clue, distance, bearing, or radius. */
            <div className="card targetCard" style={{ borderColor: '#334155' }}>
              <div className="targetHeader">
                <div
                  className="targetAvatar"
                  style={{ background: 'rgba(148, 163, 184, 0.12)', borderColor: '#334155' }}
                  aria-hidden="true"
                >
                  ❓
                </div>
                <div>
                  <span className="sectionLabel" style={{ marginBottom: 2 }}>
                    Current target
                  </span>
                  <h2 className="targetName">???</h2>
                  <p className="cardSubtitle">
                    {currentCharacter.order === 1
                      ? "Follow the creator's first clue"
                      : 'Nothing in view yet'}
                  </p>
                </div>
              </div>

              <div className="loreCard" style={{ margin: '16px 0' }}>
                <span className="sectionLabel">
                  {previousCharacter
                    ? `Clue from ${previousCharacter.name}`
                    : 'First clue — from the creator'}
                </span>
                {/* The first stop has no character before it to hand a clue over:
                    the creator's briefing is the clue, and it is shown the moment
                    the hunt opens — otherwise there is nothing to walk towards. */}
                {previousCharacter ? (
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
                    “{previousCharacter.dialogue}”
                  </p>
                ) : (
                  <>
                    <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
                      {currentCharacter.hint}
                    </p>
                    <p className="fieldHelp">
                      The creator hands out the first key too. It stays in the bar above while you
                      walk, and is presented once the character shows itself.
                    </p>
                  </>
                )}
              </div>

              <div className="hudLockedBar">
                <Lock size={14} />
                {!radar
                  ? 'Waiting for your location — enable GPS to start the hunt.'
                  : 'The character stays hidden until you walk into its discovery zone.'}
              </div>

              {/* The player's own coordinates are always theirs to see. Distance
                  to the hidden stop stays behind the explicit "check" tap, so
                  strict visibility is unchanged unless they ask. */}
              <div style={{ marginTop: 16 }}>
                <LocationStatus target={currentCharacter} />
              </div>
            </div>
          )}

          {/* --- Route list ------------------------------------------------- */}
          <div className="card routeCard">
            <span className="sectionLabel">Hunt route</span>
            <ol className="routeList">
              {activeGame.characters.map((ch) => {
                const isDone = activeProgress.discoveredCharacterIds.includes(ch.id);
                const isCurrent = ch.id === currentCharacter.id;
                // Strict visibility: undiscovered characters stay anonymous until
                // discovered (or, while current, until the player is in range).
                const isRevealed = isDone || (isCurrent && inRange);
                return (
                  <li
                    key={ch.id}
                    className={`routeItem${isCurrent ? ' routeItemCurrent' : ''}${
                      isDone ? ' routeItemDone' : ''
                    }`}
                  >
                    <span className="routeIndex">{isDone ? '✓' : ch.order}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="routeName">
                        {isRevealed ? ch.name : '???'}
                        {isCurrent && inRange && <span className="pill pillActive">Now</span>}
                      </div>
                      <div className={`routeSub${isDone ? ' routeClue' : ''}`}>
                        {isDone
                          ? `“${ch.dialogue}”`
                          : isRevealed
                            ? ch.subtitle
                            : 'Hidden — undiscovered'}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      <Modal open={celebration} onClose={() => setCelebration(false)} title="Hunt complete!">
        <div className="victoryCard">
          <PartyPopper size={34} color="var(--amber)" />
          <p className="victorySubtitle" style={{ marginTop: 12 }}>
            {activeGame.endAnnouncement}
          </p>
          <button type="button" className="btnGreen" onClick={onExit}>
            Back to hunts
          </button>
        </div>
      </Modal>

      {/* Fullscreen geo-AR view — the sighting, the key entry and the
          character's spoken answer all happen on this frame. */}
      <HuntARCamera
        open={arOpen}
        onClose={() => setArOpen(false)}
        onDiscoveryComplete={handleDiscoveryComplete}
      />
    </div>
  );
}

