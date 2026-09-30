I've gone through the current hunt flow (`HuntContext`, `HuntPlay`, `types/hunt.ts`, `gameRepository.ts`) to ground this. Here's my assessment and suggestion.

## First, what "following another team" actually buys a cheater

There are two distinct leaks:

1. **Navigation leak** — you don't solve *where* to go; you just walk where the team ahead of you is walking.
2. **Gate leak** — you arrive at the location and copy their *answers* (the reveal questions) instead of solving them yourself.

A good fix needs to close both. Rotation alone closes #1; you need per-team gates to close #2.

## Layer 1 — Per-team rotated routes (the core fix for your N = N constraint)

Since #teams = #locations, assign every team a **cyclic rotation** of the route. That's a Latin square: at every step, exactly one team sits at each location.

| Team | Route |
|------|-------|
| T1 | L1 → L2 → L3 → L4 |
| T2 | L2 → L3 → L4 → L1 |
| T3 | L3 → L4 → L1 → L2 |
| T4 | L4 → L1 → L2 → L3 |

Two properties fall out of this for free:

- **Tailgating is visibly futile.** Your radar/current target is always *your* next stop in *your* route. If you shadow T1, your app points somewhere other than where T1 is standing — so the "follow them and my phone tells me when I arrive" loop breaks.
- **No queues.** Nobody is ever queued behind another team doing the same location at the same step.

Your existing order gate already does the enforcement half: `discoverCurrentCharacter` (`context/HuntContext.tsx:249-259`) resolves `nextCharacter` as the first *undiscovered* character and rejects anything else. We just need progress to store a per-team route instead of always using `game.characters` order — e.g. add `route: string[]` (ordered character IDs) to `HuntProgress`, pick the first undiscovered ID in *that*, and assign `route = rotate(characters, teamIndex)` in `joinGame`. The "first key handed at join" mechanic maps perfectly: your first key becomes the key of your route's first character.

## Layer 2 — Per-team gates (closes the copy-the-answers hole)

Rotation alone has one weakness: **lag**. If T2 falls behind and the leader T1 is already at L3 — which is exactly T2's next stop — T2 can arrive three minutes later and copy T1's question answers verbatim, because today every team shares the same questions, options, and keys.

Fix: derive the gate from `(gameId, teamId, characterId)` — deterministic, no extra storage:

- **Per-team keys** in `utils/keys.ts` — `keyFor(team, character)` via a seeded hash. The key T1 reveals after solving L2 is *not* the key anyone else must present, so shouting your key across a plaza is harmless.
- **Per-team question variants** in `utils/huntQuestions.ts` — each character authors a small question *pool*; the team's seed picks the instance, and MCQ option order is shuffled with the same seed. Watching T1 answer "B — 42" tells you nothing, because your instance has different options and a different correct answer.

## Worked example

Timeline of one step (say step 2), all four teams playing simultaneously:

| Time | T1 | T2 | T3 | T4 |
|------|----|----|----|-----|
| 10:00 | solving **L1** | solving **L2** | solving **L3** | solving **L4** |
| 10:12 | arrives **L2** | arrives **L3** | arrives **L4** | arrives **L1** |

**Cheat attempt 1 — T4 shadows T1 from the start.** T1 walks to L1; T4 follows. T4's app, however, targets L4 (its route's first stop) — the radar points away, and `discoverCurrentCharacter` resolves `nextCharacter = L4`, so nothing T4 does at L1 records any progress. T4 has gained zero and wasted time. Meanwhile every other location still has its rightful team, so T4 also can't claim "the spot is free, I'll just do mine quietly" — spots aren't contended at all.

**Cheat attempt 2 — T2 tailgates T1 at L3 mid-game.** T2 is slow, T1 clears L3 at 10:30, T2 walks in at 10:33 behind them.
- *Without* Layer 2: T2 asks T1 for the MCQ answers, types them in — cheat works. (This is the hole today's shared question set leaves.)
- *With* Layer 2: T2's question instance at L3 was seeded for T2 — different options, different correct answer. T1's answers are useless. The key T1 reveals at L3 is `keyFor(T1, L4)`; T2's required key already came from its own L2 solve. The only thing T2 learns is that L3's gate is solvable — which it already knew.

**Cheat attempt 3 — the "why don't I just read it off my phone" hack.** This one *works today*, and I want to be honest about it: `joinGame` persists the **full game payload** — all hints, dialogues, questions, and answer keys — into localStorage via `localGameRepository`. A determined cheater can just read the answers out of storage. The `GameRepository` interface was explicitly written to be swapped for a backend ("swap in a Firebase/Supabase/REST implementation later"), so the endgame for a real multi-team event is: the server only releases each team's question instance/key when that team actually reaches the step, and logs solve timestamps.

## Layer 3 — Detection (backend, later)

Once there's a server, prevention gives way to evidence: record `(team, location, arrivalTime, solveTime)` and flag the classic tailgating signature — **a team that solves several consecutive stops in anomalously fast time while trailing another team's trail with a near-constant gap**. That catches what no client-side rule can.

## Summary of my suggestion

| Layer | Closes | Effort |
|---|---|---|
| Rotated per-team routes (`HuntProgress.route`) | Navigation leak, queues | Small — order gate already exists |
| Per-team keys + seeded question variants | Answer-copying leak | Medium — touches `keys.ts` / `huntQuestions.ts`, one `teamId` concept |
| Backend repository + solve telemetry | Client-side data reading, provable cheating | Large — planned-for swap of `GameRepository` |

Layers 1 + 2 are implementable today with no backend (assuming **one device per team**, which is how the current single-progress-per-device model works). Layer 3 is the necessary follow-up if each team plays on multiple devices or you need an enforceable leaderboard.

Want me to start with Layer 1 (route rotation end-to-end), or draft the `teamId` + per-team gate model first so we only touch the types once?