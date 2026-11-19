# STATUS — project memory

Updated: 2026-11-19 by Claude Code · Phase: Phase 4.1 (FEAT-68) wave 1 merged into `dev` (PR #3, 2026-11-18, owner: merge first, test later); 9 FEAT-68 tasks open; Phase 4 follow-ups open
Authority: `PRD/` (requirements), `except/` (visual reference), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/SPEC.md` (implementation spec). `docs/GDD.md` is deprecated (casual template).

## Done

- Architecture accepted (Codex + agy proposals, lead decision) → `docs/ARCHITECTURE.md`.
- Owner decisions: no accounts/no DB; procedural room + CC0 assets (no Blender); photo-faithful layout enlarged to ~10 x 8 m; Quaternius avatars.
- Asset spike (Kenney Furniture Kit + Quaternius) and floor plan from photos (agy).
- `docs/SPEC.md` written (Codex), cross-reviewed (agy), owner + lead decisions applied; 19 technical open questions remain, none blocking.
- Layout data `packages/protocol/src/layout/office-layout.json` (12 x 9.6 x 2.7 m since Phase 2.1 T-1014, 8 desks, 5 zones, colliders, seat sockets); validator `node docs/layout/validate-layout.mjs` checks bounds, 0.9 m aisles and grid reachability (agy ran it: exit 0; lead reviewed top-down render).
- Owner core-first priority recorded in DECISIONS.
- Proof-of-concepts in `spike/poc/` (gitignored): TV CSS3D pass 5/6, Colyseus 0.18 sync pass 8/8, Quaternius retarget pass after 2 fixes. Findings in DECISIONS.

- **Phase 1 complete** (walkable office): 8 tasks in 4 batches, each re-verified by the PM; see `docs/plans/phase-1-execution.md`. 46 unit tests + 4 Playwright tests pass. Phase 1.1 lighting and camera polish accepted 2026-11-10. FPS measured only under software rendering (13 FPS, not representative); real-hardware measurement pending.

- **Phase 2 implemented** on `feat/phase-2` (`docs/plans/phase-2.md`): Tasks 1-7 committed (protocol identity/activity/seats, CC0 furniture, Quaternius avatars, sit/work/stand, join screen + nameplate + exit, coffee/wave/sofa/cabinet). Task 8 e2e spec (`apps/web/e2e/sit.spec.ts`, shared `helpers.ts`) committed in `e0b2221`.
- 2026-11-12 verification: unit tests 94/94 pass. Playwright e2e has NO valid result: first run hit another project's dev server on 5173; e2e now uses a dedicated server on 127.0.0.1:5180, but later runs hung in webServer setup or were killed for low RAM. Owner chose to merge into `dev` without e2e evidence.
- **Phase 2.1 T-1044** (e2e speed-up, branch `feat/T-1044-e2e-speedup`): `walk.spec.ts` shares one join (serial, one page) and holds keys until the player has moved 0.5 m (or, for the wall check, until it stops) instead of fixed `waitForTimeout`. Per-file commands in README. 2026-11-13, Claude Code cloud container (Linux, Chromium 1243 SwiftShader, 1 worker): `pnpm --filter web e2e e2e/walk.spec.ts --repeat-each=5` 15/15 pass (1.2 min); **first full green run `pnpm --filter web e2e`: 6/6 pass (1.1 min)** — sit, visual and walk specs.

- **Phase 3 implemented** on `feat/phase-3` (`docs/plans/phase-3.md`, Meridian FEAT-51): Colyseus server (OfficeRoom per code, 20 Hz authoritative movement, server-owned activity and seats, 20 s reconnect window), client connection, fixed-step prediction, remote avatars, replicated seats, employee list and entrance board, reconnect banner. T-1041 verification results and the acceptance record: plan §10: ten-client check passes (9 bots + 1 browser, 11th refused); the 10-minute network-profile soak shows remote jumps in 0.6% of frames, in line with retransmit spikes longer than the 100 ms interpolation delay.

- **Phase 4 merged into `dev`** (PR #1 on 2026-11-17, e2e fix T-1377 in PR #2 on 2026-11-18) from `req/feat-67` (`docs/plans/phase-4.md`, Meridian FEAT-67, T-1163 to T-1145): shared YouTube TV on the entertainment wall (CSS3D iframe with depth-only occluder, server `TvSim` with ordered commands and a 5-per-10-s limit, curated catalog plus pasted links, drift sync, TV mode panel with Close and focus recovery, muted start, per-video error UI). Owner accepted the plan §6 defaults on 2026-11-17. Verification record: plan §10 — 10-minute three-client drift soak under `NET_PROFILE=test` passes (max 0.205 s against the 1.0 s target, fake player).

## Next (ordered)

1. Owner-only Phase 4 checks (plan §10): Milestone A LAN playtest with two real browsers; one manual real-YouTube run (drift, focus recovery, occlusion); FPS with the TV playing next to the Phase 3 numbers; one foreground Playwright run; confirm or replace the 8 seeded catalog videos.
2. Phase 4 follow-ups (FEAT-67): T-1405 waits for the owner to retry the pasted video `MNXGfA_eT_Y` on `req/feat-68` and paste `window.__tvLog` (fix in `5a18a1e`); T-1374 (nudge rates on real YouTube; seek-only fallback already in `5a18a1e`), T-1375 (owner decision: convergence vs nudge limits), T-1376 (video end after controller leaves). T-1567 (2026-11-19, on `t1567`, not pushed): clock sample on join (`tv_time`, `PROTOCOL_VERSION` 7) so a late joiner on a skewed machine is not off by the skew; `pnpm check` and e2e `tv.spec.ts` pass; real two-machine check belongs to the Phase 5 playtest. T-1377 (`remote.spec.ts` walk test races) merged in PR #2, awaiting owner review on Meridian.
3. Phase 4.1 — office upgrade (visuals, furnished desks with a working desktop screen, avatar typing motion and an emote menu, multi-step coffee with a cup, interaction feedback, UI restyle; no sound, no voice chat): plan `docs/plans/phase-4.1.md` approved by the owner on 2026-11-16, Meridian FEAT-68 with tasks T-1146 to T-1160 (T-1157 sound dropped by the owner), T-1165 (coffee protocol) and T-1218 to T-1222 (avatars and emotes, added 2026-11-16). In progress on `req/feat-68` from 2026-11-17. Committed on the branch (Meridian "Đã commit", not merged): T-1146 baseline and render-quality switch, T-1147 Kenney furniture/food models with credits, T-1148 instanced furniture (spawn 174 -> 105 calls), T-1153 server coffee routine, T-1159 UI restyle with tokens, T-1165 coffee protocol, T-1218 avatar options, T-1219 typing motion, T-1220 to T-1222 emotes (protocol, server, client). Still open: T-1149 to T-1152, T-1154 to T-1156, T-1158, T-1160 (assigned to T1 - Claude). **Wave 1 merged into `dev` via PR #3 on 2026-11-18** (CI check + full e2e green on the PR); the owner chose to merge before manual testing, so the owner checks below are still open for it: real-hardware FPS with ten employees, a look at the room, emotes, typing, UI restyle and remote avatars with blob shadows. 2026-11-18 verification on the branch: `pnpm check` passes (protocol 136, web 318, server 117 unit tests); e2e visual, walk, sit, remote, ten and render baseline pass. 2026-11-19: T-1154 (coffee client: brew, steam, Machine in use, cup in hand / on desk, F sip incl. seated sip, `PROTOCOL_VERSION` 6) merged into `dev` via PR #5 on 2026-11-19; `pnpm check` and e2e coffee, seats, sit, emote, typing pass; owner check open: the cup and steam look on real hardware. 2026-11-19: T-1155 (working desktop: off / locked / desktop screen and lit desk lamp from replicated activity, shared canvas textures redrawn at most once per second) on `ccr-f961ccf5-7ci5iv` (merged from `t1155`); `pnpm check` and e2e deskScreen, deskProps, visual, typing, sit, coffee, seats, emote pass; owner check open: the screen and lamp look on real hardware. T-1156 (interaction feedback: target highlight, keycap prompt, local cabinet / fridge / main-door swings, fridge interactable, 0.5 s door-exit delay) on `ccr-f961ccf5-7ci5iv` (merged from `t1156`); `pnpm check` and e2e interaction, coffee, seats, sit, tv pass; owner check open: highlight colour and swing look on real hardware.
4. Phase 3 leftovers: T-1035 parked until deployment. The draw-call budget is closed (T-1161, T-1162, DECISIONS 2026-11-18): avatar parts merged into one skinned mesh and a blob shadow for remote avatars, 2 calls per remote avatar; ten employees 285 -> 105 calls and 149.5k -> 90.0k triangles (under the 120k target), no LOD needed.
5. The owner's raw Kenney zips were removed from `dev` and `kenney/` is gitignored; the owner confirmed this on 2026-11-19 (DECISIONS). The source stays in git history at `6c15589`.

## Open items

- OQ-025: no confirmed embed-blocked video id, so the live TV error check is open (simulated codes are tested); oEmbed 401 identifies embed-blocked ids.
- TV known limits: a controller leaving before the end of a video means no client reports the end; a same-handle SDK reconnect can give one late clock sample.
- e2e flakes seen 2026-11-17 in non-TV specs (`reconnect.spec.ts`, `remote.spec.ts` walk test): pass on rerun; details in phase-4 plan §10.
- Production deploy is not configured: `deploy.yml` runs CI, then the `server` job stops at "Check configuration" because `RENDER_DEPLOY_HOOK_URL` / `SERVER_URL` are not set (runs #7 and #8 on 2026-11-18), so nothing reaches Render or Vercel yet. Setup steps: `docs/DEPLOY.md` (Phase 5).
- Hosting accounts (Render, Vercel) needed only at Phase 5.

## Working notes

- Claude writes code and plans (Codex no longer used); agy installs dependencies and runs tests.
- agy has twice reported PASS on broken visuals — always open screenshots before accepting.
- e2e under agy + software WebGL exceeds RAM and gets reaped; prefer the owner running `npx playwright test` in the foreground.
- Machine is low on RAM: run one worker at a time; Claude Code may kill background tasks (`CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` disables this).
- Key spike artifact to reuse: `spike/poc/avatar/src/retarget.ts`.
