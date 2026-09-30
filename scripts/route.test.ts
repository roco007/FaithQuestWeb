/**
 * Route-engine checks for the location model, run with `npm run test:route`.
 *
 * The model under test (see `utils/huntRoute.ts`):
 *   - every publish deals a fresh order: a location tagged as the treasure is
 *     held back for last, a hunt that tags none is shuffled whole;
 *   - a round in progress keeps the order it joined with, so re-publishing
 *     never moves the stops under a team's feet;
 *   - every stop IS the location the creator authored: its own coordinates,
 *     radius, hint, character, questions and key, untouched by the deal;
 *   - the package a team holds is always the one for the stop ahead — the
 *     opening hand-over gives stop 1's hint + character + key, and each reveal
 *     after a find hands over the next stop's;
 *   - the treasure is dealt last, so every route finishes where the treasure is;
 *   - nothing stands with the player: no re-anchoring, no key-less stop;
 *   - the exported file states the hunt's order, START first and the stop the
 *     game must end on last (see section 12).
 */
import assert from 'node:assert/strict';
import {
  buildRoute,
  dealPublishedRoute,
  isTreasureStop,
  treasureLocation,
  walkableStops,
  resolveRoute,
} from '../utils/huntRoute';
import { buildHuntExport, buildHuntOrder } from '../services/huntFile';
import type { HuntCharacter, HuntGame } from '../types/hunt';

const make = (id: string, order: number, extra: Partial<HuntCharacter> = {}): HuntCharacter => ({
  id,
  order,
  name: id,
  subtitle: `${id} subtitle`,
  latitude: 10 + order,
  longitude: 20 + order,
  altitudeMeters: order,
  radiusMeters: 12,
  characterType: 'guardian',
  hint: `${id} clue`,
  dialogue: `${id} dialogue`,
  key: `KEY${id}`,
  ...extra,
});

const characters: HuntCharacter[] = [
  make('L1', 1),
  make('L2', 2, { isTreasure: true }),
  make('L3', 3),
  make('L4', 4),
  make('L5', 5),
];
const game = { characters } satisfies Pick<HuntGame, 'characters'>;
/** The authored location behind an id — what a stop must still look like. */
const authored = (id: string) => characters.find(character => character.id === id)!;

// 1) The deal covers every walkable location exactly once, never the treasure,
//    and is not simply the authored order again.
const authoredWalkable = ['L1', 'L3', 'L4', 'L5'];
const seenFirstStops = new Set<string>();
for (let i = 0; i < 300; i++) {
  const dealt = buildRoute(characters);
  assert.equal(dealt.length, authoredWalkable.length);
  assert.equal(new Set(dealt).size, authoredWalkable.length);
  for (const id of authoredWalkable) assert.ok(dealt.includes(id), `missing ${id}`);
  assert.ok(!dealt.includes('L2'), 'the treasure is never shuffled into a route');
  assert.notDeepEqual(dealt, authoredWalkable, 'dealt route must not equal the authored order');
  seenFirstStops.add(dealt[0]);
}
assert.ok(seenFirstStops.size >= 3, `first stops should vary: ${[...seenFirstStops]}`);

// 2) Walkable locations in authored order, treasure excluded and findable —
//    under either flag name, so hunts saved before the rename still play.
assert.deepEqual(walkableStops(characters).map(character => character.id), authoredWalkable);
assert.equal(treasureLocation(characters)?.id, 'L2');
assert.ok(isTreasureStop({ isTreasure: true } as HuntCharacter));
assert.ok(isTreasureStop({ isCongratulations: true } as HuntCharacter));
assert.ok(!isTreasureStop({} as HuntCharacter));

// 3) The core of the model: a resolved stop is EXACTLY the authored location —
//    same place, same clue, same character, same questions, same key. No pin
//    shift, no re-anchoring, nothing borrowed from the stop before it.
const route = buildRoute(characters);
const resolved = resolveRoute(game, { route });
assert.deepEqual(
  resolved.map(stop => stop.id),
  [...route, 'L2'],
  'dealt order first, the treasure last'
);
for (const stop of resolved) {
  const source = authored(stop.id);
  assert.equal(stop.latitude, source.latitude, `${stop.id} keeps its own latitude`);
  assert.equal(stop.longitude, source.longitude, `${stop.id} keeps its own longitude`);
  assert.equal(stop.altitudeMeters, source.altitudeMeters, `${stop.id} keeps its own height`);
  assert.equal(stop.radiusMeters, source.radiusMeters, `${stop.id} keeps its own radius`);
  assert.equal(stop.hint, source.hint, `${stop.id} keeps its own hint (H)`);
  assert.equal(stop.key, source.key, `${stop.id} keeps its own key (K)`);
  assert.equal(stop.name, source.name, `${stop.id} keeps its own character (C)`);
  assert.deepEqual(stop.questions, source.questions, `${stop.id} keeps its own questions (Q)`);
  assert.ok(!('standsWithPlayer' in stop), 'no stop stands with the player any more');
}

// 4) The hand-over pairing the play screens rely on: the package in hand is
//    always the one for the stop ahead — stop 1's own three when the hunt
//    opens, then each stop's own three given by the reveal at the stop before.
assert.equal(
  resolved[0].hint,
  authored(route[0]).hint,
  'the opening hand-over gives the first location its own clue'
);
assert.equal(
  resolved[0].key,
  authored(route[0]).key,
  'and the key that opens it'
);
for (let i = 1; i < resolved.length; i++) {
  assert.equal(
    resolved[i].hint,
    authored(resolved[i].id).hint,
    `${resolved[i].id} walks with the clue handed over at ${resolved[i - 1].id}`
  );
  assert.equal(
    resolved[i].key,
    authored(resolved[i].id).key,
    `${resolved[i].id} opens with the key handed over at ${resolved[i - 1].id}`
  );
}

// 5) The treasure is every route's end, on its own authored ground.
assert.equal(resolved[resolved.length - 1].id, 'L2');
assert.equal(resolved[resolved.length - 1].latitude, authored('L2').latitude);

// 6) Progress saved before routes existed: authored order, treasure last.
const legacy = resolveRoute(game, null);
assert.deepEqual(
  legacy.map(stop => stop.id),
  [...authoredWalkable, 'L2']
);
assert.equal(legacy[0].latitude, authored('L1').latitude, 'stop 1 sits on its own pin');
assert.equal(
  legacy[legacy.length - 1].key,
  authored('L2').key,
  'the treasure opens with its own key'
);

// 7) Stops missing from the stored route (the creator added some after the deal,
//    or the stored route is partial) are walked too — after the dealt ones, in
//    authored order, and the treasure still closes the route.
const withNewStop = [characters[0], characters[2], characters[3], make('L6', 6), characters[1]];
const merged = resolveRoute({ characters: withNewStop }, { route: ['L4', 'L1'] });
assert.deepEqual(
  merged.map(stop => stop.id),
  ['L4', 'L1', 'L3', 'L6', 'L2'],
  'the dealt order first, the rest in authored order, the treasure last'
);
const added = withNewStop.find(character => character.id === 'L6') as HuntCharacter;
assert.equal(merged[3].latitude, added.latitude, 'the added location sits on its own pin');
assert.equal(merged[3].key, added.key, 'and opens with its own key');

// 8) Stale, duplicated and treasure ids in a stored route are dropped.
const cleaned = resolveRoute(game, { route: ['GONE', 'L4', 'L4', 'L2', 'L1'] });
assert.deepEqual(
  cleaned.map(stop => stop.id),
  ['L4', 'L1', 'L3', 'L5', 'L2'],
  'stale/duplicate/treasure ids are ignored, the rest join in authored order'
);
const treasureOnly = resolveRoute(game, { route: ['L2'] });
assert.deepEqual(
  treasureOnly.map(stop => stop.id),
  [...authoredWalkable, 'L2'],
  'a stored route of nothing but the treasure falls back to every walkable location'
);

// 9) No location tagged as the treasure (the deal decides the end, and old
//    shared files exist): the route is simply every location in order, and each
//    still stands its ground.
const noTreasure: HuntCharacter[] = [make('A', 1), make('B', 2), make('C', 3)];
const plain = resolveRoute({ characters: noTreasure }, { route: ['C', 'A', 'B'] });
assert.deepEqual(
  plain.map(stop => stop.id),
  ['C', 'A', 'B']
);
const plainSource = (id: string) => noTreasure.find(character => character.id === id)!;
assert.equal(plain[0].latitude, plainSource('C').latitude);
assert.equal(plain[1].latitude, plainSource('A').latitude);
assert.equal(plain[2].latitude, plainSource('B').latitude);
assert.equal(plain[2].radiusMeters, plainSource('B').radiusMeters);

// 10) One walkable location + treasure: both in their own place, each with its
//     own key — the treasure is walked to like any other stop, then ends it.
const soloStop = make('S', 1);
const solo = resolveRoute(
  { characters: [soloStop, { ...authored('L2'), order: 2 }] },
  { route: ['S'] }
);
assert.deepEqual(
  solo.map(stop => stop.id),
  ['S', 'L2']
);
assert.equal(solo[0].latitude, soloStop.latitude);
assert.equal(solo[1].latitude, authored('L2').latitude);
assert.equal(solo[1].key, 'KEYL2');

// 11) A hunt with no treasure tagged still ends somewhere: the last location in
//     the order it was dealt/authored is the stop that closes the route, and the
//     whole hunt can be completed. Nothing is stamped on publish — an untagged
//     hunt keeps every location walkable, so the deal decides where it ends.
const untagged = resolveRoute({ characters: noTreasure }, null);
assert.deepEqual(
  untagged.map(stop => stop.id),
  ['A', 'B', 'C'],
  'with nothing tagged the authored order stands and closes on the last location'
);
assert.equal(treasureLocation(noTreasure), null, 'nothing is tagged in this fixture');
assert.equal(
  untagged[untagged.length - 1].id,
  'C',
  'the last location in the order is where the hunt ends'
);

// 12) The exported order: the order teams walk (the same one `resolveRoute`
//     plays, so the file and play cannot disagree), START first and the stop the
//     game must end on last. A hunt with no dealt route exports the authored
//     order, with the treasure closing it.
const exportOrder = buildHuntOrder(game);
assert.equal(exportOrder.start, 'START');
assert.deepEqual(
  exportOrder.stops.map(stop => [stop.position, stop.name, stop.isEnd]),
  [
    [1, 'L1', false],
    [2, 'L3', false],
    [3, 'L4', false],
    [4, 'L5', false],
    [5, 'L2', true],
  ],
  'stops are listed in walk order, with the treasure as the final stop'
);
assert.equal(
  exportOrder.summary,
  'START -> L1 -> L3 -> L4 -> L5 -> L2 (the game must end here)',
  'the summary reads the order as one line, end marked'
);

// A location array out of authored order still exports in `order` order.
const shuffledArray = buildHuntOrder({
  characters: [make('B', 2), make('A', 1), make('C', 3)],
});
assert.deepEqual(
  shuffledArray.stops.map(stop => stop.name),
  ['A', 'B', 'C'],
  'a location array out of order still exports in its authored order'
);
assert.equal(
  shuffledArray.stops[2].isEnd,
  true,
  'and, with nothing tagged, the last location of that order is where the game ends'
);

// A single-location hunt is its own end, and an empty one says so rather than
// producing a dangling arrow.
assert.equal(
  buildHuntOrder({ characters: [make('Only', 1)] }).summary,
  'START -> Only (the game must end here)'
);
assert.equal(buildHuntOrder({ characters: [] }).summary, 'START -> (no locations)');

// The envelope carries the order beside the game, and re-importing the exported
// file gives the same hunt back (the order is descriptive, never authoritative).
const exported = buildHuntExport({ id: 'FQ-1', ...game } as HuntGame);
assert.equal(exported.order.summary, exportOrder.summary, 'the file states the order');
assert.ok(exported.game.characters.length === 5, 'the game still travels with it');

// 13) A publish deals a fresh order every time. With a location tagged as the
//     treasure, it is held back for last and every other location is shuffled;
//     with nothing tagged, the whole list is shuffled, so the end moves too.
const publishedOrders = new Set<string>();
for (let i = 0; i < 300; i++) {
  const deal = dealPublishedRoute(characters);
  assert.equal(deal.length, characters.length, 'a deal covers every location');
  assert.equal(new Set(deal).size, characters.length, 'each location exactly once');
  assert.equal(deal[deal.length - 1], 'L2', 'the tagged treasure is dealt last, never shuffled');
  assert.notEqual(deal[0], 'L2', 'and never dealt first');
  assert.deepEqual(
    [...deal].sort(),
    [...authoredWalkable, 'L2'].sort(),
    'nothing is dropped and nothing is duplicated'
  );
  publishedOrders.add(deal.join('>'));
}
assert.ok(
  publishedOrders.size >= 3,
  `re-publishing should deal a new order each time: ${publishedOrders.size} distinct`
);

const untaggedOrders = new Set<string>();
const untaggedEnds = new Set<string>();
for (let i = 0; i < 300; i++) {
  const deal = dealPublishedRoute(noTreasure);
  assert.equal(deal.length, noTreasure.length, 'an untagged hunt deals its whole list');
  assert.equal(new Set(deal).size, noTreasure.length, 'each location exactly once');
  untaggedOrders.add(deal.join('>'));
  untaggedEnds.add(deal[deal.length - 1]);
}
assert.ok(untaggedOrders.size >= 3, 'an untagged hunt is re-dealt too');
assert.ok(
  untaggedEnds.size >= 2,
  `and its end is wherever the new order finished: ${[...untaggedEnds].join(', ')}`
);

// 14) Which order a team plays, in order of authority: the round it joined
//     with, then the order this publish dealt, then the authored order.
const publishedGame = {
  characters,
  route: dealPublishedRoute(characters),
} satisfies Pick<HuntGame, 'characters' | 'route'>;
const joiningNow = resolveRoute(publishedGame, null);
assert.deepEqual(
  joiningNow.map(stop => stop.id),
  publishedGame.route,
  'a team joining from this publish walks the order the publish dealt'
);
assert.equal(joiningNow[joiningNow.length - 1].id, 'L2', 'which still ends at the treasure');

const republished = { characters, route: dealPublishedRoute(characters) };
const midRound = resolveRoute(republished, { route: publishedGame.route });
assert.deepEqual(
  midRound.map(stop => stop.id),
  publishedGame.route,
  'a round in progress keeps the order it joined with, whatever was published since'
);
const joiningLater = resolveRoute(republished, null);
assert.deepEqual(
  joiningLater.map(stop => stop.id),
  republished.route,
  'the new deal applies to teams that join afterwards'
);

// 15) The exported order states the order that publish dealt, not the authored
//     list, so the file and the share link cannot disagree.
const dealtOrder = buildHuntOrder(publishedGame);
assert.deepEqual(
  dealtOrder.stops.map(stop => stop.name),
  publishedGame.route,
  'the file lists the dealt order'
);
assert.equal(
  dealtOrder.stops[dealtOrder.stops.length - 1].isEnd,
  true,
  'with the stop the hunt ends on marked last'
);

console.log(
  `route tests passed — ${resolved.length} stops per route, first stops across 300 deals: ${[
    ...seenFirstStops,
  ].join(', ')}`
);
