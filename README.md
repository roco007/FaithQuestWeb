# FaithQuest — Web

The browser edition of **FaithQuest**, a location-based scripture scavenger hunt.
Players explore real landmarks on a live map, close in on "guardian" characters
via a proximity radar, and solve puzzles to earn XP, badges, and relics.

This is a standalone **Next.js 16 (App Router) + React 19 + TypeScript** app.
It is a true web port — not an Expo web export — so it runs as a normal website
and can be deployed to any static/Node host (Vercel, Netlify, Cloudflare, etc.).

## Quick start

```bash
cd web
npm install
npm run dev      # http://localhost:3000
```

Production build:

```bash
npm run build
npm start
```

Checks (route engine + character manifest):

```bash
npm test
```

## What's here

| Route        | Purpose                                                          |
| ------------ | ---------------------------------------------------------------- |
| `/`          | Quest map — live GPS, proximity radar, clue puzzles            |
| `/games`     | Treasure hunts: create, share by code, join, and play             |
| `/creator`   | Hunt authoring: place characters on a map, design clues           |
| `/inventory` | Pilgrim backpack — collected relics                               |
| `/profile`   | Trophies, badges, XP stats, and field standings                   |

## Platform substitutions (native → web)

| Concern     | Native (Expo)                | Web port                                            |
| ----------- | ---------------------------- | --------------------------------------------------- |
| Map         | `react-native-maps` + Google | Google Maps JS API when a key is set, else keyless Leaflet + OpenStreetMap |
| GPS         | `expo-location` watch        | Browser Geolocation API (`watchPosition`, one app-wide watch) |
| AR camera   | `expo-camera` + `expo-gl`    | `getUserMedia` rear-camera feed                    |
| AR sensors  | `expo-location` heading + `expo-sensors` accelerometer | `DeviceOrientation` events (iOS permission prompt honoured) |
| AR 3D layer | `expo-gl` + three.js          | Plain WebGL `<canvas>` + three.js (same `0.162.x` pin) |
| Persistence | `AsyncStorage`               | `localStorage` (`utils/webStorage.ts`)              |
| Haptics     | `expo-haptics`               | `navigator.vibrate` (progressive enhancement)       |
| Audio cues  | Native sound pack            | Web Audio API synthesized tones                     |
| Voice clues | Native TTS                   | `speechSynthesis`                                   |
| Share sheet | `Share` API                  | Clipboard (`navigator.clipboard`)                   |
| Modals      | `<Modal>`                    | Accessible dialogs (Esc, backdrop click, scroll lock) |

The `ar/` Three.js AR camera view is ported as `components/HuntARCamera.tsx`:
a fullscreen `getUserMedia` rear-camera feed with the same procedural 3D
characters composited over it via a plain WebGL canvas (`components/ar/`,
`three@0.162.x`), placed by the shared `utils/arPlacement.ts` maths driven by
`DeviceOrientation` events (`hooks/useDeviceOrientation.ts`). The whole
discovery loop runs on that frame, in three phases: walk inside the radius and
hold the reticle on the character for 900 ms to *sight* it; the sighted
character then stays in view while the key from the previous stop is presented
in the form docked at the bottom of the frame (a wrong key is rejected and the
hunt does not advance); the right key makes the character answer in text +
voice — its message, the key it hands over and the next location's hint appear
over its head and are read aloud (`utils/speech.ts`, replayable) until the
player continues. That bubble hangs strictly *above* the character, tail
pointing at it: the framing reserves its measured height (the model is kept
below it, never behind it), and the one case where it cannot fit — a very tall
hand-off on a very short screen — docks the reveal into the HUD instead of
covering the model. Only the final discovery leaves the camera, celebrating in
`HuntPlay`. Without a camera, or when WebGL cannot draw the model, the flow
stays reachable: a labelled fallback skips the sighting and the reveal docks
into the HUD instead of the head bubble. On desktop/no-compass devices the view
auto-aims at the target, the same fallback the native app uses. The core
hunt loop (map, GPS, puzzles, hunts, rewards) is fully supported on the web.

## Sharing a hunt: number keys and invite links

A hunt is identified by a **plain whole number that counts up from 0** on the
device: the first hunt published is `0`, then `1`, `2` … `100`, `101`. The
sequence is allocated by `nextGameId(takenIds)`, which picks one past the highest
number already in use.

Numbers are stored as strings (the hunt record is keyed by ID) but
`INTEGER_ID_PATTERN` means **digits only** is ever accepted, and `parseGameId`
canonicalises them — so `007` and `7` both address hunt 7. The sequence never
fills the gaps left by deleted hunts: because a share code embeds the hunt it
came from, handing a deleted hunt's number to a new one would silently send
anyone still holding that code to the wrong treasure. Legacy `FQ1:XXXXXX` and
`FQ-XXXXXX` keys are still matched by `extractGameId` so hunts saved before this
change keep working; new hunts never produce them.

> **Scope note:** numbers are allocated per device from its local storage. Two
> devices that each publish their first hunt both get `0`. That is harmless
> today, because a hunt only ever travels as its self-contained share code or
> invite link (which carries the whole hunt, number included) rather than being
> looked up by number — but it does mean the number is *not* globally unique.
> See "no backend" above: making it global needs a server.

Publishing ends in a share sheet that offers two things: the **invite link**
(`buildGameJoinUrl`) and the full message. Because there is no backend, the link
carries the whole hunt itself — base64 of the game payload, appended as
`/games#join=…`. The fragment (not the query string) is deliberate: it is never
sent to the server nor leaked through `Referer`, which matters for a link passed
around messaging apps.

Opening that link lands the player on `/games` with a confirmation dialog —
**"You've been invited to a hunt"** — naming the creator, the title and the
character count. Nothing is saved until the player chooses *Yes, join this hunt*,
so a link that is merely previewed in a chat app, opened on a borrowed phone, or
belonging to a hunt already in progress can never silently replace what the
player is playing. Declining is a no-op. If the invite is the hunt already being
played, the dialog says so and just offers *Continue hunt*.

`joinGame` resolves pasted input in this order, so a creator's link and a
hunt key behave identically in the join box:

1. `extractShareCode` → `decodeGameShareCode` — a bare `FQ1:…` code, or the same
   code percent-encoded inside a pasted link (it is decoded defensively, so a
   link that a chat app re-encoded still works).
2. `extractGameId` — a bare hunt number, a number quoted in a message
   (`Hunt number: 12`), or a legacy `FQ1:XXXXXX` / `FQ-XXXXXX` key, found
   anywhere in the pasted text.

Anything else is rejected with the "Game not found" error rather than resolved to
a different hunt.

## Every publish deals a new order

The order of locations is not fixed by the creator — it is **dealt fresh every
time the hunt is published**, and that deal is what gets shared, in
`utils/huntRoute.ts`:

- `dealPublishedRoute` — called once per Publish / Save Changes from
  `normaliseGame`, and stored on the hunt as `HuntGame.route`. It shuffles with
  an unbiased Fisher–Yates draw, and the treasure rule is:

  | a location is tagged **"This is the treasure location"** | nothing is tagged |
  | --- | --- |
  | it is **held back** and dealt **last**; every other location is shuffled | the **whole list** is shuffled, and the last location of the deal is where that hunt ends |

  So the same hunt published twice hands out two different routes, and the
  share link, the share code and the exported file all carry the order that
  publish dealt. Re-publishing mid-round never disturbs a team that is already
  walking: its order is pinned on join (`HuntProgress.route`).
- `resolveRoute` — the only place a route becomes stops, and **nothing is
  rewritten**: each stop is the location the creator authored, with its own
  coordinates, radius, hint, character, questions and key, in the dealt order
  with the end last:

  | the team walks | the order came from |
  | --- | --- |
  | the order it joined with | pinned on join, so a re-publish never moves a stop under it |
  | the order this publish dealt | `HuntGame.route` — what the share link and file carry |
  | the authored order | a hunt saved before routes existed |

  | stop | place | character + questions | opened by |
  | --- | --- | --- | --- |
  | dealt stop 1 | stop 1's own pin | stop 1's own | stop 1's key (given at the opening) |
  | dealt stop 2 | stop 2's own pin | stop 2's own | stop 2's key (given at stop 1's reveal) |
  | … | … | … | … |
  | the last dealt stop | its own pin | its own | its key (given at the stop before) |

  | stop | place | character + questions | opened by |
  | --- | --- | --- | --- |
  | dealt stop 1 | stop 1's own pin | stop 1's own | stop 1's key (given at the opening) |
  | dealt stop 2 | stop 2's own pin | stop 2's own | stop 2's key (given at stop 1's reveal) |
  | … | … | … | … |
  | the treasure | the treasure's own pin | the treasure's own | its key (given at the stop before) |

So **everything a stop needs belongs to the location** — H (the clue that leads
there), C (the character that appears there and plays its video), Q (the
questions asked there) and K (the key that unlocks them). What the dealt order
changes is only *when* a team gets each package: the hunt opens with their first
location's H + C + K, and the reveal that ends a stop hands over the next
location's H + C + K.

Discovery, the radar, the AR camera, the key ribbon and the clue line all read
`activeRoute` from `HuntContext` — never `activeGame.characters`, which stays in
the creator's authored order. A location the creator adds after a deal still
gets walked, ahead of the end.

The creator marks the treasure with **"This is the treasure location"** in the
location editor. A hunt has at most one: publishing keeps the first flagged
location and clears the others, and the 🎁 Treasure pill sits on that row.
**The flag is optional** — leave it unticked and the whole list is scrambled,
so the hunt ends wherever that publish's order finishes. Either way `/creator`
states which order a publish will deal above the list, and the share sheet shows
the order that was just dealt (with the end marked), so the ending is never a
surprise. The end is walked to like any other stop (its own place, character,
questions and key); clearing it is what shows the congratulations screen.

## The exported file states the order

Every exported hunt (`services/huntFile.ts`) carries an `order` block beside the
game, so the file reads on its own:

```json
"order": {
  "start": "START",
  "stops": [
    { "position": 1, "name": "The Old Well", "isEnd": false },
    { "position": 2, "name": "Riverside Steps", "isEnd": false },
    { "position": 3, "name": "The Bell Tower", "isEnd": true }
  ],
  "summary": "START -> The Old Well -> Riverside Steps -> The Bell Tower (the game must end here)"
}
```

It is the order this publish **dealt** — read from `resolveRoute`, the same
function play uses, so the file and the game cannot disagree — with `isEnd` on
the last stop. The `order` block itself is descriptive: the order of record is
`game.route` (and each location's own `order` field), so the importer ignores
`order` entirely and a hand-edited or stale block cannot desynchronise a hunt.
Re-importing a file and publishing it deals a new order, because every publish
does. A round already in progress keeps the order it joined with, so a team can
briefly be walking an order older than the latest file.

## The end of the hunt

The congratulations screen is the **End-of-Hunt Announcement** plus the
character chosen beside it (**End-of-Hunt Character**), both authored in Game
Details on `/creator` and both required — publishing without them is refused.
The character is any camera roster entry, so a celebration clip such as
`found-hidden-treasure` plays alongside the announcement when a team clears the
treasure location. Hunts shared before the end character existed fall back to
the treasure location's own character, so a round can always finish.

## The opening meeting

When a team joins, the **first location's character appears with them** —
wherever they are standing, whatever that location's coordinates are. The AR
camera opens on its own and runs a `meeting` phase (`HuntARCamera`):

- the character is anchored to the **player**, not to its own pin
  (`meetingAnchor` in `utils/geo.ts`: a fixed 3.2 m due north of the live
  position), so it is framed dead ahead every time. This is the one moment in a
  hunt with no creator-authored anchor, and that is the point — the team has not
  walked there yet, so there is nothing to anchor to;
- it hands over **its own location's clue and key** (H + K), spoken aloud with
  `speakClue` exactly like a reveal, and **its video plays** if it is a cutout
  roster character;
- no key is presented and **no questions are asked** — the meeting records
  nothing. The stop is still walked to: inside its radius, its key presented and
  its questions answered is what completes it.

"Start walking" (or backing out of the camera) ends the meeting; it is shown
once per round, and reopening the camera before dismissing it greets the team
again. Everything after it is unchanged: each stop asks its own questions and
the reveal hands over the next location's clue, character and key, until the
final stop, whose questions end the hunt on the congratulations screen with the
End-of-Hunt Character.

## Clues and keys stay on screen

Two things the player must never have to remember or hunt for:

- **The clue ahead.** The team is always holding the clue for the stop they are
  walking to: it arrives with the opening meeting (first stop) or with the
  reveal at the stop before it, so it is readable the moment it is given — on
  the meeting's own panel, on the `/games` active-hunt card and in `HuntPlay` —
  rather than waiting for a discovery radius. Distance and bearing stay behind
  the explicit location check until the player is inside the discovery zone, and
  locations beyond the team's next stay anonymous in the route list, so strict
  visibility on *proximity* is unchanged.
- **The key in hand.** A location's key opens that location, and it arrives one
  stop early — so what is on screen is always the key for the walk ahead.
  `components/KeyInHand.tsx` pins it to the screen: the ribbon under the hunt
  progress bar (labelled *Your first key — opens your first location* while
  nothing has been discovered, *Latest key received* afterwards), the
  active-hunt card on `/games`, and a chip on the AR frame in every phase
  (hunting, key entry, reveal) — so it is still readable while typing it into
  the form. Tapping the ribbon or the chip copies the key, so it can be pasted
  into the field.

## Geolocation requires HTTPS

Browsers only expose Geolocation (and Camera, Clipboard, Service Workers) inside
a **secure context**: HTTPS, or `localhost`. On the computer you were testing
`http://localhost:3000`, which browsers trust by definition. On your phone you
opened the same server through its LAN address (`http://192.168.x.x:3000`) —
plain HTTP to a non-localhost host — so the browser withheld
`navigator.geolocation` entirely, so the app stayed on the waiting screen. Nothing
was broken; the page simply was not trusted.

The app detects this and names the cause and the fix in a banner. There is no
simulator any more: the device's GPS is the only source of position, so on an
untrusted origin the app simply waits and tells you to open it over HTTPS.

**To use real GPS on your phone**, start the HTTPS tunnel and open the
`https://…trycloudflare.com` URL it prints:

```bash
cd web
npm run dev:tunnel     # requires cloudflared on PATH: brew install cloudflared
```

Accept the certificate warning if the phone shows one, then allow location
access when prompted. This is for local testing only — for anything permanent,
deploy to a host that serves HTTPS (Vercel, Netlify, Cloudflare Pages), since
that is what makes the origin trusted on every device.

Next.js also blocks cross-origin requests to dev-only assets (HMR, client
chunks) unless the hostname is listed in `allowedDevOrigins`; that is why
`next.config.ts` pre-allows LAN addresses (`192.168.*.*`) and
`*.trycloudflare.com`. A phone opening the LAN IP without it gets a stale page
that never picks up edits. **Restart `npm run dev` / `npm run dev:tunnel` after
changing that list** — the option is read once at startup.

If a link was opened from WhatsApp/Instagram, use "Open in Safari/Chrome": those
in-app browsers also withhold location access.

## In-range detection (and what to do when it stalls)

Proximity runs on the live GPS watch held by `context/LocationContext.tsx`, which
is mounted once in the root layout. It used to be started from the map page —
leaving the map for a hunt stopped the watch, the position froze, and a player
who then walked into a character's radius was never detected as being in range.

If it still stalls, the hunt screens say so out loud:

- **Your live position** — the player's latitude/longitude (6 dp), the fix's
  accuracy and how long ago it arrived, on the hunt card *and* on the AR frame
  (`components/LocationStatus.tsx`). Coordinates that never change, or an age
  that keeps climbing, are the tell that the watch has gone quiet.
- **"Check if I am in range"** — takes one fresh, uncached fix
  (`maximumAge: 0`, so a stale reading can never be re-used) and measures it
  against the current stop, printing the verdict inline (*"In range — 8m away,
  inside the 25m discovery zone"* / *"Not in range yet — 42m away…"*). Distance
  to a hidden stop is normally withheld by the strict-visibility rules; it is
  shown here because the player explicitly asked for that check.
- **"Location unavailable"** — no fix has arrived yet, or the browser is
  withholding Geolocation because the page is not a secure context. The watch
  is the only thing that can move the player now, so if the coordinates and the
  fix age never move, the cause is the page, not the game: open it over HTTPS
  (see *Geolocation requires HTTPS* above) and allow location access.

## Map providers

Every map in the app (the quest map and the creator's pin-placement picker) is
rendered by whichever provider is available:

| Provider | When | Why |
| --- | --- | --- |
| **Google Maps JS API** | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set | Native dark styling, vector tiles, draggable pins, better zoomed-in detail |
| **Leaflet + OpenStreetMap** | no key set, *or* Google fails to start | Keyless, so a fresh clone works immediately and a bad key never yields a blank map |

`components/GameMap.tsx` and `components/CharacterPinMap.tsx` are thin
dispatchers over `GoogleGameMap` / `GoogleCharacterPinMap` and
`LeafletGameMap` / `LeafletCharacterPinMap`. Both providers implement the same
props and the same imperative handle (`components/mapTypes.ts`), so no page or
component knows which one is mounted. The Google provider also hands control
back to Leaflet at runtime if the script fails to load, the key is rejected, or
the map reports that advanced markers are unavailable — a blank map would make
the whole quest unplayable, so that path is a first-class feature rather than a
stopgap.

### Enabling Google Maps

1. Enable the **Maps JavaScript API** *and* the **Places API (New)** on a Google
   Cloud project (the project needs billing enabled; Google grants a monthly
   free credit, after which map loads are charged). The map renders with the
   first; place search needs the second — without it, search silently falls
   back to the keyless Nominatim/Photon cascade, which cannot fuzzy-match
   business names like google.com/maps does.
2. Create an API key and **restrict it**:
   - *API restriction* → **Maps JavaScript API** + **Places API (New)**.
   - *Website restriction* → the origins you serve from, e.g.
     `http://localhost:3000/*` and your production domain.
   - The map key is visible in the client bundle by design, so the
     restriction — not secrecy — is what protects your quota. Place search
     goes through the same-origin `/api/places-search` proxy, so the key
     authorising it is never exposed beyond what the map already needs.
     Never ship an unrestricted key.
3. `cp .env.example .env.local` and set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
   `.env.local` is git-ignored; `.env.example` is the committed template.
4. Optionally set `NEXT_PUBLIC_GOOGLE_MAPS_API_MAP_ID`. Advanced markers (the
   app's HTML pins) require a map ID and refuse to load without one; the
   default is Google's `DEMO_MAP_ID`, which is fine for testing but uses a
   reduced-POI style. Create a real map ID (Map type: JavaScript) for
   production.

Testing on a phone via `npm run dev:tunnel`? The Cloudflare hostname is
different on every run, so a referrer-restricted key will be rejected — set
the website restriction to `*` while testing and restore it afterwards.

### How the two providers are kept honest

- `components/mapPins.ts` holds the marker artwork once. Both providers render
  the same HTML, so a pin change cannot drift between them.
- `utils/googleMapsLoader.ts` memoises the single script load and pulls only
  the `maps` and `marker` libraries via `importLibrary`. Note that
  `ColorScheme` and `LatLngBounds` are **not** members of the `maps` library
  object — they only exist on the `google.maps` namespace. That was verified
  against the live API after it threw; `types/google.maps.d.ts` records the
  distinction so it cannot regress.
- Google renders its own dark theme via `colorScheme: DARK`, so the CSS
  `invert()` filter that darkens OpenStreetMap tiles applies to Leaflet only.
  It must never be applied to Google — the Maps ToS forbid obscuring the logo
  and attribution, which is exactly what an inverted tile layer does.

## Notes

- No backend: hunts, progress, and relics live entirely in the browser.
  Clearing site data resets your game.
- Neither map library is imported at module scope: Leaflet is pulled with a
  dynamic `import()` inside an effect (it touches `window` at load), and the
  Google script is injected on demand by `utils/googleMapsLoader.ts`. Importing
  either eagerly would break server rendering.
- Leaflet fallback tiles come from `tile.openstreetmap.org` (keyless, z0-19)
  and are darkened with a CSS filter in `globals.css` to match the app's navy
  theme. Two earlier providers were dropped: CARTO's `dark_all` now watermarks
  unauthenticated requests with "API KEY REQUIRED", and Esri's World Dark Gray
  Canvas only publishes down to z16, so the z17-18 map returned "Map data not
  yet available". **If you switch providers, check the actual tile bytes** —
  both failures return HTTP 200, so a green network panel hides them.
- `navigator.vibrate` is ignored by browsers until the page has been activated
  by a real gesture, so `utils/sound.ts` gates haptics behind
  `navigator.userActivation` (falling back to a first-interaction listener).
  Without this the app logs a console error and buzzes on page load.
- Built and tested with Node 20+.
