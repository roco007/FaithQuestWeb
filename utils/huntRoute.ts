import type { HuntCharacter, HuntGame, HuntProgress } from '../types/hunt';

/**
 * Team routes for the treasure hunt, pure and storage-free.
 *
 * The unit is a **location**, and a location is authored complete: where it is,
 * the clue that leads to it (H), the character that appears there and plays its
 * video (C), the questions asked on arrival (Q) and the key that unlocks them
 * (K). Nothing about a location is moved around at play time — the order is the
 * only thing the hunt deals.
 *
 *     authored locations            L1, L2 (treasure), L3
 *     one team's dealt route        L3  →  L1  →  L2
 *     handed over when the hunt opens      H3, C3, K3
 *     handed over when Q3 is cleared       H1, C1, K1
 *     handed over when Q1 is cleared       H2, C2, K2
 *     cleared Q2 at the treasure           congratulations
 *
 * Two rules shape that.
 *
 * 1. **The order is dealt per team.** Each joining device (the unit
 *    `HuntProgress` tracks) is dealt its own shuffled order of the hunt's
 *    walkable locations, so teams never walk the same path: shadowing another
 *    team takes you somewhere your route does not go, and the gate records
 *    nothing there. The treasure location is never dealt — it is appended last,
 *    so every team's hunt finishes where the treasure waits.
 *
 * 2. **A stop is exactly the location the creator wrote.** Its coordinates,
 *    radius, hint, character, questions and key are all its own. The dealt order
 *    changes only *when* a team gets them: the reveal that ends a stop hands over
 *    the next location's hint + character + key, and the hunt opens with those
 *    three for the team's first location already in hand. So the clue on screen
 *    while walking is always the one describing the place the radar points at,
 *    and the key on screen always opens the stop being walked to.
 */

/** True for the location where the treasure waits — the stop every route ends on. */
export function isTreasureStop(
  character: Pick<HuntCharacter, 'isTreasure' | 'isCongratulations'>
): boolean {
  // `isCongratulations` is the flag's name in hunts saved before the model was
  // re-framed around locations; reading it keeps those hunts playable.
  return character.isTreasure === true || character.isCongratulations === true;
}

/** The hunt's treasure location, or null on a hunt authored before it was required. */
export function treasureLocation(characters: HuntCharacter[]): HuntCharacter | null {
  return characters.find(isTreasureStop) ?? null;
}

/**
 * The hunt's walkable locations, in authored order — every location except the
 * treasure. The treasure is never shuffled: it is what every team's route ends
 * on, so `buildRoute` deals these and `resolveRoute` appends it.
 */
export function walkableStops(characters: HuntCharacter[]): HuntCharacter[] {
  return characters.filter(character => !isTreasureStop(character));
}

/** Uniform integer in [0, max) — crypto-backed, with a fallback for old engines. */
function randomInt(max: number): number {
  if (max <= 0) return 0;
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % max;
  }
  return Math.floor(Math.random() * max);
}

/** Fisher–Yates shuffle that returns a new array, leaving the input untouched. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Deals a team's opening order: the hunt's walkable locations shuffled at
 * random. A reshuffle makes sure the dealt order is not simply the authored
 * order again. The treasure location is deliberately absent — see
 * `walkableStops`.
 */
export function buildRoute(characters: HuntCharacter[]): string[] {
  const walkableIds = walkableStops(characters).map(character => character.id);
  let dealt = shuffle(walkableIds);
  for (let attempt = 0; attempt < 3 && sameOrder(dealt, walkableIds); attempt++) {
    dealt = shuffle(walkableIds);
  }
  return dealt;
}

/**
 * The locations this team plays, in the order they play them: the dealt stops
 * (their stored order when one exists, the authored order for progress saved
 * before routes existed, plus any location the creator added after the deal),
 * then the treasure. Stale or duplicated IDs in a stored route are ignored, and
 * a treasure found in one is dropped — it is always appended last.
 */
function dealStops(
  game: Pick<HuntGame, 'characters'>,
  progress: Pick<HuntProgress, 'route'> | null
): HuntCharacter[] {
  const treasure = treasureLocation(game.characters);
  const walkable = walkableStops(game.characters);
  const byId = new Map(game.characters.map(character => [character.id, character]));

  const stored: HuntCharacter[] = [];
  const seen = new Set<string>();
  for (const id of progress?.route ?? []) {
    const character = byId.get(id);
    if (!character || seen.has(character.id) || isTreasureStop(character)) continue;
    stored.push(character);
    seen.add(character.id);
  }

  const stops = stored.length > 0 ? stored : [...walkable];
  // Locations the creator added after this team joined still get walked — they
  // join in authored order, ahead of the treasure.
  const known = new Set(stops.map(character => character.id));
  const added = walkable.filter(character => !known.has(character.id));
  // The treasure closes every route: it is the location where the hunt ends,
  // so it is appended rather than dealt. A hunt with no treasure (authored
  // before it was required) simply ends on its last dealt stop.
  return treasure ? [...stops, ...added, treasure] : [...stops, ...added];
}

/**
 * The route a team actually plays: the hunt's locations in this team's dealt
 * order, each one exactly as the creator authored it — its own coordinates,
 * radius, clue, character (name, subtitle, dialogue, asset, banner), questions
 * and key — with the treasure location last.
 *
 * Nothing is rewritten here, and that is the point: a location is the unit of
 * the hunt, so whatever the radar points at, the question gate asks and the
 * reveal plays all come from the same authored entry. What a team is handed
 * and when is the hand-over's job, not the route's: the reveal that ends a stop
 * gives the next stop's clue + character + key, and the hunt opens with those
 * three for the team's first location (see `context/HuntContext`).
 *
 * Unlike the pin-shift model this replaced, no stop is ever re-anchored: the
 * player's live position is not part of a route at all, so it is not passed in.
 */
export function resolveRoute(
  game: Pick<HuntGame, 'characters'>,
  progress: Pick<HuntProgress, 'route'> | null
): HuntCharacter[] {
  return dealStops(game, progress);
}

