import { webStorage } from './webStorage';
import { PlayerProgress } from '../types/game';

const STORAGE_KEY_PROGRESS = '@faithquest:player_progress';

export const INITIAL_PLAYER_PROGRESS: PlayerProgress = {
  playerName: 'Young Pilgrim',
  level: 1,
  currentXp: 0,
  xpForNextLevel: 300,
  totalXp: 0,
  rankTitle: 'Seeker',
  completedNodeIds: [],
  inventory: [],
  badges: [
    {
      id: 'badge_first_step',
      title: 'The Awakening Pilgrim',
      description: 'Discovered your first holy landmark.',
      icon: 'compass',
      category: 'exploration',
      isUnlocked: false,
    },
    {
      id: 'badge_cryptographer',
      title: 'Cipher Novice',
      description: 'Decoded an ancient church anagram.',
      icon: 'key',
      category: 'wisdom',
      isUnlocked: false,
    },
    {
      id: 'badge_sentinel',
      title: 'Tower Sentinel',
      description: 'Explored the historic Campanile bell tower.',
      icon: 'shield',
      category: 'exploration',
      isUnlocked: false,
    },
    {
      id: 'badge_watchman',
      title: 'Silent Watchman',
      description: 'Solved the contemplation mystery in the Garden.',
      icon: 'eye',
      category: 'wisdom',
      isUnlocked: false,
    },
    {
      id: 'badge_holy_architect',
      title: 'Master of Light',
      description: 'Uncovered the secrets of the High Altar mosaic.',
      icon: 'award',
      category: 'mastery',
      isUnlocked: false,
    },
    {
      id: 'badge_scripture_master',
      title: 'Archival Scholar',
      description: 'Answered the ancient Greek script question in the Crypt.',
      icon: 'feather',
      category: 'mastery',
      isUnlocked: false,
    },
  ],
  streakDays: 1,
  lastActiveDate: new Date().toISOString(),
};

/**
 * Loads player progress from local storage or returns the default initial state.
 */
export async function loadPlayerProgress(): Promise<PlayerProgress> {
  try {
    const raw = await webStorage.getItem(STORAGE_KEY_PROGRESS);
    if (!raw) return INITIAL_PLAYER_PROGRESS;
    const parsed = JSON.parse(raw);
    return {
      ...INITIAL_PLAYER_PROGRESS,
      ...parsed,
    };
  } catch (error) {
    console.error('Failed to load player progress:', error);
    return INITIAL_PLAYER_PROGRESS;
  }
}

/**
 * Saves player progress to local storage.
 */
export async function savePlayerProgress(progress: PlayerProgress): Promise<void> {
  try {
    await webStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(progress));
  } catch (error) {
    console.error('Failed to save player progress:', error);
  }
}

/**
 * Clears player progress for replayability/testing.
 */
export async function clearPlayerProgress(): Promise<void> {
  try {
    await webStorage.removeItem(STORAGE_KEY_PROGRESS);
  } catch (error) {
    console.error('Failed to clear player progress:', error);
  }
}
