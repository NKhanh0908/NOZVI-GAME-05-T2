# Phase 4 — Shared TV & Entertainment

> Status: Draft for owner review, 2026-11-15; all 11 tasks implemented on `req/feat-67` (2026-11-17), owner checks pending (§10). Planned branch: `feat/phase-4` from `dev`. Tracked in Meridian as FEAT-67 (auto-approved 2026-11-15); task ids are in §4 ("proposal" means it awaits owner approval in Meridian). This plan covers design, scope and acceptance. Step-by-step implementation detail belongs in each task.

**Goal:** One employee picks a YouTube video on the entertainment-wall TV, and everyone in the same office watches it in sync. Play, pause, seek, change video and Stop are shared, and closing the TV view is local (`PRD/RoadMap.md` Phase 4).

**Requirements covered:** REQ-TV-001 to REQ-TV-009, the TV part of REQ-NFR-005 (TV commands 5 per 10 s per client) and the P4 part of REQ-ROOM-008 (`docs/SPEC.md`).

## 1. Starting point

- Phase 3 multiplayer is implemented and merged into `dev`. `OfficeRoom` holds `OfficeState { employees }`, and the client has a connection, prediction, remote avatars and a reconnect path. FEAT-51 still has open owner items: T-1035 is parked until deployment, and T-1037, T-1038 and T-1041 are owner-accepted and waiting for the assignee to close them.
- The layout already has a `tv` interactable of type `TV` with `collider_tv` on the entertainment wall. `InteractionController` filters `TV` out of its targets today.
- The TV proof-of-concept (DECISIONS 2026-11-09, `spike/poc/`, gitignored) passed 5 of 6 checks with three 0.187. Muted autoplay, orbiting through an iframe with `pointer-events: none`, a depth-only occluder and a TV-mode toggle all work. Clicking inside the iframe steals keyboard focus. The embed-blocked path is unverified (OQ-025).
- The Colyseus PoC also synced TV state (8 of 8). That code is evidence, not delivered code.
- No new npm package is needed. `CSS3DRenderer` ships in `three/examples/jsm`, and the YouTube IFrame Player API is a script loaded at runtime from youtube.com.

## 2. Entry gates

| Gate                                                                | Blocks        | Why                                                                        |
| ------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------- |
| Owner approves this plan and the Meridian requirement               | All tasks     | AGENTS.md §5: phase scope needs approval                                   |
| Owner answers or accepts the defaults in §6 (OQ-021, 022, 023, 025) | Tasks 1, 2, 7 | These shape the wire contract and the drift logic                          |
| FEAT-51 owner-accepted tasks closed (T-1037, T-1038, T-1041)        | Task 11 only  | Phase 4 verification runs on a closed Phase 3; earlier tasks may start now |

## 3. Design

### 3.1 Wire contract (`packages/protocol/src/net/`, `packages/protocol/src/tv/`)

- Room state gains `tv: SharedTVState { videoId: string | null, provider: 'youtube', status: 'idle' | 'playing' | 'paused', currentTime: number, updatedAt: number, controllerSessionId: string | null }` (REQ-TV-004). `currentTime` is in seconds of video time at `updatedAt`, and `updatedAt` is server epoch milliseconds (default for OQ-023).
- Client to server message: `tv { type: 'load', videoId } | { type: 'play' } | { type: 'pause' } | { type: 'seek', time } | { type: 'stop' }`. The validator rejects unknown types, non-finite or negative times and video ids that fail the YouTube id pattern (11 characters `[A-Za-z0-9_-]`).
- `BALANCE.tv`: drift ignore below 0.5 s, nudge 0.5 to 2 s, hard seek above 2 s, nudge rate ±5 % for at most 2 s, convergence 5 s, drift target 1.0 s, rate limit 5 commands per 10 s per client.
- `PROTOCOL_VERSION` moves to 3.

### 3.2 Server (`apps/server`)

- A pure `TvSim` (no Colyseus import, controlled clock) applies commands in room order, one at a time (REQ-TV-005). Every employee may control the TV. The server sets `updatedAt` and `controllerSessionId` and computes `currentTime` on pause or seek from the elapsed play time.
- Rate limit: 5 commands per 10 s per client. Excess commands are dropped and answered with a typed `tv_rate_limited` notice.
- `stop` returns to `idle` with `videoId = null`. A local close sends nothing.
- When the controller leaves, playback continues and `controllerSessionId` becomes null (default for OQ-022). The server cannot see the end of a video, so `ended` is reported by the controller's client as a `pause` at the end time. No new status value is added.

### 3.3 Client (`apps/web`)

- `src/tv/TvScreen.ts`: one TV group with the frame mesh, the screen-border mesh, a depth-only occluder and a `CSS3DObject` holding the iframe. A second `CSS3DRenderer` layer is resized and rendered with the WebGL renderer and disposed with the game (REQ-TV-001).
- `src/tv/provider/`: a `VideoProvider` interface (`search`, `getVideo`, `getEmbedUrl`), a `YouTubeProvider` over a curated catalog JSON and a pasted-URL parser, plus a test double (REQ-TV-007). There is no live search and no Data API key (REQ-TV-003, REQ-TV-008).
- `src/tv/player.ts`: a thin adapter over the IFrame Player API behind an interface, so unit and e2e tests use a fake player.
- `src/tv/sync.ts` (pure): turns `SharedTVState` plus the local clock into an action (`none`, `nudge(rate)` or `seek(time)`) using the bands in `BALANCE.tv`, and resyncs on `visibilitychange` (REQ-TV-006).
- TV mode: pressing E near the TV opens a panel with the catalog, a URL field, play, pause, seek, change video, Stop and an on-screen Close. Outside TV mode the iframe keeps `pointer-events: none`. Close restores keyboard focus to the game, and Esc closes the panel while the app has focus (REQ-TV-002). Playback starts muted until a user gesture.
- Per-video error UI for `onError` codes 2, 5, 100, 101 and 150 (invalid id, HTML5 error, not found, embedding blocked) (REQ-TV-009).

## 4. Tasks

Each task stays within Meridian's 30-minute cap (criteria minutes plus 12). Sizes are S unless noted.

| #   | Meridian | Task                                                                                 | Depends on | Requirements            |
| --- | -------- | ------------------------------------------------------------------------------------ | ---------- | ----------------------- |
| 1   | proposal | Protocol: `SharedTVState` schema, `tv` command validator, `BALANCE.tv`, protocol v3  | §6 answers | REQ-TV-004, REQ-NFR-005 |
| 2   | T-1137   | Server: pure `TvSim` (ordered commands, play/pause/seek/load/stop, controller leave) | 1          | REQ-TV-004, REQ-TV-005  |
| 3   | T-1138   | Server: wire `TvSim` into `OfficeRoom` with the 5-per-10-s rate limit + integration  | 2          | REQ-TV-005, REQ-NFR-005 |
| 4   | proposal | Client: `VideoProvider`, curated catalog JSON, pasted-URL parser, test double        | 1          | REQ-TV-003, 007, 008    |
| 5   | T-1139   | Client: `TvScreen` with CSS3D iframe, occluder and dual-renderer lifecycle           | —          | REQ-TV-001              |
| 6   | T-1140   | Client: IFrame Player adapter behind an interface, fake player for tests             | 5          | REQ-TV-001, REQ-TV-003  |
| 7   | T-1141   | Client: pure drift sync (bands, nudge, hard seek, visibilitychange) with unit tests  | 1          | REQ-TV-006              |
| 8   | T-1142   | Client: TV mode panel (E to open, controls, Close, focus recovery, muted start)      | 4, 6       | REQ-TV-002, REQ-TV-003  |
| 9   | T-1143   | Client: bind room `tv` state to the player and send commands; e2e with 3 pages       | 3, 7, 8    | REQ-TV-004, REQ-TV-006  |
| 10  | T-1144   | Client: per-video error UI and the embed-blocked check                               | 9          | REQ-TV-009              |
| 11  | T-1145   | Verification: drift soak under the network profile, content-source record, docs (M)  | 10         | REQ-TV-006, REQ-TV-008  |

**Milestone A (after task 9):** two browsers on one code watch the same video, and play, pause and seek on one show on the other. Hold a short LAN playtest before tasks 10 and 11.

## 5. Phase acceptance

State of each item, with evidence or the open gap: §10.

- The TV sits on the entertainment wall. The video shows inside the screen frame, and a nearer object hides it correctly while orbiting (manual, screenshots opened by a person).
- Selecting a catalog item or a pasted YouTube URL plays on every client in the room. Play, pause, seek and change video sync, Stop stops everyone, and Close leaves others playing (Playwright with 3 pages and the fake player).
- Drift unit tests cover below 0.5 s, exactly 0.5 s, the middle band, exactly 2 s and above 2 s. A hidden tab resyncs when it becomes visible again.
- Under `NET_PROFILE=test` for 10 minutes, the drift between clients stays under 1.0 s after 5 s of convergence (recorded with the fake player plus one manual run with real YouTube).
- More than 5 TV commands in 10 s from one client are refused without changing state.
- An embedding-blocked video shows a per-video error. A real blocked fixture is recorded, or the gap is listed openly (OQ-025).
- `pnpm check` passes, and the owner runs one green foreground Playwright run.

## 6. Decisions the owner needs to confirm

Each has a default so work is not blocked; say if you want a different one.

1. **Catalog shape (OQ-021).** Default: a static `apps/web/src/tv/catalog.json` with 6 to 10 embeddable public videos chosen by the owner, each `{ id, title, thumbnail, duration?, sourceUrl, embeddable: true }`. A pasted URL not in the catalog is accepted when its id parses, and an empty catalog shows only the URL field.
2. **Controller leaves, and video end (OQ-022).** Default: playback continues for the others and `controllerSessionId` becomes null. At the end of a video the TV pauses at the last frame. No `ended` status is added.
3. **Timing (OQ-023).** Default: `currentTime` in seconds, `updatedAt` in server epoch ms, and the client estimates server clock offset from the join handshake and later patches. Nudge ±5 % for up to 2 s. A late joiner seeks to the computed position. A paused TV shows the paused frame. A hidden tab resyncs on `visibilitychange`.
4. **Blocked-video fixture (OQ-025).** Default: the owner supplies one known embed-blocked video id for the manual check. If none is found, task 10 ships with the simulated error test and records the live check as open.
   - **Open gap (T-1144, 2026-11-17):** the owner has no confirmed embed-blocked id, so the live check against the real IFrame player has not been run. Task 10 shipped with simulated error coverage only (unit `apps/web/test/tv/videoError.test.ts`; e2e `a player error shows a per-video message on every page and another video can be chosen` in `apps/web/e2e/tv.spec.ts`), which does not close OQ-025. To close it: load a confirmed blocked id (oEmbed returns 401 for it) through a pasted link with the real player, and record the observed code (101 or 150) and the screen and panel message.
5. **Autoplay.** Default: a newcomer's player starts muted with a visible "Click to unmute" control, as in the PoC.

## 7. Out of scope

Live YouTube search or a Data API key, providers other than YouTube, host or admin TV roles, playlists or queues, chat, deployment (Phase 5), mobile, and replacing UI with CSS3D.

## 8. Risks

| Risk                                                                                        | Mitigation                                                                                                        |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| YouTube iframe cannot run in headless e2e (network, autoplay, codecs)                       | e2e uses the fake player behind the player interface; real YouTube is checked manually (task 11)                  |
| Clicking the iframe steals keyboard focus (PoC finding)                                     | On-screen Close always visible in TV mode; focus is restored to the canvas on close                               |
| CSS3D occlusion differs between browsers                                                    | Depth-only occluder plus a manual orbit check; record any browser-specific limit instead of claiming it validated |
| Clock offset between clients makes drift look larger than it is                             | Server timestamps only; offset estimate from patches; drift measured against server time, not wall clock          |
| The second renderer adds per-frame cost on top of a scene already over the draw-call target | CSS3D renders one DOM element; measure FPS in task 11 next to the Phase 3 numbers                                 |
| The embed-blocked path stays unverified                                                     | Owner fixture (§6.4); otherwise listed as an open gap, not passed                                                 |

## 9. Documents to update when the phase lands (task 11)

`docs/CODEMAP.md` (tv rows), `docs/ARCHITECTURE.md` §4 and §5 (TV renderer and state), `docs/DECISIONS.md` (the confirmed items from §6, timing convention), `docs/STATUS.md`, `CHANGELOG.md`.

## 10. Verification record (task 11, T-1145, 2026-11-17)

Environment: Claude Code cloud container (Linux, Node 22, headless Chromium with SwiftShader software WebGL, 1280x720, one Playwright worker). Software-rendered numbers are evidence of behaviour, not of real-hardware performance. Owner decisions of 2026-11-17 (§6 defaults accepted, OQ-025 open, Node 22 for this session) are in DECISIONS.

**Drift soak** (`NET_PROFILE=test`, `apps/web/e2e/tvSoak.spec.ts`, 10.8 min run, 10 min measured): REQ-NET-004 profile (100 ms ± 20 ms downlink delay, 1% of messages a further 200 ms), three pages with the fake player in one office. Every two minutes page 1 pauses, page 2 seeks to 47 s and page 3 plays (15 commands). Twice a second the test reads each page's player time and replicated `tv` state; browser and server share one clock, so each page's error is measured against the server timeline, and inter-client drift is the spread of the three errors in one tick. Ticks within 5 s of a command, or while the pages disagree on the state, are skipped.

| Measure                                         | Result                                               |
| ----------------------------------------------- | ---------------------------------------------------- |
| Ticks / measured samples / skipped              | 1,167 / 1,007 / 160                                  |
| Inter-client drift after 5 s convergence        | max 0.205 s, p95 0.204 s, p50 0.019 s (target 1.0 s) |
| Largest single-client error against server time | 0.317 s (behind)                                     |
| Commands applied (state seen after convergence) | 15 of 15 (pause, seek to 47.00 s, play; 5 cycles)    |

Observed result: **pass** (max 0.205 s < 1.0 s). A client's error is about its patch delay when the last command arrived (a play starts from the paused frame on receipt), and it is kept while under the 0.5 s ignore band; the worst tick follows a 200 ms retransmit spike. The fake player keeps perfect time, so real-player drift (buffering, rate changes) is not covered: that needs the manual run below.

**Draw calls** (SwiftShader, page facing the TV, one employee visible; not representative of real hardware): TV idle and closed 182 (60 main + 122 shadow), 49,826 triangles; TV open and playing 182 (60 + 122), 49,826 triangles. The CSS3D layer is DOM and adds no WebGL draw call; its compositing cost and FPS need real hardware.

**Content sources (REQ-TV-008)**: summary of the published terms as understood on 2026-11-17, not a legal review.

- YouTube (delivered): free to watch and to embed through the IFrame Player API under the YouTube Terms of Service and API Services Terms; no key is used. Uploaders can disable embedding or restrict region or age, so not every video plays in the iframe: catalog ids are checked with oEmbed (401 = embedding blocked) and failures show the per-video error. The video streams from YouTube unmodified (no download, proxy or hidden branding). Rights stay with the uploader: the catalog is seeded with 8 Blender Foundation open movies (CC BY, on Blender's own channel; oEmbed checked 2026-11-15). The Data API is research only (needs a key and quota).
- Internet Archive: free, with many public-domain and Creative Commons films and an embed player; rights differ per item, so each needs a license check. Suitable as a future provider for public-domain films; not delivered.
- Public-domain collections (for example Wikimedia Commons, Library of Congress): free to reuse, but mostly plain files, so they would need an HTML5 video provider and hosting bandwidth. Research only.
- Jellyfin: free, open-source, self-hosted media server for an internal library; needs an always-on host, storage and its own logins, which conflicts with zero cost and no accounts. Research only.

**Phase acceptance (§5)**

| Item                                                                                           | State                                                                                                                                                                                                                  | Evidence                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| TV on the entertainment wall; video inside the frame; nearer object hides it while orbiting    | Partly: pose, layer resize and orbit through the screen pass in e2e; occlusion judged by a person is **open (owner)**                                                                                                  | e2e `tv.spec.ts` (screen layer test, `TV_SHOT` screenshots); unit `tvScreen.test.ts` (occluder material)                |
| Catalog item or pasted URL plays everywhere; play, pause, seek, change, Stop sync; Close local | Done (fake player)                                                                                                                                                                                                     | e2e `tv.spec.ts` three-page sync test, late joiner within 1 s, pasted-URL test                                          |
| Drift unit tests at < 0.5, 0.5, middle, 2 and > 2 s; hidden tab resyncs                        | Done                                                                                                                                                                                                                   | `apps/web/test/tv/sync.test.ts` (0.4, 0.5, 1.2, 2.0, 3 s; `onBecameVisible`), `tvBinding.test.ts` (resync when visible) |
| 10 min under `NET_PROFILE=test`, drift < 1.0 s after 5 s                                       | Fake player: done (max 0.205 s). Manual real-YouTube run: **open (owner)**                                                                                                                                             | soak above                                                                                                              |
| More than 5 TV commands in 10 s refused without changing state                                 | Done                                                                                                                                                                                                                   | `apps/server/test/officeRoom.test.ts` (6th command refused, state unchanged), `commandRateLimiter.test.ts`              |
| Embedding-blocked video shows a per-video error; real fixture or open gap                      | Simulated codes done; live fixture **open** (OQ-025, §6.4)                                                                                                                                                             | `apps/web/test/tv/videoError.test.ts`, e2e error test in `tv.spec.ts`                                                   |
| `pnpm check` passes; owner runs one green foreground Playwright run                            | Agent runs green: `pnpm check` (protocol 108, web 217, server 84 unit tests; build ok); full e2e not green: 25 passed, 2 failed, 1 did not run, 2 skipped (soaks), 7.0 min; all 8 TV tests pass; **owner run pending** | `pnpm format && pnpm check`, `pnpm --filter @office/web e2e --trace off`                                                |

**Open gaps (owner only)**

1. Milestone A LAN playtest with two real browsers on one code (play, pause and seek seen on the other).
2. One manual run with real YouTube on the owner's machine: drift between two browsers, focus recovery after clicking the real iframe, and orbit occlusion by eye.
3. FPS with the TV playing on the owner's laptop, next to the Phase 3 numbers (about 55 FPS without the TV).
4. One foreground Playwright run by the owner.
5. OQ-025: a confirmed embed-blocked id for the live error check.
6. Confirm or replace the 8 seeded catalog videos (§6.1).

**Non-TV e2e flakes (2026-11-17 run):** `reconnect.spec.ts` (Bob not shown as "Reconnecting…" within 10 s; the serial follow-up test did not run) and `remote.spec.ts` walk test (remote speed 3.26 m/s against the 3 m/s limit). Reruns: `reconnect.spec.ts` 2 of 2 pass alone; the `remote.spec.ts` walk test failed once more (end pose 0.06 m off the server pose, limit 0.01 m) and then passed 3 of 3. Neither spec nor its code changed in Phase 4; whether the extra per-frame TV work under SwiftShader makes them flakier is not established. The owner's foreground run decides.

Known limits: if the controller leaves before the end of a video, no client reports the end; a same-handle SDK reconnect can give one late clock sample (the next command corrects it); focus recovery and the real YouTube iframe are only checked with the fake player and a stand-in iframe in e2e.
