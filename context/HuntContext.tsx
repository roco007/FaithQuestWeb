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
  /** Next undiscovered character in the active hunt (null when finished). */
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
  const characters = [...draft.characters]
    .sort((a, b) => a.order - b.order)
    .map((ch, index) => ({
      ...ch,
      order: index + 1,
      // Backfill discovery keys so every published character needs one.
      key: ch.key?.trim() || generateCharacterKey(),
    }));

  return {
    id: existing?.id ?? draft.id ?? allocatedId ?? nextGameId([]),
    title: draft.title.trim(),
    description: draft.description.trim(),
    creatorName: draft.creatorName.trim() || 'Mystery Creator',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    endAnnouncement: draft.endAnnouncement.trim(),
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

  const discoverCurrentCharacter = useCallback(
    async (presentedKey?: string): Promise<DiscoverResult | null> => {
      if (!activeGame || !activeProgress) return null;

      const discovered = new Set(activeProgress.discoveredCharacterIds);
      const nextCharacter = activeGame.characters.find(ch => !discovered.has(ch.id)) ?? null;
      if (!nextCharacter) return null;

      // The player must hand the character a key: character N's key comes from
      // character N-1 (the creator gives players the first character's key).
      if (!keyMatches(presentedKey, nextCharacter.key)) {
        throw new Error(
          `That key doesn't match. Present the key the previous character gave you${
            nextCharacter.order === 1 ? ' — the creator hands out the first key.' : '.'
          }`
        );
      }

      const discoveredIds = [...activeProgress.discoveredCharacterIds, nextCharacter.id];
      const isComplete = discoveredIds.length >= activeGame.characters.length;

      const updatedProgress: HuntProgress = {
        ...activeProgress,
        discoveredCharacterIds: discoveredIds,
        status: isComplete ? 'completed' : 'active',
        completedAt: isComplete ? new Date().toISOString() : activeProgress.completedAt ?? null,
      };
      await repository.saveProgress(updatedProgress);
      setActiveProgress(updatedProgress);

      const nextUp = activeGame.characters.find(ch => !discoveredIds.includes(ch.id)) ?? null;

      return {
        character: nextCharacter,
        isFinal: isComplete,
        nextCharacter: nextUp,
        game: activeGame,
        progress: updatedProgress,
      };
    },
    [activeGame, activeProgress, repository]
  );

  const currentCharacter = useMemo<HuntCharacter | null>(() => {
    if (!activeGame || !activeProgress) return null;
    const discovered = new Set(activeProgress.discoveredCharacterIds);
    return activeGame.characters.find(ch => !discovered.has(ch.id)) ?? null;
  }, [activeGame, activeProgress]);

  const value = useMemo<HuntContextType>(
    () => ({
      createdGames,
      activeGame,
      activeProgress,
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


