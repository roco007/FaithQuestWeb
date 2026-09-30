import type { HuntCharacter, HuntGame, HuntProgress } from '../types/hunt';

/**
 * Routes for the treasure hunt, pure and storage-free.
 *
 * The unit is a **location**, and a location is authored complete: where it is,
 * the clue that leads to it (H), the character that appears there and plays its
 * video (C), the questions asked on arrival (Q) and the key that unlocks them
 * (K). Nothing about a location is moved around at play time — the order is the
 * only thing the hunt deals.
 *
 *     authored locations            L1, L2 (treasure), L3
 *     the order a publish deals     L3  →  L1  →  L2
 *     handed over when the hunt opens      H3, C3, K3
 *     handed over when Q3 is cleared       H1, C1, K1
 *     handed over when Q1 is cleared       H2, C2, K2
 *     cleared Q2 at the treasure           congratulations
 *
 * Three rules shape that.
 *
 * 1. **The deal happens when the hunt is published**, not when a team joins:
 *    every press of Publish / Save Changes deals a fresh order
 *    (`dealPublishedRoute`) and stores it on the hunt, so the route travels with
 *    the share link, the share code and the exported file. Publishing the same
 *    hunt again hands out a different route. A hunt that tags a location as the
 *    treasure holds it back and shuffles every other location; a hunt that tags
 *    none is shuffled whole, so the last location of the dealt order is where
 *    that hunt ends.
 *
 * 2. **A round is never reshuffled under a team.** `resolveRoute` reads the
 *    order the team joined with first (`HuntProgress.route`), so a creator
 *    re-publishing mid-hunt cannot move the stops a team is walking; the deal
 *    the hunt now carries applies to teams that join afterwards.
 *
 * 3. **A stop is exactly the location the creator wrote.** Its coordinates,
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

/** Locations in authored order — `order` ascending, which is the order of record. */
function authoredOrder(characters: HuntCharacter[]): HuntCharacter[] {
  return [...characters].sort((a, b) => a.order - b.order);
}

/**
 * The hunt's walkable locations, in authored order — every location except the
 * treasure. The treasure is never shuffled: a publish holds it back and deals
 * it last, so it is what every team's route ends on.
 */
export function walkableStops(characters: HuntCharacter[]): HuntCharacter[] {
  return authoredOrder(characters).filter(character => !isTreasureStop(character));
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
 * Deals the order a publish hands out: the hunt's walkable locations shuffled,
 * with the treasure — when a location is tagged as it — held back for last. A
 * reshuffle makes sure the dealt order is not simply the authored order again.
 *
 * When **no** location is tagged, `walkableStops` is every location, so the
 * whole list is shuffled and the last location of the dealt order is where that
 * hunt ends. A deal therefore always has an end: the tagged treasure, or
 * whichever location the shuffle happened to finish on.
 *
 * Called once per publish (`normaliseGame`), so pressing Publish / Save Changes
 * again deals a new order and shares that one.
 */
export function dealPublishedRoute(characters: HuntCharacter[]): string[] {
  const deal = buildRoute(characters);
  const treasure = treasureLocation(characters);
  return treasure ? [...deal, treasure.id] : deal;
}

/** Resolves dealt ids to locations, dropping stale, duplicate and treasure ids. */
function stopsFromIds(
  ids: readonly string[] | undefined,
  byId: Map<string, HuntCharacter>
): HuntCharacter[] {
  const stops: HuntCharacter[] = [];
  const seen = new Set<string>();
  for (const id of ids ?? []) {
    const character = byId.get(id);
    if (!character || seen.has(character.id) || isTreasureStop(character)) continue;
    stops.push(character);
    seen.add(character.id);
  }
  return stops;
}

/**
 * The locations a team plays, in the order they play them. Three sources, in
 * order of authority:
 *
 *   1. `progress.route` — the order that team joined with, kept for the whole
 *      round so a re-publish mid-hunt never moves a stop under their feet;
 *   2. `game.route` — the order this publish dealt, which travels in the share
 *      link, the share code and the exported file;
 *   3. the authored order — a hunt saved before routes existed.
 *
 * Stale, duplicated or treasure ids in either route are ignored, a location the
 * creator added after the deal still gets walked (in authored order, ahead of
 * the end), and the treasure — when there is one — closes the route.
 */
function dealStops(
  game: Pick<HuntGame, 'characters' | 'route'>,
  progress: Pick<HuntProgress, 'route'> | null
): HuntCharacter[] {
  const treasure = treasureLocation(game.characters);
  const walkable = walkableStops(game.characters);
  const byId = new Map(game.characters.map(character => [character.id, character]));

  const fromProgress = stopsFromIds(progress?.route, byId);
  const fromGame = stopsFromIds(game.route, byId);
  const stops =
    fromProgress.length > 0 ? fromProgress : fromGame.length > 0 ? fromGame : [...walkable];

  // Locations the creator added after the deal still get walked — they join in
  // authored order, ahead of the end.
  const known = new Set(stops.map(character => character.id));
  const added = walkable.filter(character => !known.has(character.id));
  // The treasure closes every route: it is the location where the hunt ends, so
  // it is appended rather than dealt. A hunt with no tagged treasure simply ends
  // on the last location its dealt order produced.
  return treasure ? [...stops, ...added, treasure] : [...stops, ...added];
}

/**
 * The character a team **meets** at a stop.
 *
 * A stop owns the *place*: its pin, radius, clue, key and questions. The figure
 * standing on that pin is the **next location's** character — the one whose
 * clue is handed over when this stop's gate is passed, and the one whose video
 * plays when they are let through. So walking a route, a team meets each
 * location's character one step ahead of the place they are standing in, which
 * is what makes the hand-over read as "this character is sending you to its own
 * location".
 *
 * The last stop is where that rule runs out: there is no next location, only the
 * end of the hunt. The figure standing there is the **end-of-hunt character** —
 * the one the creator chose to appear with the End-of-Hunt Announcement — so the
 * walk to the treasure ends on the character that is about to congratulate the
 * team, instead of the treasure location's own figure reappearing, which is the
 * very character that just handed over the last clue. Its clip is held on its
 * first frame while the team walks in and types the key, and plays when the key
 * is accepted.
 *
 * The end-of-hunt character is a roster entry rather than a location, so what is
 * returned is the stop's own entry re-pointed at it: only what a *character*
 * needs (the asset, the procedural type) is read off the result, and the roster
 * supplies the real name and accent when it renders. A hunt with no end-of-hunt
 * character to show — one shared before that choice existed — keeps the old
 * behaviour and stands the stop's own character there.
 *
 * Returns null for a stop that is not on the route.
 */
export function characterMetAt(
  route: HuntCharacter[],
  stopId: string,
  endCharacterAssetId?: string | null
): HuntCharacter | null {
  const index = route.findIndex(character => character.id === stopId);
  if (index === -1) return null;
  const next = route[index + 1];
  if (next) return next;
  if (!endCharacterAssetId) return route[index];
  return { ...route[index], characterAssetId: endCharacterAssetId };
}

/**
 * The route a team actually plays: the hunt's locations in this team's order,
 * each one exactly as the creator authored it — its own coordinates, radius,
 * clue, character (name, subtitle, asset, banner), questions and key.
 *
 * Nothing is rewritten here, and that is the point: a location is the unit of
 * the hunt, so whatever the radar points at, the question gate asks and the
 * reveal plays all come from the same authored entry. What a team is handed and
 * when is the hand-over's job, not the route's: the reveal that ends a stop
 * gives the next stop's clue + character + key, and the hunt opens with those
 * three for the team's first location (see `context/HuntContext`).
 *
 * Unlike the pin-shift model this replaced, no stop is ever re-anchored: the
 * player's live position is not part of a route at all, so it is not passed in.
 */
export function resolveRoute(
  game: Pick<HuntGame, 'characters' | 'route'>,
  progress: Pick<HuntProgress, 'route'> | null
): HuntCharacter[] {
  return dealStops(game, progress);
}

