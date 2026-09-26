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

## What's here

| Route        | Purpose                                                          |
| ------------ | ---------------------------------------------------------------- |
| `/`          | Quest map — Leaflet map, live GPS, proximity radar, clue puzzles  |
| `/games`     | Treasure hunts: create, share by code, join, and play             |
| `/creator`   | Hunt authoring: place characters on a map, design clues           |
| `/inventory` | Pilgrim backpack — collected relics                               |
| `/profile`   | Trophies, badges, XP stats, and field standings                   |

## Platform substitutions (native → web)

| Concern     | Native (Expo)                | Web port                                            |
| ----------- | ---------------------------- | --------------------------------------------------- |
| Map         | `react-native-maps` + Google | Leaflet + OpenStreetMap tiles, CSS-darkened (no API key) |
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
voice — its message, the key it hands over and the next target's hint appear
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

## Clues and keys stay on screen

Two things the player must never have to remember or hunt for:

- **The first clue.** Character 1 has no earlier character to hand a clue over,
  so the creator's briefing *is* its clue — and it is readable the moment the
  hunt opens, on the `/games` active-hunt card and in `HuntPlay`, rather than
  waiting for the discovery radius. Later stops keep the native strict-visibility
  rule: outside the radius the character's name and hint stay hidden and the
  player navigates from the previous character's dialogue.
- **The key in hand.** Character N's key is handed over by character N-1 (the
  creator gives players the first one) and has to be presented at the next stop.
  It used to exist only inside the reveal bubble, which disappears as soon as the
  player walks on. `components/KeyInHand.tsx` pins it to the screen instead: the
  ribbon under the hunt progress bar (labelled *Key from the creator* for the
  first stop, *Latest key received* afterwards), the active-hunt card on
  `/games`, and a chip on the AR frame in every phase (hunting, key entry,
  reveal) — so it is still readable while typing it into the form. Tapping the
  ribbon or the chip copies the key, so it can be pasted into the field.

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

## Notes

- No backend: hunts, progress, and relics live entirely in the browser.
  Clearing site data resets your game.
- Leaflet is loaded with a dynamic `import()` inside `GameMap` / `CharacterPinMap`
  because it touches `window` at module load; importing it eagerly would break
  server rendering.
- Map tiles come from `tile.openstreetmap.org` (keyless, z0-19) and are darkened
  with a CSS filter in `globals.css` to match the app's navy theme. Two earlier
  providers were dropped: CARTO's `dark_all` now watermarks unauthenticated
  requests with "API KEY REQUIRED", and Esri's World Dark Gray Canvas only
  publishes down to z16, so the z17-18 map returned "Map data not yet
  available". **If you switch providers, check the actual tile bytes** — both
  failures return HTTP 200, so a green network panel hides them.
- `navigator.vibrate` is ignored by browsers until the page has been activated
  by a real gesture, so `utils/sound.ts` gates haptics behind
  `navigator.userActivation` (falling back to a first-interaction listener).
  Without this the app logs a console error and buzzes on page load.
- Built and tested with Node 20+.
