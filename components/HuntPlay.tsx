'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Radar, MapPin, Compass, Lock, PartyPopper, Camera } from 'lucide-react';
import { useHunt, DiscoverResult } from '../context/HuntContext';
import { useHuntRadar } from '../hooks/useHuntRadar';
import { formatDistance } from '../utils/geo';
import { loadCharacterAssets, type CharacterAssetKind } from '../services/characterAssets';
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
 * A team plays its own shuffled route of **locations** (`activeRoute`): each
 * stop is exactly the location the creator authored — its own place, hint,
 * character, questions and key. When the hunt opens the team is handed their
 * first location's hint, character and key; every reveal that ends a stop hands
 * over the same three for the location after it, so walking is always "follow
 * the clue you were just given to the character you were just told about, then
 * present the key in your hand". Discovery runs entirely on the AR camera frame
 * (`HuntARCamera`), the web port of the native view: walk inside a stop's
 * radius, open the camera and hold the reticle on the character composited
 * over the live feed. The sighted character then stays on screen while the key
 * is presented in the form docked at the bottom of the frame — nothing advances
 * until it matches — and answers with its dialogue, video and the hand-over of
 * the next location. Strict visibility applies outside the radius: locations
 * beyond the one just handed over stay anonymous in the route list, and distance
 * and bearing wait behind the explicit location check. The key the player is
 * holding (`KeyInHand`) rides under the progress bar in every state of the hunt,
 * so it is never lost with a dismissed reveal. Devices without a camera get a
 * labelled fallback in the AR view itself, so a hunt is never soft-locked.
 */
export function HuntPlay({ onExit }: HuntPlayProps) {
  const { activeGame, activeProgress, activeRoute, currentCharacter } = useHunt();
  const radar = useHuntRadar();

  /** The character clip of this team's first location, shown as a preview. */
  const firstStopAssetId = activeRoute[0]?.characterAssetId ?? null;

  const [celebration, setCelebration] = useState(false);
  /** Whether the fullscreen AR camera view is open. */
  const [arOpen, setArOpen] = useState(false);
  /**
   * Round-start camera check: the clip belonging to the team's first location,
   * so the round opens with the character they are walking to next — plus its
   * hint and the key that opens it, both handed over before anything is walked.
   * It doubles as proof this device renders character video — the same asset the
   * AR camera composites over the live feed.
   */
  const [startClipSrc, setStartClipSrc] = useState<string | null>(null);

  useEffect(() => {
    const discoveredCount = activeProgress?.discoveredCharacterIds.length ?? 0;
    if (!firstStopAssetId || discoveredCount > 0) {
      setStartClipSrc(null);
      return;
    }
    let mounted = true;
    loadCharacterAssets()
      .then(assets => {
        if (!mounted) return;
        const asset = assets.find(candidate => candidate.id === firstStopAssetId);
        setStartClipSrc(asset?.kind === 'video' ? asset.src : null);
      })
      .catch(loadError => {
        console.warn('Could not load the round-start clip:', loadError);
        if (mounted) setStartClipSrc(null);
      });
    return () => {
      mounted = false;
    };
  }, [firstStopAssetId, activeProgress]);

  /**
   * The character on the congratulations screen: the one the creator chose next
   * to the End-of-Hunt Announcement, falling back to the treasure location's own
   * character for hunts published before that choice existed. Only the roster
   * entry is resolved here — the announcement itself is always the game's.
   */
  const [endCharacter, setEndCharacter] = useState<{
    name: string;
    src: string | null;
    kind: CharacterAssetKind | null;
  } | null>(null);
  useEffect(() => {
    const treasure = activeRoute[activeRoute.length - 1] ?? null;
    const wantedId = activeGame?.endCharacterAssetId || treasure?.characterAssetId || null;
    if (!wantedId) {
      setEndCharacter(null);
      return;
    }
    let mounted = true;
    loadCharacterAssets()
      .then(assets => {
        if (!mounted) return;
        const asset = assets.find(candidate => candidate.id === wantedId) ?? null;
        setEndCharacter({
          name: asset?.name ?? treasure?.name ?? '',
          // 3D models have no player here; photos and clips render straight in.
          src: asset && asset.kind !== 'model' ? asset.src : null,
          kind: asset?.kind ?? null,
        });
      })
      .catch(loadError => {
        console.warn('Could not load the end-of-hunt character:', loadError);
        if (mounted) setEndCharacter(null);
      });
    return () => {
      mounted = false;
    };
  }, [activeGame?.endCharacterAssetId, activeRoute]);

  /** The end character's media, shared by the completion card and the modal. */
  const endCharacterMedia = endCharacter?.src ? (
    endCharacter.kind === 'video' ? (
      <video
        src={endCharacter.src}
        autoPlay
        muted
        loop
        playsInline
        aria-label={endCharacter.name ? `End-of-hunt character: ${endCharacter.name}` : 'End-of-hunt character'}
        style={{
          display: 'block',
          width: '100%',
          maxHeight: 240,
          objectFit: 'contain',
          borderRadius: 12,
          background: '#000',
          marginTop: 12,
        }}
      />
    ) : (
      <img
        src={endCharacter.src}
        alt={endCharacter.name || 'End-of-hunt character'}
        style={{
          display: 'block',
          width: '100%',
          maxHeight: 240,
          objectFit: 'contain',
          borderRadius: 12,
          marginTop: 12,
        }}
      />
    )
  ) : null;

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
  /**
   * Route-aware opening-stop check: teams get a shuffled route, so the stop the
   * round opens with is this team's first dealt stop, not authored order 1.
   */
  const firstStop = activeRoute[0] ?? null;
  const isFirstStop = Boolean(currentCharacter && firstStop?.id === currentCharacter.id);

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

      {/* --- Round start: first location + camera check --------------------
          The team's first package is already in hand before anything is
          walked: the first location's hint (below, in the target card), its
          character (named here, with its clip when it has one) and its key (in
          the bar above). The clip doubles as the device check — if it renders
          and the AR camera shows the live feed, the team is ready to walk. */}
      {!isComplete && foundCount === 0 && currentCharacter && (
        <div className="card" style={{ marginBottom: 16 }}>
          <span className="sectionLabel">Before you start — camera check</span>
          <p className="cardSubtitle" style={{ marginTop: 6 }}>
            Handed to you before you take a step: the clue to your first location, the character
            you will meet there and the key that opens it. Open the AR camera to confirm this
            device shows the live feed — then follow the clue to{' '}
            <strong>{currentCharacter.name}</strong> and present the key when you arrive.
          </p>
          {startClipSrc && (
            <video
              src={startClipSrc}
              autoPlay
              muted
              loop
              playsInline
              aria-label="Preview of the character waiting at your first location"
              style={{
                display: 'block',
                width: '100%',
                maxHeight: 260,
                objectFit: 'contain',
                borderRadius: 12,
                background: '#000',
                marginTop: 12,
              }}
            />
          )}
          <button
            type="button"
            className="btnGhost"
            style={{ marginTop: 12, width: '100%' }}
            onClick={() => setArOpen(true)}
          >
            <Camera size={16} /> Open AR camera — check your feed
          </button>
        </div>
      )}

      {isComplete || !currentCharacter ? (
        <div className="card playComplete">
          <PartyPopper size={34} color="var(--amber)" />
          <h2 className="victoryHeading" style={{ marginTop: 12 }}>
            Hunt complete!
          </h2>
          {endCharacterMedia}
          {endCharacter?.name && (
            <p className="sectionLabel" style={{ marginTop: 10 }}>
              {endCharacter.name}
            </p>
          )}
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
                <span className="sectionLabel">Clue — leads to this location</span>
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
                    <span>{`${Math.round(radar.bearingDegrees)}°`}</span>
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
                {`At ${currentCharacter.name}, the key is presented on the AR camera frame.`}
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
            /* Handed over but not reached: this stop's name, line and clue were
               all given to the team before they started walking (at the hunt's
               opening for the first, by the reveal at the stop before it
               otherwise). Walking is what finds the place, so distance and
               bearing stay behind the explicit location check below. */
            <div className="card targetCard" style={{ borderColor: '#334155' }}>
              <div className="targetHeader">
                <div
                  className="targetAvatar"
                  style={{ background: 'rgba(148, 163, 184, 0.12)', borderColor: '#334155' }}
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
                <span className="sectionLabel">Clue — leads to this location</span>
                {/* Routes are shuffled per team, so the reliable way to point a
                    player at their next stop is the target's own hint: it was
                    handed over with this stop's character and key, and it
                    describes the place the radar is pointing at. */}
                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
                  {currentCharacter.hint}
                </p>
                <p className="fieldHelp">
                  Given to you with {currentCharacter.name}&apos;s name and the key in the bar
                  above {isFirstStop ? 'when the hunt opened' : 'by the reveal at your last stop'}{' '}
                  — follow the clue to the location, then present the key on the camera frame.
                </p>
              </div>

              <div className="hudLockedBar">
                <Lock size={14} />
                {!radar
                  ? 'Waiting for your location — enable GPS to start the hunt.'
                  : 'The character appears once you walk into its discovery zone.'}
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
              {activeRoute.map((ch, index) => {
                const isDone = activeProgress.discoveredCharacterIds.includes(ch.id);
                const isCurrent = ch.id === currentCharacter.id;
                // The hunt ends on the last stop of THIS team's route: the tagged
                // treasure, or — for a hunt that tags none — whichever location
                // their dealt order happened to finish on.
                const isEndStop = index === activeRoute.length - 1;
                // Strict visibility: only what the team has been given shows —
                // every stop they have cleared, plus the current one, whose
                // name and line arrive with the hand-over (at the hunt's opening
                // for the first stop, at the previous reveal otherwise). Stops
                // beyond their next stay anonymous until they reach them.
                const isRevealed = isDone || isCurrent;
                return (
                  <li
                    key={ch.id}
                    className={`routeItem${isCurrent ? ' routeItemCurrent' : ''}${
                      isDone ? ' routeItemDone' : ''
                    }`}
                  >
                    <span className="routeIndex">{isDone ? '✓' : index + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="routeName">
                        {isRevealed ? ch.name : '???'}
                        {isCurrent && inRange && <span className="pill pillActive">Now</span>}
                        {isEndStop && (
                          <span
                            className="pill"
                            title="Where the hunt ends — the last stop of your route"
                          >
                            🎁 Treasure
                          </span>
                        )}
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
          {endCharacterMedia}
          {endCharacter?.name && (
            <p className="sectionLabel" style={{ marginTop: 10 }}>
              {endCharacter.name}
            </p>
          )}
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

