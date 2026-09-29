'use client';


import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { HuntGame, HuntProgress, HuntGameDraft, HuntCharacter } from '../types/hunt';
import {
  GameRepository,
  localGameRepository,
  nextGameId,
  decodeGameShareCode,
  extractGameId,
  extractShareCode,
} from '../services/gameRepository';
import { generateCharacterKey, keyMatches } from '../utils/keys';
import { buildRoute, isTreasureStop, resolveRoute } from '../utils/huntRoute';

export interface DiscoverResult {
  character: HuntCharacter;
  isFinal: boolean;
  nextCharacter: HuntCharacter | null;
  game: HuntGame;
  progress: HuntProgress;
}

interface HuntContextType {
  /** Games authored on this device (creator role). */
  createdGames: HuntGame[];
  /** The hunt the player has joined and is currently playing. */
  activeGame: HuntGame | null;
  activeProgress: HuntProgress | null;
  /**
   * The active hunt's stops in THIS team's order — their shuffled locations with
   * the treasure last (or the authored order for progress saved before routes
   * existed). Use this, never `activeGame.characters`, for anything the player
   * experiences as a sequence.
   */
  activeRoute: HuntCharacter[];
  /** Next undiscovered location in the active hunt (null when finished). */
  currentCharacter: HuntCharacter | null;
  isLoading: boolean;
  createGame: (draft: HuntGameDraft) => Promise<HuntGame>;
  updateGame: (game: HuntGame) => Promise<void>;
  deleteGame: (id: string) => Promise<void>;
  /** Accepts a short ID ("FQ-7K2M9X"), bare body, share code, or share message. */
  joinGame: (input: string) => Promise<HuntGame>;
  leaveGame: () => Promise<void>;
  /** Marks the current character discovered; returns the clue payload to show.
   *  `presentedKey` is the key the player hands the character — it must match
   *  the character's discovery key or an Error is thrown. */
  discoverCurrentCharacter: (presentedKey?: string) => Promise<DiscoverResult | null>;
  getProgressFor: (gameId: string) => Promise<HuntProgress | null>;
  /** Re-reads games/progress from storage (after external edits). */
  reload: () => Promise<void>;
}

/**
 * Shared key gate: throws the player-facing mismatch error unless
 * `presentedKey` matches the location's discovery key. Exported so the AR
 * camera can check the key *before* running a location's reveal questions —
 * while the authoritative discovery still re-validates inside
 * `discoverCurrentCharacter`, so no path records a discovery on a wrong key.
 */
export function assertPresentedKey(character: HuntCharacter, presentedKey?: string): void {
  if (!keyMatches(presentedKey, character.key)) {
    throw new Error(
      "That key doesn't match. Use the key on screen — it is the one handed over for this " +
        'location, either when your hunt opened or by the reveal at the stop before it.'
    );
  }
}

const HuntContext = createContext<HuntContextType | undefined>(undefined);

/**
 * Orders and stamps a draft into a persisted-ready game.
 *
 * `allocatedId` is the hunt number the repository has already reserved for a new
 * hunt (see `nextGameId`). It is passed in rather than computed here because the
 * hunt list is React state in the provider, and it must reflect the games
 * actually on the device.
 */
function normaliseGame(
  draft: HuntGameDraft,
  existing?: HuntGame,
  allocatedId?: string
): HuntGame {
  const now = new Date().toISOString();
  const sorted = [...draft.characters].sort((a, b) => a.order - b.order);

  // A hunt has exactly one treasure location: the first flagged one in authored
  // order wins, later flags are cleared, and the treasure is stored last so the
  // authored order itself reads route-shaped in exports, imports and share
  // codes. The legacy `isCongratulations` name is read but never written.
  let treasure: HuntCharacter | null = null;
  const walkable: HuntCharacter[] = [];
  for (const character of sorted) {
    if (isTreasureStop(character)) {
      if (!treasure) {
        const flagged = { ...character, isTreasure: true };
        delete flagged.isCongratulations;
        treasure = flagged;
      } else {
        const clone = { ...character };
        delete clone.isTreasure;
        delete clone.isCongratulations;
        walkable.push(clone);
      }
      continue;
    }
    walkable.push(character);
  }

  // The treasure is not optional: it is the location every team's route ends on,
  // so a hunt without one has no place to finish (or to celebrate) at.
  if (!treasure) {
    throw new Error(
      'Mark the treasure location before publishing: it is the place every team finishes at, ' +
        'and clearing its questions is what shows the congratulations. Edit that location, tick ' +
        '"This is the treasure location", and publish again.'
    );
  }

  // The congratulations screen is the announcement plus the character added
  // next to it, so a hunt cannot be published without both.
  const endCharacterAssetId = draft.endCharacterAssetId?.trim() || '';
  if (!endCharacterAssetId) {
    throw new Error(
      'Choose the end-of-hunt character: the character shown together with the End-of-Hunt ' +
        'Announcement when a team clears the treasure. Pick one from the camera roster next to ' +
        'the announcement, and publish again.'
    );
  }

  const characters = [...walkable, treasure].map((ch, index) => ({
    ...ch,
    order: index + 1,
    // Backfill discovery keys so every published location needs one.
    key: ch.key?.trim() || generateCharacterKey(),
  }));

  return {
    id: existing?.id ?? draft.id ?? allocatedId ?? nextGameId([]),
    title: draft.title.trim(),
    description: draft.description.trim(),
    creatorName: draft.creatorName.trim() || 'Mystery Creator',
    createdAt: existing?.createdAt ?? draft.createdAt ?? now,
    updatedAt: now,
    endAnnouncement: draft.endAnnouncement.trim(),
    endCharacterAssetId,
    characters,
  };
}

export const HuntProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const repository: GameRepository = localGameRepository;

  const [createdGames, setCreatedGames] = useState<HuntGame[]>([]);
  const [activeGame, setActiveGame] = useState<HuntGame | null>(null);
  const [activeProgress, setActiveProgress] = useState<HuntProgress | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const reload = useCallback(async () => {
    try {
      const games = await repository.listGames();
      setCreatedGames(games);

      const activeId = await repository.getActiveGameId();
      if (activeId) {
        const [game, progress] = await Promise.all([
          repository.getGame(activeId),
          repository.getProgress(activeId),
        ]);
        setActiveGame(game);
        setActiveProgress(progress);
      } else {
        setActiveGame(null);
        setActiveProgress(null);
      }
    } catch (err) {
      console.error('Failed to load hunt data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    reload();
  }, [reload]);

  const createGame = useCallback(
    async (draft: HuntGameDraft): Promise<HuntGame> => {
      const existing = draft.id
        ? createdGames.find(g => g.id === draft.id) ?? undefined
        : undefined;
      // A brand-new hunt takes the next number on the device; an edit keeps the
      // number it already has so shared codes and invite links still resolve.
      const allocatedId = existing ? undefined : nextGameId(createdGames.map(g => g.id));
      const game = normaliseGame(draft, existing, allocatedId);
      await repository.saveGame(game);
      await reload();
      return game;
    },
    [createdGames, repository, reload]
  );

  const updateGame = useCallback(
    async (game: HuntGame): Promise<void> => {
      await repository.saveGame(game);
      await reload();
    },
    [repository, reload]
  );

  const deleteGame = useCallback(
    async (id: string): Promise<void> => {
      await repository.deleteGame(id);
      await reload();
    },
    [repository, reload]
  );

  const getProgressFor = useCallback(
    async (gameId: string): Promise<HuntProgress | null> => repository.getProgress(gameId),
    [repository]
  );

  const joinGame = useCallback(
    async (input: string): Promise<HuntGame> => {
      const trimmed = input.trim();
      if (!trimmed) {
        throw new Error('Enter a game ID or share code to join.');
      }

      // 1) Full self-contained share code (cross-device, no backend needed).
      //    `extractShareCode` also digs the payload out of a pasted invite link,
      //    so copying the URL into this box joins exactly like tapping it.
      const shareCode = extractShareCode(trimmed);
      let game = shareCode ? decodeGameShareCode(shareCode) : null;

      // 2) Short ID — extracted from raw ID or a pasted share message.
      if (!game) {
        const id = extractGameId(trimmed);
        if (id) {
          game = await repository.getGame(id);
        }
      }

      if (!game) {
        throw new Error(
          'Game not found. Ask the creator to share the full game code and paste it here.'
        );
      }
      if (!game.characters || game.characters.length === 0) {
        throw new Error('This game has no characters placed yet.');
      }

      // Backfill discovery keys for games saved before keys existed, so the
      // key chain works for legacy share codes too.
      game = {
        ...game,
        characters: game.characters.map(ch =>
          ch.key?.trim() ? ch : { ...ch, key: generateCharacterKey() }
        ),
      };

      // Persist locally so future joins by short ID also work on this device.
      await repository.saveGame(game);

      let progress = await repository.getProgress(game.id);
      if (!progress) {
        progress = {
          gameId: game.id,
          joinedAt: new Date().toISOString(),
          // Deal this team's round now: the walkable locations shuffled, the
          // treasure left out — it is always appended last, so every route
          // finishes where the treasure waits. Progress that already exists
          // keeps the route it was dealt: never reshuffle mid-hunt.
          route: buildRoute(game.characters),
          discoveredCharacterIds: [],
          status: 'active',
          completedAt: null,
        };
        await repository.saveProgress(progress);
      }

      await repository.setActiveGameId(game.id);
      await reload();
      return game;
    },
    [repository, reload]
  );

  const leaveGame = useCallback(async (): Promise<void> => {
    await repository.setActiveGameId(null);
    setActiveGame(null);
    setActiveProgress(null);
  }, [repository]);

  /**
   * This team's stops exactly as they are played: the dealt location order with
   * the treasure last, each location carrying everything its creator authored
   * for it — coordinates, clue, character, questions and key (see
   * `resolveRoute`). Anything the player experiences as a sequence reads from
   * here, never from `activeGame.characters`.
   */
  const activeRoute = useMemo<HuntCharacter[]>(
    () => (activeGame ? resolveRoute(activeGame, activeProgress) : []),
    [activeGame, activeProgress]
  );

  const discoverCurrentCharacter = useCallback(
    async (presentedKey?: string): Promise<DiscoverResult | null> => {
      if (!activeGame || !activeProgress) return null;

      const discovered = new Set(activeProgress.discoveredCharacterIds);
      // The team's next stop is the first undiscovered one in THEIR route —
      // never the authored order, so following another team's path records
      // nothing.
      const nextCharacter = activeRoute.find(ch => !discovered.has(ch.id)) ?? null;
      if (!nextCharacter) return null;

      // Every stop is opened by its own key: the one handed over for it, either
      // when the round opened (the team's first location) or by the reveal at
      // the stop before it.
      assertPresentedKey(nextCharacter, presentedKey);

      const discoveredIds = [...activeProgress.discoveredCharacterIds, nextCharacter.id];
      const isComplete = discoveredIds.length >= activeRoute.length;

      const updatedProgress: HuntProgress = {
        ...activeProgress,
        discoveredCharacterIds: discoveredIds,
        status: isComplete ? 'completed' : 'active',
        completedAt: isComplete ? new Date().toISOString() : activeProgress.completedAt ?? null,
      };
      await repository.saveProgress(updatedProgress);
      setActiveProgress(updatedProgress);

      const nextUp = activeRoute.find(ch => !discoveredIds.includes(ch.id)) ?? null;

      return {
        character: nextCharacter,
        isFinal: isComplete,
        nextCharacter: nextUp,
        game: activeGame,
        progress: updatedProgress,
      };
    },
    [activeGame, activeProgress, activeRoute, repository]
  );

  const currentCharacter = useMemo<HuntCharacter | null>(() => {
    if (!activeProgress) return null;
    const discovered = new Set(activeProgress.discoveredCharacterIds);
    return activeRoute.find(ch => !discovered.has(ch.id)) ?? null;
  }, [activeRoute, activeProgress]);

  const value = useMemo<HuntContextType>(
    () => ({
      createdGames,
      activeGame,
      activeProgress,
      activeRoute,
      currentCharacter,
      isLoading,
      createGame,
      updateGame,
      deleteGame,
      joinGame,
      leaveGame,
      discoverCurrentCharacter,
      getProgressFor,
      reload,
    }),
    [
      createdGames,
      activeGame,
      activeProgress,
      activeRoute,
      currentCharacter,
      isLoading,
      createGame,
      updateGame,
      deleteGame,
      joinGame,
      leaveGame,
      discoverCurrentCharacter,
      getProgressFor,
      reload,
    ]
  );

  return <HuntContext.Provider value={value}>{children}</HuntContext.Provider>;
};

export const useHunt = (): HuntContextType => {
  const context = useContext(HuntContext);
  if (!context) {
    throw new Error('useHunt must be used within a HuntProvider');
  }
  return context;
};


