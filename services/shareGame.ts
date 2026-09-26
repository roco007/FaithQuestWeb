import { HuntGame } from '../types/hunt';
import { encodeGameShareCode } from './gameRepository';

/**
 * Builds a deep link that drops a player straight onto the hunt they were sent,
 * with the whole hunt embedded in the URL fragment.
 *
 * The payload rides in the fragment (`#join=…`) rather than the query string for
 * two reasons: there is no backend, so the link itself must carry the hunt, and
 * a fragment is never sent to the server or leaked through `Referer` headers —
 * important for a link that gets shared through messaging apps. Reading it is
 * therefore a client-side concern (see `app/games/page.tsx`).
 */
export function buildGameJoinUrl(game: HuntGame, origin: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/games#join=${encodeURIComponent(encodeGameShareCode(game))}`;
}

/** Best-effort page origin, for links built in the browser. */
export function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/**
 * Builds the message a creator shares with players. It contains the hunt
 * number plus the self-contained share code, so players on any device can
 * join without a backend — they simply paste the whole message (or just the
 * code) into the Join field.
 */
export function buildGameShareMessage(game: HuntGame, origin = ''): string {
  const code = encodeGameShareCode(game);
  const firstKey = game.characters[0]?.key?.trim();
  const joinUrl = origin ? buildGameJoinUrl(game, origin) : '';
  return [
    `⛪ FaithQuest treasure hunt: "${game.title}"`,
    game.description ? game.description : '',
    ``,
    `Hunt number: ${game.id}`,
    `Characters: ${game.characters.length}`,
    firstKey ? `First key: ${firstKey} — hand this to players to begin` : '',
    joinUrl ? `Open this link to join (it asks first, then adds you to the hunt):` : '',
    joinUrl ? joinUrl : '',
    ``,
    `To join, open FaithQuest → Hunts → paste this code:`,
    code,
  ]
    .filter(line => line !== undefined)
    .join('\n');
}

/** Short text for the share dialog title/subject. */
export function getShareSubject(game: HuntGame): string {
  return `Join my FaithQuest hunt: ${game.title} (${game.id})`;
}
