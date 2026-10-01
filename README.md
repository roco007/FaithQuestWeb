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
| Share sheet | `Share` API                  | Deep links per app + `navigator.share` where available |
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
hunt does not advance); the right key lets it through,
and the hand-over appears over its head — the next location's name, the key for it
and its clue — until the player continues. **The hunt has no voiceover**: nothing
is read aloud, and a character has no lines of its own, so everything a team
needs is written on the frame and stays readable while they walk. A cutout video
character still plays with the sound baked into its own clip, and can be paused
or replayed from the chip row (both are shown only while a clip is rolling, and
only for video characters). That bubble hangs strictly *above* the character, tail
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

### The share sheet

`components/ShareLink.tsx` is the sheet both the Creator's publish panel and the
**Share** button on each hunt card open. It is the shape people already know
from YouTube and iOS: a row of app icons you tap, with the link underneath for
copying by hand.

| Target     | How it is reached                                       |
| ---------- | ------------------------------------------------------- |
| WhatsApp   | `wa.me/?text=` — title, summary and link in the body      |
| Messages   | `sms:?&body=` — same body                                |
| Facebook   | `sharer/sharer.php?u=` — the link only, its sharer adds  |
| X          | `intent/tweet?text=…&url=…` — link passed separately     |
| Reddit     | `reddit.com/submit?url=…&title=…`                        |
| LinkedIn   | `linkedin.com/sharing/share-offsite/?url=` — link only   |
| Pinterest  | `pin/create/button/?url=…&description=…`                 |
| Email      | `mailto:?subject=…&body=`                                 |
| **More**   | `navigator.share` — the OS share sheet                   |

Every target builds its own URL, because no two platforms want the same
arguments: Facebook's sharer takes the link alone, X and Reddit take the link
and the message separately (and would print the link twice if it were also
inlined in the text), and LinkedIn's share-offsite endpoint titles the post
itself. **Pinterest is the weakest fit here** — its Pin Creator fetches the URL
to build a preview card, and because the hunt lives in the fragment (never sent
to a server) it arrives as a bare app shell, so the pin and description post
fine but the image will be blank.

Glyphs live in `components/shareBrandGlyphs.tsx`. WhatsApp, Facebook, X, Reddit,
Pinterest and LinkedIn use the official outlines from
[Simple Icons](https://simpleicons.org) (CC0-1.0 — public domain, no attribution
required), each on its own service's colour, which is how the brand guidelines
intend them to be used. LinkedIn is taken from Simple Icons **v11**: it is the
one mark *removed* from the set after v11, so current releases ship no
`linkedin` slug at all. The outline is unchanged and still CC0, and this is the
ordinary share-button use — the mark, on LinkedIn's own colour, as the disc for
the tap that opens LinkedIn. **Messages** and **Email** are deliberately generic
shapes drawn for this app rather than brand marks: "text message" and "email"
have no canonical logo that isn't also someone else's (Apple Messages, Google
Messages, Messenger and SMS are four different marks for one tap, and a web page
cannot know which is installed). The same reason X is used rather than the
Twitter bird, which it replaced — a retired logo for a destination that is
still `twitter.com` would just be wrong.

Two details are deliberate:

- **X gets the link through `url=`, not inlined.** Inlining it as well prints
  the same link twice in the tweet.
- **The row is deep links, not `navigator.share`.** A tap on WhatsApp should
  reach WhatsApp whether or not the device exposes a share sheet, and the OS
  one cannot be themed or tested. "More" still hands off to it, because it is
  the only way to reach apps no static list can enumerate — and it appears only
  when `navigator.share` exists, resolved after mount so the prerender and the
  client render the same tree.

Web targets open a centred popup; `mailto:`/`sms:` navigate in place, because a
scheme URL handed to `window.open` is dropped by every browser. A blocked popup
falls back to the same tab. `noopener` is deliberately absent from the popup's
feature string — it makes browsers return `null` even on success, which would
read as "blocked" and bounce the player out of the app they were sharing into;
the opener is nulled by hand instead. The copy field stays selectable
throughout, so a blocked clipboard is a slower route and never a dead end.

Opening that link lands the player on `/games` with a confirmation dialog —
**"You've been invited to a hunt"** — naming the creator, the title and the
character count. Nothing is saved until the player chooses *Yes, join this hunt*,
so a link that is merely previewed in a chat app, opened on a borrowed phone, or
belonging to a hunt already in progress can never silently replace what the
player is playing. Declining is a no-op. If the invite is the hunt already being
played, the dialog says so and just offers *Continue hunt*.

## Joining checks location and camera first

*Yes, join this hunt* does not join — it advances to a **device-permission
checklist** (`components/JoinPreflight.tsx`), and only the checklist's own
*Join the hunt* button calls `joinGame`. The dialog therefore has three steps:
invite → checklist → hunt.

Two permissions are on it because a hunt cannot run without them, and both fail
*quietly* once refused: a denied GPS watch leaves the player walking around a map
that never notices they have arrived at a discovery zone, and a denied camera
leaves an AR view that never produces a frame. Neither failure announces itself,
so both are asked for up front instead.

How each is obtained (`hooks/useDevicePermissions.ts`):

- **Precise location** — `getCurrentPosition` with `enableHighAccuracy: true`,
  which is what makes Android offer the precise/coarse choice. The *accuracy of
  the fix that comes back* is how the choice is detected: a fix coarser than
  100 m is Android's approximate mode, and the row says so rather than quietly
  accepting it (a 25 m discovery zone cannot be entered on an approximate fix).
  A timeout or unavailable position is treated as retryable, never as a denial
  the player never gave.
- **Camera** — a `getUserMedia` probe with the same rear-facing constraint the
  AR view uses, so a grant here is a grant there. The tracks are stopped the
  moment they open: the camera light must not stay on for a player who is only
  walking a map.

Two details that keep it honest:

- **State is seeded from the Permissions API**, so a returning player who
  allowed location weeks ago is not asked again, and `change` events keep the
  rows honest if they revoke it from browser settings while the app is open.
- **Nothing is requested on mount.** Browsers only raise a geolocation or camera
  prompt inside a user gesture, so an automatic request would be silently
  dropped and the checklist would sit on "Needed" forever. Each row's *Allow*
  button is the gesture that raises its own prompt.

### A blocked permission cannot be re-prompted

Once an origin is blocked, `getCurrentPosition` / `getUserMedia` reject
**immediately and silently, forever** — no code path brings the prompt back, so a
blocked row has to *say* so rather than keep offering a retry as if it were the
whole answer.

The Permissions API is the only thing that distinguishes the two cases, because
the refusal error is identical either way:

| `permissions.query` | Meaning | What the row offers |
| ------------------- | ------- | ------------------- |
| `prompt` | the request would still raise a dialog | **Try again** |
| `denied` | origin is blocked; no prompt will ever appear | **Try again** + **How to allow** |

When the block is confirmed the checklist opens **platform-specific steps**
automatically (iOS Settings / Android Chrome site settings / desktop
site-settings panel). A blocked row keeps **both** buttons, because retrying is
still worth offering: the player may have already unblocked the site in their
settings without reloading, and in several browsers a dismissal (as opposed to a
hard block) is cleared by asking again. Fixing it in settings fires `change`, so
the row goes green on its own and the pair collapses back to *Check again*.

*Unsupported* (an insecure origin, no camera hardware, an in-app browser) offers
the guide alone — there is no API on that origin, so another request cannot
change anything.

*Join the hunt* stays locked until both are granted — but **"Join anyway" stays
available**, so a device that will never grant one of them (no camera hardware, a
policy-blocked device, an in-app browser that withholds prompts) is not trapped.

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

**A stop owns its place; the character met on it is the next location's**
(`characterMetAt`). Standing at a stop, the team walks that location's radius,
presents that location's key and answers that location's questions — and the
figure on the pin is the **next** location's character: the one whose own clue
and key are handed over the moment the gate opens, and whose video plays when
they are let through. So the hand-over always reads "this character is sending
you to its own location". The last stop is where that rule runs out: there is
no next location, only the end of the hunt, so the **End-of-Hunt Character**
stands there — the team walks the final stretch to the character that is about
to congratulate them, not to the same figure that just handed over the last
clue. Traced over the three-location hunt in
`public/changesProposed/`:

| the team stands at | the gate (this location) | the character met | handed over |
| --- | --- | --- | --- |
| Loc2 | key `XJPYV6` + `q_munojni5_22`, `q_munojrn8_42` | **Loc 3** — guardian, video `video-test-transparent`, *"welcome to loc 3"* | *"Hint That Leads Loc 3"* + key `8PDSQZ` |
| Loc 3 | key `8PDSQZ` + `q_munojni5_23`, `q_munojrn8_43` | **Loc1** — flame, *"welcome to loc 1"* | *"hinnt leads to lead 1"* + key `CC2VE5` |
| Loc1 (end) | key `CC2VE5` + `q_munojni5_21`, `q_munojrn8_41` | **End-of-Hunt Character** (the creator's pick) | nothing — its clip plays, then *Finish hunt* |

The opening meeting is the one exception: it greets with the **first stop's own**
character, because that is the location whose H + C + K is being handed over
before anything is walked.

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

The end of a hunt plays out in two beats. Accepting the **last** key is the
video beat: the **End-of-Hunt Character** — the roster entry chosen beside the
**End-of-Hunt Announcement** in Game Details on `/creator`, both required, as
publishing without them is refused — has been standing on that pin the whole
walk, held on its first frame, and now plays its clip full-frame with no
hand-over card over it. *Finish hunt* is the message beat: the camera closes and
the congratulations screen shows the announcement and the character's name, with
no second playback — the clip plays once, on the frame, and only there. Hunts
shared before the end character existed fall back to the treasure location's own
character, so a round can always finish.

A celebration clip such as `found-hidden-treasure` therefore plays at the last
find rather than on the page, and the page is the only place the announcement
text ever appears.

## The opening meeting

When a team joins, the **first location's character appears with them** —
wherever they are standing, whatever that location's coordinates are. The AR
camera opens on its own and runs a `meeting` phase (`HuntARCamera`):

- the character is anchored to the **player**, not to its own pin
  (`meetingAnchor` in `utils/geo.ts`: a fixed 3.2 m due north of the live
  position), so it is framed dead ahead every time. This is the one moment in a
  hunt with no creator-authored anchor, and that is the point — the team has not
  walked there yet, so there is nothing to anchor to;
- it hands over **its own location's clue and key** (H + K) on screen, exactly
  like a reveal, and **its video plays** if it is a cutout roster character;
- no key is presented and **no questions are asked** — the meeting records
  nothing. The stop is still walked to: inside its radius, its key presented and
  its questions answered is what completes it.

"Begin Hunt" (or backing out of the camera) ends the meeting; it is shown
once per round, and reopening the camera before dismissing it greets the team
again. **Begin Hunt is held back for the first 10 seconds**
(`START_WALK_DELAY_S`): the meeting is the one screen that explains the whole
hunt at once — greeting, clue, the key just handed over and how to use it — and
that button is the fastest thing on it to hit. While it is held the label
carries a live countdown and the helper text says why, because a silently
disabled control reads as a broken one rather than as a deliberate wait. The
moment it unlocks, a one-shot pop and ring mark the change and a slow glow
repeats until it is clicked; the glow animates `box-shadow` rather than
`transform`, so the button never moves under a thumb, and the whole thing is
dropped under `prefers-reduced-motion`. Backing out without dismissing it
restarts the full delay on the next open.

Everything after it is unchanged: each stop asks its own questions and
the reveal hands over the next location's clue, character and key, until the
final stop, whose questions are followed by the End-of-Hunt Character playing
its clip and *Finish hunt* opening the congratulations screen.

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
