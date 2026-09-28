'use client';

import { useEffect, useMemo, useState } from 'react';
import { Box, Image as ImageIcon, MapPin, Sparkles, RefreshCw, KeyRound } from 'lucide-react';
import type { HuntCharacter, HuntCharacterType } from '../types/hunt';
import type { LocationCoordinates } from '../types/game';
import type { CharacterAsset } from '../services/characterAssets';
import { loadCharacterAssets } from '../services/characterAssets';
import { Modal } from './Modal';
import { CharacterPinMap } from './CharacterPinMap';
import { PlaceSearchBox } from './PlaceSearchBox';
import { generateCharacterKey } from '../utils/keys';

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

/** Character editor, ported from `CharacterEditorModal.tsx`. */
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
  const [dialogue, setDialogue] = useState(initial?.dialogue ?? '');
  const [characterType, setCharacterType] = useState<HuntCharacterType>(
    initial?.characterType ?? 'guardian'
  );
  const [characterAssetId, setCharacterAssetId] = useState<string | null>(
    initial?.characterAssetId ?? null
  );
  const [characterAssets, setCharacterAssets] = useState<CharacterAsset[]>([]);
  const [rosterState, setRosterState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
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

  const selectedCharacterAsset = useMemo(
    () => characterAssets.find(asset => asset.id === characterAssetId) ?? null,
    [characterAssets, characterAssetId]
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
    setDialogue(initial?.dialogue ?? '');
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

  const handleSave = () => {
    if (!name.trim()) {
      setError('Give the character a name.');
      return;
    }
    if (!dialogue.trim()) {
      setError('Write what the character says when found.');
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
      hint: hint.trim(),
      dialogue: dialogue.trim(),
      key: characterKey.trim() || generateCharacterKey(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit Character' : 'Add Character'}
      icon={<Sparkles size={18} />}
      accentColor="var(--amber)"
    >
      <div className="field">
        <label className="fieldLabel" htmlFor="char-name">
          Character Name *
        </label>
        <input
          id="char-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Bronze Sentinel"
        />
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
      </div>

      <div className="field">
        <span className="fieldLabel" id="camera-character-label">
          <Box size={12} /> Camera Character
        </span>
        <div className="rosterSection" role="group" aria-labelledby="camera-character-label">
          <div className="rosterSectionTitle">Built-in characters</div>
          <div className="rosterGrid rosterGridBuiltIn">
            {CHARACTER_TYPES.map(characterTypeOption => {
              const selected = characterAssetId === null;
              return (
                <button
                  key={characterTypeOption.value}
                  type="button"
                  className={`rosterCard rosterCardCompact${selected ? ' rosterCardSelected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => {
                    setCharacterType(characterTypeOption.value);
                    setCharacterAssetId(null);
                  }}
                >
                  <span className="rosterGlyph" aria-hidden="true">
                    {characterTypeOption.glyph}
                  </span>
                  <span>{characterTypeOption.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rosterSection">
          <div className="rosterSectionTitle">Camera roster</div>
          {rosterState === 'loading' && <p className="fieldHelp">Loading camera characters…</p>}
          {rosterState === 'error' && (
            <div className="rosterNotice" role="status">
              The camera roster could not load. Built-in characters are still available.
            </div>
          )}
          {rosterState === 'ready' && characterAssets.length === 0 && (
            <p className="fieldHelp">No custom camera characters are installed yet.</p>
          )}
          {characterAssets.length > 0 && (
            <div className="rosterGrid">
              {characterAssets.map(asset => {
                const selected = asset.id === characterAssetId;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={`rosterCard${selected ? ' rosterCardSelected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => {
                      setCharacterType(asset.fallbackType);
                      setCharacterAssetId(asset.id);
                    }}
                  >
                    <span
                      className={`rosterPreview rosterPreview${
                        asset.kind === 'model' ? 'Model' : asset.kind === 'video' ? 'Video' : 'Image'
                      }`}
                      style={
                        asset.kind === 'image'
                          ? { backgroundImage: `url(${JSON.stringify(asset.src).slice(1, -1)})` }
                          : undefined
                      }
                      aria-hidden="true"
                    >
                      {asset.kind === 'image' ? null : asset.kind === 'video' ? (
                        <video
                          className="rosterPreviewClip"
                          src={asset.src}
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          tabIndex={-1}
                        />
                      ) : (
                        <Box size={30} />
                      )}
                    </span>
                    <span className="rosterCopy">
                      <strong>{asset.name}</strong>
                      <span className="rosterKind">
                        {asset.kind === 'model'
                          ? '3D model'
                          : asset.kind === 'video'
                            ? 'Cutout video'
                            : 'Photo cutout'}{' '}
                        · {asset.realHeightM}m
                      </span>
                      {asset.description && <span>{asset.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="fieldHelp">
            The selected roster character appears through the player&apos;s camera at the map pin.
            Its built-in style is used for the map glyph and as a fallback.
          </p>
        </div>
      </div>

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
        <label className="fieldLabel" htmlFor="char-key">
          <KeyRound size={12} /> Discovery Key
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
          Players must present this key to discover the character. Hand the first character's key
          to players yourself to start the hunt — each character gives the next key when found.
        </p>
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="char-hint">
          Clue Hint
        </label>
        <textarea
          id="char-hint"
          className="textarea"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="Look for the tall bronze figure guarding the old entrance."
        />
      </div>

      <div className="field">
        <label className="fieldLabel" htmlFor="char-dialogue">
          Dialogue on Discovery *
        </label>
        <textarea
          id="char-dialogue"
          className="textarea"
          value={dialogue}
          onChange={(e) => setDialogue(e.target.value)}
          placeholder="I have guarded this gate for four centuries. The next sentinel waits by the fountain."
        />
      </div>

      {error && <div className="banner bannerWarn">{error}</div>}

      <div className="modalActions">
        <button type="button" className="btnGhost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btnAmber" onClick={handleSave}>
          {initial ? 'Save Changes' : 'Add to Hunt'}
        </button>
      </div>
    </Modal>
  );
}