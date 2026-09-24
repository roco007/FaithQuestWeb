import { HuntGame } from '../types/hunt';
import { encodeGameShareCode } from './gameRepository';

/**
 * Builds the message a creator shares with players. It contains the short
 * Game ID plus the self-contained share code, so players on any device can
 * join without a backend — they simply paste the whole message (or just the
 * code) into the Join field.
 */
export function buildGameShareMessage(game: HuntGame): string {
  const code = encodeGameShareCode(game);
  return [
    `⛪ FaithQuest treasure hunt: "${game.title}"`,
    game.description ? game.description : '',
    ``,
    `Game ID: ${game.id}`,
    `Characters: ${game.characters.length}`,
    ``,
    `To join, open FaithQuest → Games tab → paste this code:`,
    code,
  ]
    .filter(line => line !== undefined)
    .join('\n');
}

/** Short text for the native share sheet title/subject (iOS). */
export function getShareSubject(game: HuntGame): string {
  return `Join my FaithQuest hunt: ${game.title} (${game.id})`;
}
