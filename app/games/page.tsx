'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gamepad2, Plus, LogIn, LogOut, Play, Trash2, Share2, MapPin, Check, Link2 } from 'lucide-react';
import { useHunt } from '../../context/HuntContext';
import { useGame } from '../../context/GameContext';
import { evaluateProximity } from '../../utils/geo';
import { buildGameShareMessage, currentOrigin } from '../../services/shareGame';
import { decodeGameShareCode, encodeGameShareCode } from '../../services/gameRepository';
import { HuntPlay } from '../../components/HuntPlay';
import { KeyInHand } from '../../components/KeyInHand';
import { Modal } from '../../components/Modal';
import type { HuntGame } from '../../types/hunt';

export default function GamesPage() {
  const {
    createdGames,
    activeGame,
    activeProgress,
    currentCharacter,
    isLoading,
    createGame,
    deleteGame,
    joinGame,
    leaveGame,
  } = useHunt();

  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [shared, setShared] = useState<string | null>(null);
  /**
   * Hunt carried by an incoming `#join=…` deep link. The player is asked before
   * anything is saved, so opening someone's link never silently replaces the
   * hunt they are already playing.
   */
  const [invited, setInvited] = useState<HuntGame | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  /** Consumes the invite fragment exactly once, on arrival. */
  useEffect(() => {
    const readInvite = () => {
      const raw = window.location.hash.startsWith('#join=')
        ? window.location.hash.slice('#join='.length)
        : '';
      if (!raw) return;
      // Drop the payload from the address bar first: this effect must not fire
      // again (or re-prompt) if the component remounts later.
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      const game = decodeGameShareCode(decodeURIComponent(raw));
      if (game) {
        setInvited(game);
      } else {
        setInviteError('This invite link is damaged or incomplete. Ask the creator to resend it.');
      }
    };
    readInvite();
    // The fragment can also arrive via the back/forward buttons.
    window.addEventListener('hashchange', readInvite);
    return () => window.removeEventListener('hashchange', readInvite);
  }, []);

  /** Adds the invited player to the hunt — only ever called after confirmation.
   *  `invited` is an already-decoded game, so it is re-encoded through the same
   *  path the paste box uses rather than re-encoding the URL-escaped fragment
   *  (which would double-escape it and fail to decode). */
  const acceptInvite = useCallback(async () => {
    if (!invited) return;
    setJoining(true);
    setInviteError(null);
    try {
      await joinGame(encodeGameShareCode(invited));
      setInvited(null);
      setPlaying(true);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not join that hunt.');
    } finally {
      setJoining(false);
    }
  }, [invited, joinGame]);

  /** True when the invite is the hunt already in progress — no switch needed. */
  const inviteIsActive = Boolean(invited && activeGame && invited.id === activeGame.id);

  const { userLocation } = useGame();
  // Strict visibility: the hunt list must not leak the current character's
  // name or clue while the player is still outside its discovery radius.
  const currentTargetRevealed = useMemo(() => {
    if (!currentCharacter || !userLocation) return false;
    return evaluateProximity(userLocation, currentCharacter).isWithinRadius;
  }, [currentCharacter, userLocation]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = joinInput.trim();
    if (!value) return;

    setJoining(true);
    setJoinError(null);
    try {
      await joinGame(value);
      setJoinInput('');
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Could not join that hunt.');
    } finally {
      setJoining(false);
    }
  };

  const handleCreate = async () => {
    await createGame({
      title: 'Untitled Hunt',
      description: '',
      creatorName: 'Mystery Creator',
      endAnnouncement: 'You have found every guardian. Well travelled, seeker!',
      characters: [],
    });
  };

  const handleShare = async (id: string) => {
    const game = createdGames.find((g) => g.id === id);
    if (!game) return;

    setShared(id);
    try {
      // Clipboard is the web-native equivalent of the native share sheet.
      await navigator.clipboard.writeText(buildGameShareMessage(game, currentOrigin()));
    } catch {
      // Clipboard can be blocked (insecure origin / denied permission). The
      // share code remains copyable in the Creator's share panel.
    }
    setTimeout(() => setShared(null), 2000);
  };

  if (playing && activeGame) {
    return <HuntPlay onExit={() => setPlaying(false)} />;
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <h1 className="pageTitle">Treasure Hunts</h1>
        <p className="pageSubtitle">
          Create a hunt, pin characters to real-world locations, then share the join code with
          players. No account or backend needed — everything is stored in this browser.
        </p>
      </div>

      {/* --- Join --------------------------------------------------------- */}
      <div className="card joinCard">
        <div className="joinIntro">
          <div className="joinIcon" aria-hidden="true">
            <Gamepad2 size={20} />
          </div>
          <div>
            <h2 className="cardTitle">Join a hunt</h2>
            <p className="cardSubtitle">
              Paste the hunt number from a hunt creator, or the whole share message.
            </p>
          </div>
        </div>

        <form className="joinForm" onSubmit={handleJoin}>
          <input
            className="input"
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
            placeholder="12 or a share code"
            aria-label="Hunt number or share code"
            spellCheck={false}
          />
          <button type="submit" className="btnPrimary" disabled={joining || !joinInput.trim()}>
            <LogIn size={16} />
            {joining ? 'Joining…' : 'Join'}
          </button>
        </form>

        {joinError && (
          <div className="banner bannerWarn" style={{ marginTop: 12, marginBottom: 0 }}>
            {joinError}
          </div>
        )}
      </div>

      {/* --- Active hunt -------------------------------------------------- */}
      {activeGame && activeProgress && (
        <div className="card activeHuntCard">
          <div className="activeHuntMain">
            <div>
              <span className="pill pillActive">Currently playing</span>
              <h2 className="cardTitle" style={{ marginTop: 8 }}>
                {activeGame.title}
              </h2>
              <p className="cardSubtitle">
                {activeProgress.discoveredCharacterIds.length}/{activeGame.characters.length}{' '}
                characters found · by {activeGame.creatorName}
              </p>
            </div>
            <div className="activeHuntActions">
              <button type="button" className="btnPrimary" onClick={() => setPlaying(true)}>
                <Play size={16} />
                {activeProgress.status === 'completed' ? 'Review hunt' : 'Continue hunt'}
              </button>
              <button
                type="button"
                className="btnGhost"
                onClick={() => {
                  leaveGame();
                  setPlaying(false);
                }}
              >
                <LogOut size={15} />
                Leave
              </button>
            </div>
          </div>

          {currentCharacter && (
            <div className="currentTarget">
              <MapPin size={15} style={{ flexShrink: 0, color: 'var(--sky)' }} />
              <span>
                {currentTargetRevealed ? (
                  <>
                    Searching for <strong>{currentCharacter.name}</strong> —{' '}
                    {currentCharacter.hint}
                  </>
                ) : currentCharacter.order === 1 ? (
                  /* The first stop has no earlier character to pass a clue on,
                     so the creator's briefing *is* the clue: it is readable
                     before the hunt is even opened, or there is nothing to walk
                     towards. Later stops keep the hint behind the radius. */
                  <>
                    <strong>First clue from the creator</strong> — {currentCharacter.hint}
                  </>
                ) : (
                  <>The next character stays hidden until you walk into its discovery zone.</>
                )}
              </span>
            </div>
          )}

          {/* The key the player is holding, always on screen: the first comes
              from the creator, each later one from the character just found. */}
          <KeyInHand className="keyBarTight" />
        </div>
      )}

      {/* --- Created hunts ------------------------------------------------ */}
      <div className="sectionHeader">
        <h2 className="sectionTitle">Your hunts</h2>
        <button type="button" className="btnPrimary" onClick={handleCreate}>
          <Plus size={16} />
          New hunt
        </button>
      </div>

      {isLoading ? (
        <div className="card emptyState">Loading…</div>
      ) : createdGames.length === 0 ? (
        <div className="card emptyState">
          <div className="emptyTitle">No hunts yet</div>
          <p>Create your first hunt to start pinning characters to the map.</p>
        </div>
      ) : (
        <div className="huntList">
          {createdGames.map((game) => (
            <div key={game.id} className="card huntRow">
              <div className="huntRowMain">
                <div>
                  <h3 className="huntRowTitle">{game.title}</h3>
                  <p className="huntRowMeta">
                    <span className="mono">{game.id}</span> · {game.characters.length} character
                    {game.characters.length === 1 ? '' : 's'} · {game.creatorName}
                  </p>
                </div>
                <div className="huntRowActions">
                  <button
                    type="button"
                    className="btnGhost"
                    onClick={() => handleShare(game.id)}
                    title="Copy share code to clipboard"
                  >
                    {shared === game.id ? <Check size={15} /> : <Share2 size={15} />}
                    {shared === game.id ? 'Copied' : 'Share'}
                  </button>
                  <button
                    type="button"
                    className="btnDanger"
                    onClick={() => deleteGame(game.id)}
                    title="Delete this hunt"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- Invite from a deep link ---------------------------------------
          Opened when a player's URL carries `#join=…`. Joining is never
          automatic: the player confirms first, so a link that is merely opened
          (previewed in a chat app, opened on a borrowed phone) cannot silently
          replace the hunt they are already playing. */}
      <Modal
        open={invited !== null}
        onClose={() => {
          setInvited(null);
          setInviteError(null);
        }}
        title="You've been invited to a hunt"
        icon={<Link2 size={18} />}
        accentColor="var(--amber)"
      >
        {invited && (
          <>
            <p className="shareLead">
              <strong>{invited.creatorName}</strong> invites you to join &ldquo;
              {invited.title}&rdquo; ({invited.characters.length} character
              {invited.characters.length === 1 ? '' : 's'}). Do you want to join this hunt now?
            </p>
            {invited.description && <p className="shareLead">{invited.description}</p>}

            {inviteIsActive ? (
              <>
                <div className="banner bannerWarn" style={{ marginBottom: 0 }}>
                  This is the hunt you are already playing — no change needed.
                </div>
                <div className="shareActions">
                  <button
                    type="button"
                    className="btnPrimary"
                    onClick={() => {
                      setInvited(null);
                      setPlaying(true);
                    }}
                  >
                    <Play size={16} />
                    Continue hunt
                  </button>
                </div>
              </>
            ) : (
              <>
                {inviteError && (
                  <div className="banner bannerWarn" role="alert">
                    {inviteError}
                  </div>
                )}
                {activeGame && (
                  <p className="cardSubtitle" style={{ marginBottom: 0 }}>
                    Joining will replace &ldquo;{activeGame.title}&rdquo;, the hunt you are playing
                    now.
                  </p>
                )}
                <div className="shareActions">
                  <button
                    type="button"
                    className="btnAmber"
                    onClick={() => void acceptInvite()}
                    disabled={joining}
                  >
                    <LogIn size={16} />
                    {joining ? 'Joining…' : 'Yes, join this hunt'}
                  </button>
                  <button
                    type="button"
                    className="btnGhost"
                    onClick={() => {
                      setInvited(null);
                      setInviteError(null);
                    }}
                  >
                    No, thanks
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
