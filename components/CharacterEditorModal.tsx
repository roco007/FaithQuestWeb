'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Image as ImageIcon,
  MapPin,
  Sparkles,
  RefreshCw,
  KeyRound,
  Megaphone,
  ListChecks,
  CheckCircle2,
  Gift,
  Plus,
  X,
} from 'lucide-react';
import type { HuntCharacter, HuntCharacterType, HuntQuestion, HuntQuestionType } from '../types/hunt';
import type { LocationCoordinates } from '../types/game';
import type { CharacterAsset } from '../services/characterAssets';
import { loadCharacterAssets } from '../services/characterAssets';
import type { SponsorBanner } from '../services/sponsorBanners';
import { encodePublicPath, loadSponsorBanners } from '../services/sponsorBanners';
import { Modal } from './Modal';
import { CharacterPinMap } from './CharacterPinMap';
import { PlaceSearchBox } from './PlaceSearchBox';
import { generateCharacterKey } from '../utils/keys';
import {
  createQuestionId,
  isEmptyQuestion,
  newMcqQuestion,
  newTextQuestion,
  questionValidationError,
} from '../utils/huntQuestions';

const CHARACTER_TYPES: { value: HuntCharacterType; label: string; glyph: string }[] = [
  { value: 'guardian', label: 'Guardian', glyph: '🛡' },
  { value: 'angel', label: 'Angel', glyph: '👼' },
  { value: 'monk', label: 'Monk', glyph: '📿' },
  { value: 'flame', label: 'Eternal Flame', glyph: '🔥' },
  { value: 'oracle', label: 'Oracle', glyph: '🔮' },
];

interface CharacterEditorModalProps {
  open: boolean;
  /** Existing character when editing; null when adding a new one. */
  initial: HuntCharacter | null;
  /** Default map centre for new characters (typically the player's position). */
  defaultLatitude: number;
  defaultLongitude: number;
  /** The creator's live position — drawn on the pin map for reference. */
  currentLocation?: LocationCoordinates | null;
  onClose: () => void;
  onSave: (character: HuntCharacter) => void;
}

let nextLocalId = 0;

function createLocalId(): string {
  nextLocalId += 1;
  return `char_${Date.now().toString(36)}_${nextLocalId}`;
}

/**
 * Location editor: where a location is, the hint that leads to it, the
 * character that appears there, the questions asked there and the key that
 * unlocks them — the four params a hunt location is authored with (H, C, Q, K).
 */
export function CharacterEditorModal({
  open,
  initial,
  defaultLatitude,
  defaultLongitude,
  currentLocation,
  onClose,
  onSave,
}: CharacterEditorModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '');
  const [hint, setHint] = useState(initial?.hint ?? '');
  const [characterType, setCharacterType] = useState<HuntCharacterType>(
    initial?.characterType ?? 'guardian'
  );
  const [characterAssetId, setCharacterAssetId] = useState<string | null>(
    initial?.characterAssetId ?? null
  );
  const [characterAssets, setCharacterAssets] = useState<CharacterAsset[]>([]);
  const [rosterState, setRosterState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [sponsorBannerId, setSponsorBannerId] = useState<string | null>(
    initial?.sponsorBannerId ?? null
  );
  const [sponsorBanners, setSponsorBanners] = useState<SponsorBanner[]>([]);
  const [sponsorState, setSponsorState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [latitude, setLatitude] = useState(initial?.latitude ?? defaultLatitude);
  const [longitude, setLongitude] = useState(initial?.longitude ?? defaultLongitude);
  // Text mirrors of the coordinates so latitude/longitude can be typed
  // manually; the numeric states only advance on valid values (keeping the
  // pin stable while a partial value is being typed).
  const [latText, setLatText] = useState(String(initial?.latitude ?? defaultLatitude));
  const [lonText, setLonText] = useState(String(initial?.longitude ?? defaultLongitude));
  const [altitudeMeters, setAltitudeMeters] = useState(initial?.altitudeMeters ?? 0);
  const [radiusMeters, setRadiusMeters] = useState(initial?.radiusMeters ?? 25);
  const [characterKey, setCharacterKey] = useState(initial?.key ?? generateCharacterKey());
  /** Reveal questions asked after the key is accepted (see `HuntQuestion`). */
  const [questions, setQuestions] = useState<HuntQuestion[]>(initial?.questions ?? []);
  /**
   * The hunt's treasure location — where every team's route ends. Tick at most
   * one; when none is ticked, the hunt's last location is the treasure (see
   * `normaliseGame`).
   */
  const [isTreasure, setIsTreasure] = useState(
    (initial?.isTreasure ?? initial?.isCongratulations) === true
  );
  // Name of the place chosen via search, shown back so the creator can see what
  // they picked; cleared as soon as they adjust the pin by hand.
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Single entry point for moving the character, shared by the map (click and
   * drag) and place search so both round to the same precision and keep the
   * text fields in step with the numeric state.
   */
  const applyCoordinates = (lat: number, lon: number) => {
    const la = Number(lat.toFixed(6));
    const lo = Number(lon.toFixed(6));
    setLatitude(la);
    setLongitude(lo);
    setLatText(String(la));
    setLonText(String(lo));
    // A manual adjustment supersedes whatever search had placed, so the
    // "Placed at …" confirmation stops claiming a place that no longer applies.
    setPlaceLabel(null);
  };

  // The roster is deployment-owned and cached for the browser session. Keep the
  // existing procedural character available if the manifest or an asset fails.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setRosterState(current => (current === 'ready' ? current : 'loading'));
    loadCharacterAssets()
      .then(assets => {
        if (!active) return;
        setCharacterAssets(assets);
        setRosterState('ready');
      })
      .catch(loadError => {
        if (!active) return;
        console.warn('Could not load camera character roster:', loadError);
        setCharacterAssets([]);
        setRosterState('error');
      });
    return () => {
      active = false;
    };
  }, [open]);

  // Sponsor banners are deployment-owned like the character roster. Absence
  // simply means "no advertising for this character" and keeps current layout.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setSponsorState(current => (current === 'ready' ? current : 'loading'));
    loadSponsorBanners()
      .then(banners => {
        if (!active) return;
        setSponsorBanners(banners);
        setSponsorState('ready');
      })
      .catch(loadError => {
        if (!active) return;
        console.warn('Could not load sponsor banner roster:', loadError);
        setSponsorBanners([]);
        setSponsorState('error');
      });
    return () => {
      active = false;
    };
  }, [open]);

  const selectedCharacterAsset = useMemo(
    () => characterAssets.find(asset => asset.id === characterAssetId) ?? null,
    [characterAssets, characterAssetId]
  );

  const selectedSponsorBanner = useMemo(
    () => sponsorBanners.find(banner => banner.id === sponsorBannerId) ?? null,
    [sponsorBanners, sponsorBannerId]
  );

  // Re-seed the form each time the modal opens (reset-on-open), including
  // consecutive ADD flows where `initial` is null both times — comparing only
  // `initial` identity would leak the previous character's values (and key)
  // into the next one. Also re-seeds if the target character changes while open.
  const [wasOpen, setWasOpen] = useState(false);
  const [lastOpenFor, setLastOpenFor] = useState<HuntCharacter | null | undefined>(undefined);
  const needsSeed = open && (!wasOpen || lastOpenFor !== initial);
  if (needsSeed) {
    setWasOpen(true);
    setLastOpenFor(initial);
    setName(initial?.name ?? '');
    setSubtitle(initial?.subtitle ?? '');
    setHint(initial?.hint ?? '');
    setCharacterType(initial?.characterType ?? 'guardian');
    setCharacterAssetId(initial?.characterAssetId ?? null);
    const seedLat = initial?.latitude ?? defaultLatitude;
    const seedLon = initial?.longitude ?? defaultLongitude;
    setLatitude(seedLat);
    setLongitude(seedLon);
    setLatText(String(seedLat));
    setLonText(String(seedLon));
    setAltitudeMeters(initial?.altitudeMeters ?? 0);
    setRadiusMeters(initial?.radiusMeters ?? 25);
    setCharacterKey(initial?.key ?? generateCharacterKey());
    setQuestions(initial?.questions ?? []);
    setSponsorBannerId(initial?.sponsorBannerId ?? null);
    setIsTreasure((initial?.isTreasure ?? initial?.isCongratulations) === true);
    setError(null);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  /** Applies manually typed coordinates — the pin follows once they're valid. */
  const handleLatitudeText = (raw: string) => {
    setLatText(raw);
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n) && n >= -90 && n <= 90) setLatitude(n);
  };
  const handleLongitudeText = (raw: string) => {
    setLonText(raw);
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n) && n >= -180 && n <= 180) setLongitude(n);
  };

  /** Replaces one question in the reveal-gate list. */
  const setQuestionAt = (index: number, next: HuntQuestion) => {
    setQuestions(prev => prev.map((question, i) => (i === index ? next : question)));
  };

  /**
   * Swapping a question's type keeps its id and prompt and re-seeds the answer
   * shape — typed answers and choices don't carry across, since what "correct"
   * means is entirely different.
   */
  const handleQuestionTypeChange = (index: number, type: HuntQuestionType) => {
    const current = questions[index];
    if (!current || current.type === type) return;
    const template = type === 'mcq' ? newMcqQuestion() : newTextQuestion();
    setQuestionAt(index, { ...template, id: current.id, prompt: current.prompt });
  };

  const handleSave = () => {
    if (!name.trim()) {
      setError('Give the character a name.');
      return;
    }
    if (!hint.trim()) {
      setError('Write the hint that leads players to this location.');
      return;
    }
    const latNum = Number(latText.trim());
    const lonNum = Number(lonText.trim());
    if (latText.trim() === '' || !Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      setError('Latitude must be a number between -90 and 90.');
      return;
    }
    if (lonText.trim() === '' || !Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
      setError('Longitude must be a number between -180 and 180.');
      return;
    }

    // Drop questions that were added but never typed into, then validate the
    // rest — a half-filled question would ship as an unanswerable gate.
    const finalQuestions: HuntQuestion[] = questions
      .filter(question => !isEmptyQuestion(question))
      .map((question): HuntQuestion => {
        const prompt = question.prompt.trim();
        if (question.type === 'text') {
          return {
            id: question.id,
            type: 'text',
            prompt,
            answers: (question.answers ?? []).map(answer => answer.trim()).filter(Boolean),
          };
        }
        return {
          id: question.id,
          type: 'mcq',
          prompt,
          options: (question.options ?? []).map(option => ({ ...option, text: option.text.trim() })),
        };
      });
    for (const question of finalQuestions) {
      const problem = questionValidationError(question);
      if (problem) {
        setError(problem);
        return;
      }
    }

    onSave({
      id: initial?.id ?? createLocalId(),
      order: initial?.order ?? 0,
      name: name.trim(),
      subtitle: subtitle.trim(),
      latitude,
      longitude,
      altitudeMeters,
      radiusMeters,
      characterType,
      ...(characterAssetId ? { characterAssetId } : {}),
      ...(sponsorBannerId ? { sponsorBannerId } : {}),
      hint: hint.trim(),
      key: characterKey.trim() || generateCharacterKey(),
      // Omitted entirely when empty, so key-only characters keep the exact
      // pre-questions shape in storage and exports.
      ...(finalQuestions.length > 0 ? { questions: finalQuestions } : {}),
      // Omitted when unchecked, so un-flagging clears the field entirely.
      ...(isTreasure ? { isTreasure: true } : {}),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Location' : 'Add Location'}
      icon={<Sparkles size={18} />}
      accentColor="var(--amber)"
    >
      <div className="field">
        <span className="fieldLabel">
          <MapPin size={12} /> Placement — search a place, click the map, drag the pin, or
          type coordinates below
        </span>
        <PlaceSearchBox
          id="char-place-search"
          placeholder="Search for a place or address…"
          bias={currentLocation}
          onSelect={(lat, lon, label) => {
            applyCoordinates(lat, lon);
            setPlaceLabel(label);
          }}
        />
        {placeLabel && <div className="placeSearchPicked">Placed at {placeLabel}</div>}
        <CharacterPinMap
          latitude={latitude}
          longitude={longitude}
          radiusMeters={radiusMeters}
          characterType={characterType}
          name={name || 'New character'}
          currentLocation={currentLocation}
          onCoordinatesChange={applyCoordinates}
        />
        <div className="formRow">
          <div className="field">
            <label className="fieldLabel" htmlFor="char-latitude">
              Latitude
            </label>
            <input
              id="char-latitude"
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              min={-90}
              max={90}
              value={latText}
              onChange={(e) => handleLatitudeText(e.target.value)}
              placeholder="37.774929"
              aria-label="Latitude"
            />
          </div>
          <div className="field">
            <label className="fieldLabel" htmlFor="char-longitude">
              Longitude
            </label>
            <input
              id="char-longitude"
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              min={-180}
              max={180}
              value={lonText}
              onChange={(e) => handleLongitudeText(e.target.value)}
              placeholder="-122.419416"
              aria-label="Longitude"
            />
          </div>
        </div>
      </div>

      <div className="formRow">
        <div className="field">
          <label className="fieldLabel" htmlFor="char-radius">
            Discovery Radius (m)
          </label>
          <input
            id="char-radius"
            className="input"
            type="number"
            min={5}
            max={200}
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value) || 25)}
          />
        </div>
        <div className="field">
          <label className="fieldLabel" htmlFor="char-altitude">
            Height Above Ground (m)
          </label>
          <input
            id="char-altitude"
            className="input"
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={altitudeMeters}
            onChange={(e) => setAltitudeMeters(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="char-hint">
          Hint That Leads Here *
        </label>
        <textarea
          id="char-hint"
          className="textarea"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="Look for the tall bronze figure guarding the old entrance."
        />
        <p className="fieldHelp">
          The clue players follow to reach this location: they are handed it one stop early —
          when the hunt opens if it is their first, otherwise by the reveal at the stop before —
          so it is the clue on screen while they walk. Write it about the place, not the
          character.
        </p>
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="char-camera">
          <Box size={12} /> Character That Appears Here
        </label>
        <select
          id="char-camera"
          className="input"
          value={characterAssetId !== null ? `asset:${characterAssetId}` : `type:${characterType}`}
          onChange={e => {
            const picked = e.target.value;
            if (picked.startsWith('asset:')) {
              const assetId = picked.slice('asset:'.length);
              setCharacterAssetId(assetId);
              // The pin's glyph and accent follow the chosen asset's fallback style.
              const asset = characterAssets.find(candidate => candidate.id === assetId);
              if (asset) setCharacterType(asset.fallbackType);
              return;
            }
            const builtin = CHARACTER_TYPES.find(option => `type:${option.value}` === picked);
            if (!builtin) return;
            setCharacterAssetId(null);
            setCharacterType(builtin.value);
          }}
        >
          <optgroup label="Built-in characters">
            {CHARACTER_TYPES.map(characterTypeOption => (
              <option key={characterTypeOption.value} value={`type:${characterTypeOption.value}`}>
                {characterTypeOption.glyph} {characterTypeOption.label}
              </option>
            ))}
          </optgroup>
          {characterAssets.length > 0 && (
            <optgroup label="Camera roster">
              {characterAssets.map(asset => (
                <option key={asset.id} value={`asset:${asset.id}`}>
                  {asset.name}
                </option>
              ))}
            </optgroup>
          )}
          {/* Keep a saved roster entry selectable while the manifest loads or fails. */}
          {characterAssetId !== null &&
            !characterAssets.some(asset => asset.id === characterAssetId) && (
              <option value={`asset:${characterAssetId}`}>
                Saved camera character ({characterAssetId})
              </option>
            )}
        </select>
        {rosterState === 'loading' && <p className="fieldHelp">Loading camera characters…</p>}
        {rosterState === 'error' && (
          <div className="rosterNotice" role="status">
            The camera roster could not load. Built-in characters are still available.
          </div>
        )}
        {rosterState === 'ready' && characterAssets.length === 0 && (
          <p className="fieldHelp">No custom camera characters are installed yet.</p>
        )}
        {selectedCharacterAsset && (
          <p className="fieldHelp">
            {selectedCharacterAsset.kind === 'model'
              ? '3D model'
              : selectedCharacterAsset.kind === 'video'
                ? 'Cutout video'
                : 'Photo cutout'}
            {' · '}
            {selectedCharacterAsset.realHeightM}m
            {selectedCharacterAsset.description ? ` — ${selectedCharacterAsset.description}` : ''}
          </p>
        )}
        <p className="fieldHelp">
          The character that appears at this location and plays its video: it is pinned here,
          seen through the player&apos;s camera on arrival, and speaks once the key is accepted
          and the questions below are answered. Its built-in style is used for the map glyph and
          as a fallback.
        </p>
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="char-name">
          Location Name *
        </label>
        <input
          id="char-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Old Bell Tower"
        />
        <p className="fieldHelp">
          What this place is called — the name of the location itself, so the hunt reads as a
          route of places rather than a cast of characters. Shown on the route card and the radar
          once the team holds this stop&apos;s clue, and it is what the exported hunt&apos;s order
          lists for this stop.
        </p>
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="char-subtitle">
          Subtitle
        </label>
        <input
          id="char-subtitle"
          className="input"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Keeper of the eastern gate"
        />
        <p className="fieldHelp">
          One short line under the name — a detail about the place or the character that guards
          it, e.g. <em>Keeper of the eastern gate</em>. Shown wherever the name is shown.
        </p>
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="char-sponsor">
          <Megaphone size={12} /> Sponsor Banner (optional)
        </label>
        <select
          id="char-sponsor"
          className="input"
          value={sponsorBannerId ?? ''}
          onChange={e => setSponsorBannerId(e.target.value || null)}
        >
          <option value="">No banner — hint above the head</option>
          {sponsorBanners.map(banner => (
            <option key={banner.id} value={banner.id}>
              {banner.name}
            </option>
          ))}
          {/* Keep a saved banner selectable while the manifest loads or fails. */}
          {sponsorBannerId !== null &&
            !sponsorBanners.some(banner => banner.id === sponsorBannerId) && (
              <option value={sponsorBannerId}>Saved banner ({sponsorBannerId})</option>
            )}
        </select>
        {sponsorState === 'loading' && <p className="fieldHelp">Loading sponsor banners…</p>}
        {sponsorState === 'error' && (
          <div className="rosterNotice" role="status">
            The sponsor banner roster could not load — this character keeps the default hint
            layout.
          </div>
        )}
        {sponsorState === 'ready' && sponsorBanners.length === 0 && (
          <p className="fieldHelp">No sponsor banners are installed yet.</p>
        )}
        {sponsorState === 'ready' &&
          sponsorBannerId !== null &&
          !sponsorBanners.some(banner => banner.id === sponsorBannerId) && (
            <div className="rosterNotice" role="status">
              The saved banner “{sponsorBannerId}” is no longer installed — the default hint
              layout will be used.
            </div>
          )}
        {selectedSponsorBanner && (
          <img
            className="sponsorBannerPreview"
            src={encodePublicPath(selectedSponsorBanner.src)}
            alt={selectedSponsorBanner.alt}
          />
        )}
        <p className="fieldHelp">
          A selected banner shows in a card above the character in the AR view — on its own
          before the key is entered, combined with the hint after it; with no banner the hint
          stays above the character&apos;s head.
        </p>
      </div>

      {/* Reveal-question gate: asked after the key matches and before the
          character's video unlocks. Optional — no questions means the
          key alone opens the character (the original behaviour). */}
      <div className="field">
        <span className="fieldLabel">
          <ListChecks size={12} /> Questions Asked Here (optional)
        </span>
        <p className="fieldHelp">
          Asked once the player presents this location's key and before its character speaks and
          plays its video — every question must be answered correctly to clear the location (and,
          on the treasure, to end the hunt). Leave this empty to let the key alone open the
          character.
        </p>

        {questions.map((question, qIndex) => (
          <div key={question.id} className="qEditorCard">
            <div className="qEditorHead">
              <span className="qEditorIndex">Question {qIndex + 1}</span>
              <div className="qTypeToggle" role="group" aria-label={`Question ${qIndex + 1} type`}>
                <button
                  type="button"
                  className={`qTypeBtn${question.type === 'text' ? ' qTypeBtnActive' : ''}`}
                  aria-pressed={question.type === 'text'}
                  onClick={() => handleQuestionTypeChange(qIndex, 'text')}
                >
                  Short answer
                </button>
                <button
                  type="button"
                  className={`qTypeBtn${question.type === 'mcq' ? ' qTypeBtnActive' : ''}`}
                  aria-pressed={question.type === 'mcq'}
                  onClick={() => handleQuestionTypeChange(qIndex, 'mcq')}
                >
                  Multiple choice
                </button>
              </div>
              <button
                type="button"
                className="iconBtn"
                aria-label={`Remove question ${qIndex + 1}`}
                onClick={() => setQuestions(prev => prev.filter((_, i) => i !== qIndex))}
              >
                <X size={14} />
              </button>
            </div>

            <input
              className="input"
              value={question.prompt}
              onChange={e => setQuestionAt(qIndex, { ...question, prompt: e.target.value })}
              placeholder="e.g. What did Jesus feed the five thousand with?"
              aria-label={`Question ${qIndex + 1} text`}
            />

            {question.type === 'text' ? (
              <>
                <input
                  className="input"
                  value={(question.answers ?? []).join(', ')}
                  onChange={e =>
                    // Split raw (no trim/filter) so a trailing comma or space
                    // the creator is still typing survives; empties are
                    // trimmed away in handleSave.
                    setQuestionAt(qIndex, { ...question, answers: e.target.value.split(',') })
                  }
                  placeholder="Accepted answers, separated by commas"
                  aria-label={`Question ${qIndex + 1} accepted answers`}
                />
                <p className="fieldHelp">
                  Letter case and extra spaces don't matter — and a near-miss still counts:
                  anything at least 80% similar to one of these is accepted.
                </p>
              </>
            ) : (
              <div className="qOptionsList">
                {(question.options ?? []).map((option, oIndex) => (
                  <div key={option.id} className="qOptionRow">
                    <button
                      type="button"
                      className={`qOptionCorrect${option.isCorrect ? ' qOptionCorrectOn' : ''}`}
                      aria-label={
                        option.isCorrect
                          ? 'Correct answer'
                          : `Mark option ${oIndex + 1} as correct`
                      }
                      title="Tap to mark the correct answer"
                      onClick={() =>
                        setQuestionAt(qIndex, {
                          ...question,
                          options: (question.options ?? []).map((candidate, i) => ({
                            ...candidate,
                            isCorrect: i === oIndex,
                          })),
                        })
                      }
                    >
                      <CheckCircle2 size={15} />
                    </button>
                    <input
                      className="input"
                      value={option.text}
                      onChange={e =>
                        setQuestionAt(qIndex, {
                          ...question,
                          options: (question.options ?? []).map((candidate, i) =>
                            i === oIndex ? { ...candidate, text: e.target.value } : candidate
                          ),
                        })
                      }
                      placeholder={`Option ${oIndex + 1}`}
                      aria-label={`Question ${qIndex + 1} option ${oIndex + 1}`}
                    />
                    {(question.options ?? []).length > 2 && (
                      <button
                        type="button"
                        className="iconBtn"
                        aria-label={`Remove option ${oIndex + 1}`}
                        onClick={() => {
                          const remaining = (question.options ?? []).filter(
                            (_, i) => i !== oIndex
                          );
                          // Removing the correct option re-marks the first
                          // survivor, so exactly-one-correct never breaks.
                          if (
                            option.isCorrect &&
                            remaining.length > 0 &&
                            !remaining.some(candidate => candidate.isCorrect)
                          ) {
                            remaining[0] = { ...remaining[0], isCorrect: true };
                          }
                          setQuestionAt(qIndex, { ...question, options: remaining });
                        }}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
                {(question.options ?? []).length < 6 && (
                  <button
                    type="button"
                    className="btnGhost qAddOption"
                    onClick={() =>
                      setQuestionAt(qIndex, {
                        ...question,
                        options: [
                          ...(question.options ?? []),
                          { id: createQuestionId(), text: '', isCorrect: false },
                        ],
                      })
                    }
                  >
                    <Plus size={13} /> Add option
                  </button>
                )}
                <p className="fieldHelp">Tap the tick to mark the one correct option.</p>
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          className="btnGhost"
          onClick={() => setQuestions(prev => [...prev, newTextQuestion()])}
        >
          <Plus size={14} /> Add question
        </button>
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="char-key">
          <KeyRound size={12} /> Key That Unlocks This Location
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="char-key"
            className="input mono"
            style={{ flex: 1, letterSpacing: 2 }}
            value={characterKey}
            onChange={(e) => setCharacterKey(e.target.value)}
            placeholder="K7M2QX"
            autoComplete="off"
            spellCheck={false}
            aria-label="Discovery key"
          />
          <button
            type="button"
            className="btnGhost"
            onClick={() => setCharacterKey(generateCharacterKey())}
            aria-label="Generate a new key"
          >
            <RefreshCw size={14} />
            New
          </button>
        </div>
        <p className="fieldHelp">
          Handed to each team one stop early: when the hunt opens if this is their first
          location, otherwise by the reveal that ends the stop before it. Present it on arrival
          to open this location&apos;s questions.
        </p>
      </div>

      <div className="field">
        <label
          className="fieldLabel"
          htmlFor="char-treasure"
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        >
          <input
            id="char-treasure"
            type="checkbox"
            checked={isTreasure}
            onChange={(e) => setIsTreasure(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--amber)' }}
          />
          <Gift size={12} /> This is the treasure location
        </label>
        <p className="fieldHelp">
          The place the hunt ends: it is never shuffled into a team&apos;s route — every route
          finishes here. Clearing this location&apos;s questions is what shows the congratulations
          screen, with the End-of-Hunt Announcement and the character chosen beside it. Tick one
          location only; if you tick none, the last location in the order is used instead.
        </p>
      </div>

      {error && <div className="banner bannerWarn">{error}</div>}

      <div className="modalActions">
        <button type="button" className="btnGhost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btnAmber" onClick={handleSave}>
          {initial ? 'Save Changes' : 'Add Location'}
        </button>
      </div>
    </Modal>
  );
}