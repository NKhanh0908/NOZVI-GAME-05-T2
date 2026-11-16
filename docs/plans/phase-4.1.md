# Phase 4.1 — Office Upgrade (visuals, interactions, details)

> Status: Draft for owner review, 2026-11-15. Branch: `feat/phase-4.1` from `dev`, after Phase 4 (`docs/plans/phase-4.md`, FEAT-67) is done. Tracked in Meridian as FEAT-68 (auto-approved 2026-11-15); task ids are in §4 ("proposal" means it awaits owner approval in Meridian). This plan covers design, scope and acceptance. Step-by-step implementation detail belongs in each task.

**Goal:** Upgrade the existing 3D office in every visible respect without changing its layout: better-looking room and materials, fully furnished desks with a live desktop screen while working, avatars that visibly type and can play a few emotes, a multi-step coffee routine with a cup that others can see, clearer interactions and a restyled 2D UI.

**Owner decisions behind this plan (2026-11-15, chat):**

1. Phase 4 stays the shared TV. Phase 4.1 is this upgrade and starts after Phase 4 is done.
2. Desks get both: the full set of desk objects, and a simulated desktop on the monitor while the employee works, visible to others.
3. Coffee is a multi-step routine with a cup (take a cup, the machine brews, carry the cup, sip, put it on the desk). No inventory and no consumables.
4. Visuals stay on CC0 assets without Blender (DECISIONS 2026-11-09); quality goes up through more CC0 assets, materials, lighting and small details, together with draw-call work to keep about 55 FPS on the owner's laptop.

**Owner decisions added on 2026-11-16 (chat):**

5. Avatars may be improved in this phase (typing while working, more animation variety). Task 17 presents the options and the owner picks one before any asset or code change.
6. An emote menu is in scope (tasks 19 to 21). This moves "emotes other than wave" from optional (REQ-SCOPE-002) into this phase; task 19 records it in SPEC and DECISIONS.
7. Visual direction stays a modern office in the SPEC palette (REQ-ROOM-001). The reference screenshots the owner shared from another product are a quality bar for environment and model richness, not a look to copy.
8. Room size and the ten-employee capacity do not change.
9. Voice chat with mouth movement was discussed as a possible Phase 4.2 and parked. Nothing is planned for it here.

**Requirements touched:** REQ-ROOM-001 and REQ-ROOM-003 to REQ-ROOM-008 (visual quality and asset categories), REQ-INT-001 (prompt and targeting feedback), REQ-INT-002 (work state shown on the desk), REQ-INT-003 and OQ-015 (coffee triggers, durations, cup), REQ-INT-004 and REQ-INT-005 (cabinet and door feedback), REQ-AVATAR-002 (composed working / typing animation), REQ-AVATAR-004 and REQ-SCOPE-002 (emotes), REQ-UI-001 to REQ-UI-004 (2D UI polish), REQ-PERF-001 to REQ-PERF-003 (`docs/SPEC.md`). The coffee routine changes an approved gameplay rule; the owner approved the change in decision 3, and task 8 records it in SPEC and DECISIONS.

## 1. Starting point

- The room is a procedural shell (`room.ts`) with 17 Kenney GLB models (`furnitureManifest.ts`). The main door, utility door and air conditioner are plain palette boxes.
- The layout already lists a computer, keyboard, mouse, desk lamp, stationery and a decorative object per desk, but only a static screen model is drawn. Task 1 confirms exactly what is drawn today.
- Materials are roughness-1 with a baked light probe; there are no specular environment reflections (DECISIONS 2026-11-10). There is no post-processing.
- Coffee: E at the coffee machine or water dispenser sets `drinking` for 2.5 s on the server (`BALANCE.activity.drinkSeconds`). There is no cup and no brewing step.
- Cabinets show a "Cabinet opened" toast. The fridge, plants and shelves have no interaction.
- There is no audio in the client, and none is added in this phase (owner, 2026-11-15).
- Render cost is already over the ARCHITECTURE target (45 calls, 120k triangles): about 170 calls with one employee and about 350 with ten. Two avatar cost proposals from Phase 3 are waiting for owner approval.

## 2. Entry gates

| Gate                                                                   | Blocks       | Why                                                                |
| ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------ |
| Phase 4 done (FEAT-67, T-1145)                                         | All tasks    | Owner decision 1; both phases edit `Game.ts`, protocol and e2e     |
| Owner approves this plan, the Meridian requirement and the §6 defaults | All tasks    | AGENTS.md §5: phase scope and gameplay rule changes need approval  |
| Avatar render cost proposals (Phase 3 follow-ups) approved and done    | Tasks 3 to 7 | New visual detail must not land on a scene that is over the budget |
| Owner approves each new CC0 asset pack (task 2)                        | Task 2       | AGENTS.md §6: explain material new assets; licences in CREDITS.md  |

## 3. Design

### 3.1 Render budget first

- Task 1 sets a measured budget for this phase with the owner's laptop as the reference machine: the frame rate with ten employees must not drop below the Phase 3 reading (about 55 FPS), and every later task records draw calls and triangles before and after with `__office.getDrawCalls()`.
- Static furniture and desk props are drawn with `InstancedMesh` or merged geometry per model and material, so eight desks with six props each do not add 48 or more draw calls. Shadow casting is limited to large furniture.

### 3.2 Visuals (CC0 only)

- Materials: wood, metal, fabric and glass get distinct roughness and metalness values, and a PMREM environment map adds soft reflections on glass, metal and screens.
- Lighting: daylight through the window wall, ceiling light fixtures that match the photos, softer contact shadows. Light post-processing (anti-aliasing and a mild bloom on screens and lamps) uses the `EffectComposer` that ships with three; no new package.
- Room shell: window frames with glass, skirting boards, ceiling panels, real door models for the main and utility doors, an air-conditioner model, wall signage.
- Small details: desk clutter, pantry cups and sink items, a wall clock showing the local time, a rug in the entertainment corner, books on shelves, plant variety. All from CC0 packs, credited in `apps/web/public/assets/CREDITS.md`.

### 3.3 Desks and the working desktop

- Every desk shows its monitor, keyboard, mouse, lamp, stationery and decorative object from the layout data.
- While the desk's occupant has activity `working`, the monitor shows a simulated desktop drawn on a `CanvasTexture` (wallpaper, a clock, one window with moving text lines) and the desk lamp is on. When the occupant stops working, the screen dims to a lock screen; an empty desk has a dark screen.
- This needs no new network state: every client derives it from the replicated `activity` and `seatId`. The simulated desktop is decoration and has no usable applications (§7).

### 3.4 Coffee routine (changes REQ-INT-003, resolves OQ-015)

- `EmployeeState` gains `item: '' | 'coffee'` and `sips: number`. Activity gains `brewing`. `PROTOCOL_VERSION` moves up by one from the Phase 4 value.
- Flow, all decided by the server: E at the coffee machine while holding nothing starts `brewing` for `BALANCE.coffee.brewSeconds` (default 4 s); moving away cancels it. When it completes, the employee holds a coffee with `BALANCE.coffee.sips` sips (default 3). The employee can walk and sit while holding it. A `drink` intent takes one sip (the existing `drinking` activity and timer); after the last sip the cup is gone.
- Cup placement is presentation only: in the hand while standing or walking, on the desk or coffee table while seated.
- The machine serves one employee at a time; a second E while it is busy is refused with a short prompt. There is no inventory, no beans or water level and no dirty cups (§7).
- The water dispenser keeps its single-step drink and gains a visible glass during the drink.

### 3.5 Interaction feedback

- The current interaction target gets a visible highlight, and the prompt shows the key and the action name.
- Cabinet, fridge and door interactions play a local open and close animation instead of only a toast. They stay local presentation, as today.

### 3.6 2D UI

- One set of design tokens (colours from the SPEC palette, spacing, radius, type scale) applied to the join screen, employee list, prompt, toast, connection banner and the Phase 4 TV panel. Keyboard focus states and readable contrast are part of the restyle.

### 3.7 Avatars

- Starting point: two presets (`men_suit.glb`, `women_suit.glb`, Quaternius Modular Suit) animated with clips retargeted from the Quaternius Universal Animation Library (`anim/ual.glb`, 46 clips). `working` plays `Sitting_Idle_Loop`, so a working employee looks the same as a seated idle one; the wave is a procedural arm override. The library has no typing, laughing or waving clip. Office-usable unused clips: `Idle_Talking_Loop`, `Sitting_Talking_Loop`, `Sitting_Enter`, `Sitting_Exit`, `PickUp_Table`, `Dance_Loop`, `Walk_Formal_Loop`.
- Task 17 compares three options with licence, size, rig compatibility, draw calls and effort: keep the models and add procedural overlays plus unused library clips (default), add another CC0 animation pack, or add or replace presets with other CC0 rigged models. The owner picks one. Replacing the models changes the REQ-AVATAR-001 decision and redoes the avatar render cost work, so it needs an explicit owner choice.
- Task 18 gives `working` a typing motion on both presets and on remote avatars. It derives from the replicated `activity`; no new network state.

### 3.8 Emotes

- A fixed list of four to five emotes (wave included), approved in task 17. The `emote` intent carries only an id from that list: no free text, so the prototype stays chat-free.
- The server owns the emote like it owns wave today: it starts it, runs the timer from `BALANCE.emote`, enforces a minimum gap per employee and restores the previous activity. Task 19 decides whether emotes are allowed while seated, while holding a coffee and while brewing.
- The client adds an emote button and a small menu to the 2D UI and plays the emote on local and remote avatars from replicated state.

## 4. Tasks

Each task stays within Meridian's 30-minute cap. All depend on Phase 4 being done; the order below is the intended sequence.

| #   | Meridian | Task                                                                                  | Depends on        | Requirements                  |
| --- | -------- | ------------------------------------------------------------------------------------- | ----------------- | ----------------------------- |
| 1   | T-1146   | Baseline: record what is drawn today, draw calls, triangles and the phase budget      | Phase 4           | REQ-PERF-001 to 003           |
| 2   | T-1147   | Assets: choose and add CC0 packs for props, doors and details; credits and licences   | 1                 | REQ-ROOM-004 to 008           |
| 3   | T-1148   | Rendering: instanced or merged static furniture and props                             | 1                 | REQ-PERF-002                  |
| 4   | T-1149   | Materials and PMREM environment reflections                                           | 3                 | REQ-ROOM-001                  |
| 5   | T-1150   | Lighting: window daylight, ceiling fixtures, softer shadows, light post-processing    | 4                 | REQ-ROOM-001                  |
| 6   | T-1151   | Room shell details: windows, skirting, ceiling, door and air-conditioner models       | 2, 3              | REQ-ROOM-003, 007             |
| 7   | T-1152   | Desk props: keyboard, mouse, lamp, stationery and decoration on all eight desks       | 2, 3              | REQ-ROOM-004                  |
| 8   | proposal | Protocol: coffee item, sips, `brewing` activity, `BALANCE.coffee`; SPEC and DECISIONS | Phase 4           | REQ-INT-003                   |
| 9   | T-1153   | Server: coffee routine in the activity sim (brew, cancel, sip, busy machine)          | 8                 | REQ-INT-003                   |
| 10  | T-1154   | Client: brewing feedback at the machine, cup in hand and on the desk, remote view     | 2, 9              | REQ-INT-003                   |
| 11  | T-1155   | Working desktop: simulated screen and desk lamp driven by replicated activity         | 7                 | REQ-INT-002                   |
| 12  | T-1156   | Interaction feedback: target highlight, prompt, cabinet, fridge and door animations   | 6                 | REQ-INT-001, 004, 005         |
| 13  | T-1157   | Dropped by the owner on 2026-11-15 (sound)                                            | —                 | —                             |
| 14  | T-1158   | Small details: pantry items, wall clock, rug, books, plant variety                    | 2, 3              | REQ-ROOM-005, 006, 008        |
| 15  | T-1159   | 2D UI restyle with shared design tokens                                               | Phase 4           | REQ-UI-001 to 004             |
| 16  | T-1160   | Verification: FPS and draw calls on the owner's laptop, screenshots, docs             | 1 to 12, 14 to 21 | REQ-PERF-001, REQ-ROOM-001    |
| 17  | T-1218   | Avatars: animation and model options with owner go / no-go                            | Phase 4           | REQ-AVATAR-001, 002           |
| 18  | T-1219   | Avatars: typing motion while working, on local and remote avatars                     | 17                | REQ-AVATAR-002                |
| 19  | T-1220   | Protocol: emote intent, emote list, `BALANCE.emote`; SPEC and DECISIONS               | 8, 17             | REQ-AVATAR-004, REQ-SCOPE-002 |
| 20  | T-1221   | Server: emote handling in the activity sim (timer, rate limit, allowed states)        | 19                | REQ-AVATAR-004                |
| 21  | T-1222   | Client: emote menu and emote playback on local and remote avatars                     | 15, 18, 20        | REQ-AVATAR-004, REQ-UI-001    |

Tasks 17 to 21 were added on 2026-11-16. Meridian records only part of their order (Phase 4, and task 8 or 15 where listed); the dependencies on tasks 17 to 20 in this table are not in Meridian and must be followed by hand.

**Milestone A (after task 7):** the room looks upgraded and desks are furnished; the owner reviews screenshots and FPS before the interaction work.

**Milestone B (after task 11):** coffee routine and working desktop playable with two browsers.

**Milestone C (after task 21):** typing and emotes visible between two browsers.

## 5. Phase acceptance

- Side-by-side screenshots of the seven visual-spec views before and after, opened and accepted by the owner (visual quality stays a qualitative owner approval, OQ-003).
- All eight desks show monitor, keyboard, mouse, lamp, stationery and a decorative object.
- When an employee works, their monitor shows the simulated desktop and the lamp is on, on every client; it dims when they stop (Playwright, two pages).
- Coffee: E at the machine brews for the configured time, the employee then holds a cup that another client sees, three sips empty it, walking away during brewing cancels it, and a busy machine refuses a second employee (unit, integration and Playwright).
- The interaction target is highlighted; cabinet, fridge and doors animate.
- A working employee's avatar shows a typing motion on every client, and an emote picked from the menu is seen by a second client (unit and Playwright, two pages).
- With ten employees the owner's laptop holds at least the Phase 3 frame rate (about 55 FPS), and draw calls and triangles are recorded against the task 1 budget.
- `pnpm check` passes, and the owner runs one green foreground Playwright run.

## 6. Decisions the owner needs to confirm

Each has a default so work is not blocked; say if you want a different one.

1. **Sound is out of scope.** The owner dropped task 13 on 2026-11-15; no audio is added in this phase.
2. **Coffee numbers.** Default: 4 s brewing, 3 sips per cup, 2.5 s per sip (today's drink time), one employee at the machine at a time.
3. **Simulated desktop content.** Default: wallpaper in the office palette, a clock and one window with moving text lines; the same for everyone, no employee data on screen.
4. **Render budget.** Default: no fixed call count; the gate is "not slower than Phase 3 on the owner's laptop with ten employees", with the numbers recorded per task.
5. **Post-processing.** Default: anti-aliasing and mild bloom only; dropped if it costs more than 5 FPS on the owner's laptop.
6. **Layout stays as is.** Confirmed by the owner on 2026-11-16: no furniture is moved, and the room size and ten-employee capacity do not change, so collision, seats and the validator are untouched.
7. **Avatar option.** Default: keep the Modular Suit models and add procedural overlays plus unused library clips. Task 17 presents the alternatives.
8. **Emote list.** Default: wave, laugh, think, stretch and dance, final list in task 17. Emotes allowed while standing and seated, not while brewing.

## 7. Out of scope

Sound and audio, a usable desktop with applications, drink types, coffee beans or water levels, dirty cups, inventory, new furniture positions or room size, custom-made or paid 3D assets, Blender work, a custom avatar creator, voice chat (parked), text chat, mobile, deployment (Phase 5).

## 8. Risks

| Risk                                                                      | Mitigation                                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| More detail makes an already over-budget scene slower                     | Budget and instancing first (tasks 1, 3); every task records before and after numbers; avatar cost work is a gate |
| CC0 packs do not match each other in style or scale                       | Task 2 picks packs from the same authors already in use where possible; a person opens screenshots                |
| Software WebGL in e2e is too slow for post-processing and reflections     | A render-quality switch turns them off in e2e; visual checks are manual on real hardware                          |
| The coffee change touches the server activity state machine used by seats | Pure-module unit tests first (task 9); existing sit, work and drink tests must still pass                         |
| Canvas textures for eight screens cost memory and redraw time             | One shared texture per screen state, redrawn at most once per second, only for occupied working desks             |
| "Everything upgraded" keeps growing                                       | Scope is the 20 remaining tasks here; new ideas become new proposals, not additions to running tasks              |
| No CC0 typing or emote clips fit the Modular Suit rig                     | Task 17 decides before any work; the default needs no new asset (procedural overlays on existing clips)           |
| Emotes add a second protocol change next to coffee                        | Task 19 follows task 8 so `PROTOCOL_VERSION` moves once per task, in order                                        |

## 9. Documents to update when the phase lands (task 16)

`docs/SPEC.md` (REQ-INT-003 text and OQ-015 resolution, in task 8; REQ-AVATAR-004 and REQ-SCOPE-002 emotes, in task 19), `docs/CODEMAP.md`, `docs/ARCHITECTURE.md` §4, `docs/DECISIONS.md` (coffee routine, render budget, post-processing, new asset packs), `docs/STATUS.md`, `CHANGELOG.md`, `apps/web/public/assets/CREDITS.md`.
