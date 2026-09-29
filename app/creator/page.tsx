'use client';

import { useEffect, useMemo, useRef, useState, Suspense, type ChangeEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, ChevronUp, ChevronDown, Trash2, Pencil, Rocket, Share2, Wand2, Copy, Check, Link2, Download, Upload } from 'lucide-react';
import { useHunt } from '../../context/HuntContext';
import { useGame } from '../../context/GameContext';
import type { HuntCharacter, HuntGame, HuntGameDraft } from '../../types/hunt';
import type { CharacterAsset } from '../../services/characterAssets';
import { loadCharacterAssets } from '../../services/characterAssets';
import { CharacterEditorModal } from '../../components/CharacterEditorModal';
import { Modal } from '../../components/Modal';
import { buildGameJoinUrl, buildGameShareMessage, currentOrigin } from '../../services/shareGame';
import { downloadHuntGame, parseHuntGameJson, type ImportedHunt } from '../../services/huntFile';
import { triggerHaptic } from '../../utils/sound';

/** Character-type emoji, for the location list. */
const GLYPHS: Record<HuntCharacter['characterType'], string> = {
  guardian: '🛡',
  angel: '👼',
  monk: '📿',
  flame: '🔥',
  oracle: '🔮',
};

/** Game-creator editor: metadata + an ordered list of locations, each carrying
 *  its own hint, character, questions and key. Publishing assigns the hunt
 *  number players join with.
 *
 *  `useSearchParams` opts the page into client-side rendering, so Next requires a
 *  Suspense boundary around it to prerender the shell — see the wrapper below. */
function CreatorEditor() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');
  const { createdGames, createGame } = useHunt();
  const { userLocation } = useGame();

  const existing = useMemo(
    () => (id ? (createdGames.find((g) => g.id === id) ?? null) : null),
    [id, createdGames]
  );

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creatorName, setCreatorName] = useState('');
  const [endAnnouncement, setEndAnnouncement] = useState(
    'Congratulations, seeker! You have found the treasure. The hunt is complete!'
  );
  /**
   * The character shown with the end-of-hunt announcement: chosen next to it in
   * Game Details, required before publishing (see `normaliseGame`).
   */
  const [endCharacterAssetId, setEndCharacterAssetId] = useState<string | null>(null);
  /** Camera roster for the end-of-hunt character picker (deployment-owned). */
  const [endCharacterAssets, setEndCharacterAssets] = useState<CharacterAsset[]>([]);
  const [characters, setCharacters] = useState<HuntCharacter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [publishedGame, setPublishedGame] = useState<HuntGame | null>(null);
  const [copied, setCopied] = useState(false);
  /** Hunt loaded from an uploaded JSON file; feeds the draft's hunt number. */
  const [importedGame, setImportedGame] = useState<ImportedHunt | null>(null);
  /** Success feedback for the JSON import (failures go to `error`). */
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!existing) return;
    setTitle(existing.title);
    setDescription(existing.description);
    setCreatorName(existing.creatorName);
    setEndAnnouncement(existing.endAnnouncement);
    setEndCharacterAssetId(existing.endCharacterAssetId ?? null);
    setCharacters([...existing.characters]);
  }, [existing]);

  // The camera roster is deployment-owned; cached for the session. Needed by the
  // end-of-hunt character picker in Game Details (the location editor loads its
  // own copy when it opens).
  useEffect(() => {
    let active = true;
    loadCharacterAssets()
      .then(assets => {
        if (active) setEndCharacterAssets(assets);
      })
      .catch(loadError => {
        console.warn('Could not load camera character roster:', loadError);
        if (active) setEndCharacterAssets([]);
      });
    return () => {
      active = false;
    };
  }, []);

  /** Renumbers `order` to be a dense 1-based sequence after any edit. */
  const renumber = (list: HuntCharacter[]) => list.map((ch, i) => ({ ...ch, order: i + 1 }));

  const handleSaveCharacter = (character: HuntCharacter) => {
    setCharacters((prev) => {
      if (editingIndex !== null && prev[editingIndex]) {
        const next = [...prev];
        next[editingIndex] = { ...character, order: editingIndex + 1 };
        return next;
      }
      return [...prev, { ...character, order: prev.length + 1 }];
    });
    setEditorOpen(false);
    setEditingIndex(null);
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    triggerHaptic('light');
    setCharacters((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return renumber(next);
    });
  };

  const handleDeleteCharacter = (index: number) => {
    const character = characters[index];
    if (!window.confirm(`Remove "${character.name}" from the route?`)) return;
    triggerHaptic('warning');
    setCharacters((prev) => renumber(prev.filter((_, i) => i !== index)));
  };

  /**
   * Loads a hunt exported as JSON (see services/huntFile) straight into the
   * editor — details, locations, discovery keys and sponsor choices all come
   * from the file — so the creator can tweak or append locations and publish.
   * The file's hunt number flows into the draft: publishing keeps it when free
   * (so the same file works on any device) or replaces the local copy when a
   * game with that number already exists here.
   */
  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // Allow re-selecting the same file after a fix.
    if (!file) return;
    try {
      const imported = parseHuntGameJson(await file.text());
      setTitle(imported.title);
      setDescription(imported.description);
      setCreatorName(imported.creatorName);
      setEndAnnouncement(imported.endAnnouncement);
      setEndCharacterAssetId(imported.endCharacterAssetId ?? null);
      setCharacters(imported.characters);
      setImportedGame(imported);
      setError(null);
      const replacesLocal = Boolean(imported.id && createdGames.some((g) => g.id === imported.id));
      setNotice(
        replacesLocal
          ? `Loaded "${imported.title}" from ${file.name}. Hunt number ${imported.id} already exists on this device — publishing will replace that copy.`
          : `Loaded "${imported.title}" from ${file.name} — ${imported.characters.length} location${imported.characters.length === 1 ? '' : 's'}. Review the locations, make any edits, then publish.`
      );
      triggerHaptic('success');
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : 'Could not read that file.');
      triggerHaptic('error');
    }
  };

  const handlePublish = async () => {
    if (saving) return;
    if (!title.trim()) {
      setError('Give your game a title.');
      return;
    }
    if (characters.length === 0) {
      setError('Place at least one location on the map.');
      return;
    }
    if (!characters.some((character) => character.isTreasure || character.isCongratulations)) {
      setError(
        'Mark the treasure location: edit the location your hunt ends at and tick "This is the treasure location".'
      );
      return;
    }
    if (!endAnnouncement.trim()) {
      setError('Write the end-of-hunt announcement.');
      return;
    }
    if (!endCharacterAssetId) {
      setError('Choose the end-of-hunt character: the character shown with the announcement.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const draft: HuntGameDraft = {
        // Edit mode keeps its number; an imported file keeps the number it
        // carries (free → adopted, taken → replaces the local copy via the
        // repository's upsert); a brand-new hunt gets the next free number.
        id: existing?.id ?? importedGame?.id,
        createdAt: importedGame?.createdAt,
        title,
        description,
        creatorName,
        endAnnouncement,
        endCharacterAssetId,
        characters,
      };
      triggerHaptic('success');
      const game = await createGame(draft);
      setPublishedGame(game);
      // First publish: claim the edit URL so another Save updates this hunt
      // instead of allocating a duplicate number. The JSON file is exported
      // on demand from the share sheet's "Download JSON" button — never
      // automatically.
      if (!existing) {
        router.replace(`/creator?id=${game.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the game.');
      triggerHaptic('error');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyShare = async () => {
    if (!publishedGame) return;
    try {
      await navigator.clipboard.writeText(buildGameShareMessage(publishedGame, currentOrigin()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the share text stays selectable on screen.
      setError('Copy was blocked by the browser — select the code manually.');
    }
  };

  /**
   * Copies just the join link. This is the artefact players actually want: it
   * carries the hunt with it, so opening it lands them on the Hunts screen with
   * a "do you want to join?" prompt — no pasting, no backend.
   */
  const handleCopyLink = async () => {
    if (!publishedGame) return;
    try {
      await navigator.clipboard.writeText(buildGameJoinUrl(publishedGame, currentOrigin()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy was blocked by the browser — select the link manually.');
    }
  };

  /** Invite link shown in the publish sheet, rebuilt on every render so it always
   *  matches the origin the creator is actually browsing on. */
  const joinUrl = publishedGame ? buildGameJoinUrl(publishedGame, currentOrigin()) : '';

  return (
    <div className="page">
      <div className="pageHeader">
        <div className="pageHeaderRow">
          <div className="pageHeaderIcon" style={{ color: 'var(--amber)' }}>
            <Wand2 size={26} />
          </div>
          <div>
            <h1 className="pageTitle">{existing ? 'Edit Game' : 'Create Game'}</h1>
            <p className="pageSubtitle">
              {existing
                ? `Editing ${existing.id}. Changes apply to future joins.`
                : 'Author a hunt by placing locations along a real-world route. Players walk them in the order their own route deals.'}
            </p>
          </div>
        </div>
      </div>

      {error && <div className="banner bannerWarn">{error}</div>}
      {notice && <div className="banner bannerInfo">{notice}</div>}

      <div className="card formCard">
        <div className="sectionHeader" style={{ margin: '0 0 6px' }}>
          <h2 className="sectionLabel" style={{ marginBottom: 0 }}>
            Game Details
          </h2>
          {!existing && (
            <button
              type="button"
              className="btnGhost"
              onClick={() => fileInputRef.current?.click()}
              title="Load a hunt exported as JSON"
            >
              <Upload size={15} />
              Import JSON
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        <div className="field">
          <label className="fieldLabel" htmlFor="game-title">
            Game Title *
          </label>
          <input
            id="game-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sanctuary of the Seven Wells"
          />
        </div>
        <div className="field">
          <label className="fieldLabel" htmlFor="game-desc">
            Description
          </label>
          <textarea
            id="game-desc"
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A walking pilgrimage through the old quarter, following the guardians of the seven wells."
          />
        </div>
        <div className="formRow">
          <div className="field">
            <label className="fieldLabel" htmlFor="game-creator">
              Creator Name
            </label>
            <input
              id="game-creator"
              className="input"
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              placeholder="Youth Ministry"
            />
          </div>
          <div className="field">
            <label className="fieldLabel" htmlFor="game-end">
              End-of-Hunt Announcement *
            </label>
            <input
              id="game-end"
              className="input"
              value={endAnnouncement}
              onChange={(e) => setEndAnnouncement(e.target.value)}
            />
          </div>
        </div>
        {/* The congratulations screen is the announcement plus the character
            shown with it, so the character is chosen right beside it. */}
        <div className="field">
          <label className="fieldLabel" htmlFor="game-end-character">
            End-of-Hunt Character *
          </label>
          <select
            id="game-end-character"
            className="input"
            value={endCharacterAssetId ?? ''}
            onChange={(e) => setEndCharacterAssetId(e.target.value || null)}
          >
            <option value="">Choose the character shown at the end…</option>
            {endCharacterAssets.map(asset => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
            {/* Keep a saved choice selectable while the manifest loads or fails. */}
            {endCharacterAssetId && !endCharacterAssets.some(asset => asset.id === endCharacterAssetId) && (
              <option value={endCharacterAssetId}>
                Saved camera character ({endCharacterAssetId})
              </option>
            )}
          </select>
          <p className="fieldHelp">
            Shown together with the announcement when a team clears the treasure location —
            the hunt needs both a message and a character to celebrate with.
          </p>
        </div>
      </div>

      <div className="sectionHeader">
        <h2 className="sectionLabel" style={{ marginBottom: 0 }}>
          Location Route ({characters.length})
        </h2>
        <button
          type="button"
          className="btnGhost"
          onClick={() => {
            setEditingIndex(null);
            setEditorOpen(true);
          }}
        >
          <Plus size={15} />
          Add Location
        </button>
      </div>

      {characters.length === 0 ? (
        <div className="card emptyState">
          <div className="emptyTitle">No locations placed yet</div>
          <p style={{ fontSize: 13, marginBottom: 14 }}>
            Add your first location — its hint, the character that appears there, its questions
            and the key that opens them — then click the map to pin it.
          </p>
          <button
            type="button"
            className="btnPrimary"
            onClick={() => {
              setEditingIndex(null);
              setEditorOpen(true);
            }}
          >
            <Plus size={15} />
            Add Location
          </button>
        </div>
      ) : (
        <div className="charList">
          {characters.map((character, index) => (
            <div key={character.id} className="card charRow">
              <span className="charOrder">{index + 1}</span>
              <span className="charGlyph" aria-hidden="true">
                {GLYPHS[character.characterType]}
              </span>
              <div className="charInfo">
                <div className="charName">
                  <span className="charNameText">{character.name}</span>
                  {character.key && (
                    <span
                      className="keyChip mono"
                      title="The key that unlocks this location's questions — handed to each team one stop early (at the start for their first location)"
                    >
                      {character.key}
                    </span>
                  )}
                  {character.characterAssetId && (
                    <span className="pill" title="Custom camera roster character">
                      Character
                    </span>
                  )}
                  {(character.questions?.length ?? 0) > 0 && (
                    <span className="pill" title="Questions asked at this location">
                      {character.questions!.length} question
                      {character.questions!.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {(character.isTreasure || character.isCongratulations) && (
                    <span
                      className="pill"
                      title="Treasure location — never shuffled, so every team's route finishes here"
                    >
                      🎁 Treasure
                    </span>
                  )}
                </div>
                <div className="charMeta">
                  {character.hint || 'No hint yet'} · {character.radiusMeters}m radius ·{' '}
                  {character.latitude.toFixed(4)}, {character.longitude.toFixed(4)}
                </div>
              </div>
              <div className="charActions">
                <button
                  type="button"
                  className="iconBtn"
                  aria-label="Move earlier"
                  disabled={index === 0}
                  onClick={() => handleMove(index, -1)}
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  type="button"
                  className="iconBtn"
                  aria-label="Move later"
                  disabled={index === characters.length - 1}
                  onClick={() => handleMove(index, 1)}
                >
                  <ChevronDown size={15} />
                </button>
                <button
                  type="button"
                  className="iconBtn"
                  aria-label="Edit location"
                  onClick={() => {
                    setEditingIndex(index);
                    setEditorOpen(true);
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="iconBtn iconBtnDanger"
                  aria-label="Remove location"
                  onClick={() => handleDeleteCharacter(index)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="publishBar">
        <button type="button" className="btnAmber" onClick={handlePublish} disabled={saving}>
          <Rocket size={16} />
          {saving ? 'Publishing…' : existing ? 'Save Changes' : 'Publish Hunt'}
        </button>
      </div>

      {/* Location editor — reuses the player's position as the map centre. */}
      <CharacterEditorModal
        open={editorOpen}
        initial={editingIndex !== null ? characters[editingIndex] ?? null : null}
        defaultLatitude={userLocation?.latitude ?? 37.774929}
        defaultLongitude={userLocation?.longitude ?? -122.419416}
        currentLocation={userLocation}
        onClose={() => {
          setEditorOpen(false);
          setEditingIndex(null);
        }}
        onSave={handleSaveCharacter}
      />

      {/* Post-publish share sheet. */}
      <Modal
        open={publishedGame !== null}
        onClose={() => setPublishedGame(null)}
        title="Hunt published"
        icon={<Share2 size={18} />}
        accentColor="var(--amber)"
      >
        {publishedGame && (
          <>
            <p className="shareLead">
              Your hunt is live. Send players the link below — opening it takes them straight to
              this hunt and asks whether they want to join. Download the JSON file to keep a
              reusable copy you can upload on the Create Game screen later to reopen and edit
              this hunt.
            </p>

            <label className="fieldLabel" htmlFor="share-link">
              <Link2 size={12} /> Invite link
            </label>
            <div id="share-link" className="shareLink mono" title={joinUrl}>
              {joinUrl}
            </div>

            <div className="shareCode mono">{publishedGame.id}</div>
            <div className="shareActions">
              <button type="button" className="btnAmber" onClick={handleCopyLink}>
                {copied ? <Check size={16} /> : <Link2 size={16} />}
                {copied ? 'Copied!' : 'Copy invite link'}
              </button>
              <button type="button" className="btnGhost" onClick={handleCopyShare}>
                <Copy size={16} />
                Copy full message
              </button>
              <button
                type="button"
                className="btnGhost"
                onClick={() => downloadHuntGame(publishedGame)}
                title="Save this hunt as a JSON file"
              >
                <Download size={16} />
                Download JSON
              </button>
              <button
                type="button"
                className="btnGhost"
                onClick={() => setPublishedGame(null)}
              >
                Done
              </button>
            </div>
            <details className="shareDetails">
              <summary>Show full share text</summary>
              <pre className="sharePreview mono">
                {buildGameShareMessage(publishedGame, currentOrigin())}
              </pre>
            </details>
          </>
        )}
      </Modal>
    </div>
  );
}

/** Suspense wrapper: lets Next prerender a static shell before the query params
 *  (used to detect edit mode) are available on the client. */
export default function CreatorEditPage() {
  return (
    <Suspense fallback={<div className="page">Loading editor…</div>}>
      <CreatorEditor />
    </Suspense>
  );
}
