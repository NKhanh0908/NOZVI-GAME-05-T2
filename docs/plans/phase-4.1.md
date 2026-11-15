# Phase 4.1 — Office Upgrade (visuals, interactions, details)

> Status: Draft for owner review, 2026-11-15. Branch: `feat/phase-4.1` from `dev`, after Phase 4 (`docs/plans/phase-4.md`, FEAT-67) is done. Tracked in Meridian as FEAT-68 (auto-approved 2026-11-15); task ids are in §4 ("proposal" means it awaits owner approval in Meridian). This plan covers design, scope and acceptance. Step-by-step implementation detail belongs in each task.

**Goal:** Upgrade the existing 3D office in every visible respect without changing its layout: better-looking room and materials, fully furnished desks with a live desktop screen while working, a multi-step coffee routine with a cup that others can see, clearer interactions, sound and a restyled 2D UI.

**Owner decisions behind this plan (2026-11-15, chat):**

1. Phase 4 stays the shared TV. Phase 4.1 is this upgrade and starts after Phase 4 is done.
2. Desks get both: the full set of desk objects, and a simulated desktop on the monitor while the employee works, visible to others.
3. Coffee is a multi-step routine with a cup (take a cup, the machine brews, carry the cup, sip, put it on the desk). No inventory and no consumables.
4. Visuals stay on CC0 assets without Blender (DECISIONS 2026-11-09); quality goes up through more CC0 assets, materials, lighting and small details, together with draw-call work to keep about 55 FPS on the owner's laptop.

**Requirements touched:** REQ-ROOM-001 and REQ-ROOM-003 to REQ-ROOM-008 (visual quality and asset categories), REQ-INT-001 (prompt and targeting feedback), REQ-INT-002 (work state shown on the desk), REQ-INT-003 and OQ-015 (coffee triggers, durations, cup), REQ-INT-004 and REQ-INT-005 (cabinet and door feedback), REQ-UI-001 to REQ-UI-004 (2D UI polish), REQ-PERF-001 to REQ-PERF-003 (`docs/SPEC.md`). The coffee routine changes an approved gameplay rule; the owner approved the change in decision 3, and task 8 records it in SPEC and DECISIONS.

## 1. Starting point

- The room is a procedural shell (`room.ts`) with 17 Kenney GLB models (`furnitureManifest.ts`). The main door, utility door and air conditioner are plain palette boxes.
- The layout already lists a computer, keyboard, mouse, desk lamp, stationery and a decorative object per desk, but only a static screen model is drawn. Task 1 confirms exactly what is drawn today.
- Materials are roughness-1 with a baked light probe; there are no specular environment reflections (DECISIONS 2026-11-10). There is no post-processing.
- Coffee: E at the coffee machine or water dispenser sets `drinking` for 2.5 s on the server (`BALANCE.activity.drinkSeconds`). There is no cup and no brewing step.
- Cabinets show a "Cabinet opened" toast. The fridge, plants and shelves have no interaction.
- There is no audio anywhere in the client.
- Render cost is already over the ARCHITECTURE target (45 calls, 120k triangles): about 170 calls with one employee and about 350 with ten. Two avatar cost proposals from Phase 3 are waiting for owner approval.

## 2. Entry gates

| Gate                                                                   | Blocks       | Why                                                                |
| ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------ |
| Phase 4 done (FEAT-67, T-1145)                                         | All tasks    | Owner decision 1; both phases edit `Game.ts`, protocol and e2e     |
| Owner approves this plan, the Meridian requirement and the §6 defaults | All tasks    | AGENTS.md §5: phase scope and gameplay rule changes need approval  |
| Avatar render cost proposals (Phase 3 follow-ups) approved and done    | Tasks 3 to 7 | New visual detail must not land on a scene that is over the budget |
| Owner approves each new CC0 asset pack and sound source (task 2, 13)   | Tasks 2, 13  | AGENTS.md §6: explain material new assets; licences in CREDITS.md  |

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

### 3.5 Interaction feedback and sound

- The current interaction target gets a visible highlight, and the prompt shows the key and the action name.
- Cabinet, fridge and door interactions play a local open and close animation instead of only a toast. They stay local presentation, as today.
- Sound through the Web Audio API (no package): footsteps, coffee machine, cup, door, UI clicks and a quiet room tone, with a mute toggle remembered in localStorage. Audio starts only after the Join click, which is a user gesture. Sounds come from CC0 sources and are credited.

### 3.6 2D UI

- One set of design tokens (colours from the SPEC palette, spacing, radius, type scale) applied to the join screen, employee list, prompt, toast, connection banner and the Phase 4 TV panel. Keyboard focus states and readable contrast are part of the restyle.

## 4. Tasks

Each task stays within Meridian's 30-minute cap. All depend on Phase 4 being done; the order below is the intended sequence.

| #   | Meridian | Task                                                                                  | Depends on | Requirements               |
| --- | -------- | ------------------------------------------------------------------------------------- | ---------- | -------------------------- |
| 1   | T-1146   | Baseline: record what is drawn today, draw calls, triangles and the phase budget      | Phase 4    | REQ-PERF-001 to 003        |
| 2   | T-1147   | Assets: choose and add CC0 packs for props, doors and details; credits and licences   | 1          | REQ-ROOM-004 to 008        |
| 3   | T-1148   | Rendering: instanced or merged static furniture and props                             | 1          | REQ-PERF-002               |
| 4   | T-1149   | Materials and PMREM environment reflections                                           | 3          | REQ-ROOM-001               |
| 5   | T-1150   | Lighting: window daylight, ceiling fixtures, softer shadows, light post-processing    | 4          | REQ-ROOM-001               |
| 6   | T-1151   | Room shell details: windows, skirting, ceiling, door and air-conditioner models       | 2, 3       | REQ-ROOM-003, 007          |
| 7   | T-1152   | Desk props: keyboard, mouse, lamp, stationery and decoration on all eight desks       | 2, 3       | REQ-ROOM-004               |
| 8   | proposal | Protocol: coffee item, sips, `brewing` activity, `BALANCE.coffee`; SPEC and DECISIONS | Phase 4    | REQ-INT-003                |
| 9   | T-1153   | Server: coffee routine in the activity sim (brew, cancel, sip, busy machine)          | 8          | REQ-INT-003                |
| 10  | T-1154   | Client: brewing feedback at the machine, cup in hand and on the desk, remote view     | 2, 9       | REQ-INT-003                |
| 11  | T-1155   | Working desktop: simulated screen and desk lamp driven by replicated activity         | 7          | REQ-INT-002                |
| 12  | T-1156   | Interaction feedback: target highlight, prompt, cabinet, fridge and door animations   | 6          | REQ-INT-001, 004, 005      |
| 13  | T-1157   | Sound: Web Audio effects, room tone and mute toggle                                   | 10, 12     | (new, owner decision §6)   |
| 14  | T-1158   | Small details: pantry items, wall clock, rug, books, plant variety                    | 2, 3       | REQ-ROOM-005, 006, 008     |
| 15  | T-1159   | 2D UI restyle with shared design tokens                                               | Phase 4    | REQ-UI-001 to 004          |
| 16  | T-1160   | Verification: FPS and draw calls on the owner's laptop, screenshots, docs             | 1 to 15    | REQ-PERF-001, REQ-ROOM-001 |

**Milestone A (after task 7):** the room looks upgraded and desks are furnished; the owner reviews screenshots and FPS before the interaction work.

**Milestone B (after task 11):** coffee routine and working desktop playable with two browsers.

## 5. Phase acceptance

- Side-by-side screenshots of the seven visual-spec views before and after, opened and accepted by the owner (visual quality stays a qualitative owner approval, OQ-003).
- All eight desks show monitor, keyboard, mouse, lamp, stationery and a decorative object.
- When an employee works, their monitor shows the simulated desktop and the lamp is on, on every client; it dims when they stop (Playwright, two pages).
- Coffee: E at the machine brews for the configured time, the employee then holds a cup that another client sees, three sips empty it, walking away during brewing cancels it, and a busy machine refuses a second employee (unit, integration and Playwright).
- The interaction target is highlighted; cabinet, fridge and doors animate.
- Sound plays after joining and the mute toggle silences everything and is remembered.
- With ten employees the owner's laptop holds at least the Phase 3 frame rate (about 55 FPS), and draw calls and triangles are recorded against the task 1 budget.
- `pnpm check` passes, and the owner runs one green foreground Playwright run.

## 6. Decisions the owner needs to confirm

Each has a default so work is not blocked; say if you want a different one.

1. **Sound is in scope.** It was not named in the request. Default: included as task 13, with a mute toggle. Drop the task if you do not want audio.
2. **Coffee numbers.** Default: 4 s brewing, 3 sips per cup, 2.5 s per sip (today's drink time), one employee at the machine at a time.
3. **Simulated desktop content.** Default: wallpaper in the office palette, a clock and one window with moving text lines; the same for everyone, no employee data on screen.
4. **Render budget.** Default: no fixed call count; the gate is "not slower than Phase 3 on the owner's laptop with ten employees", with the numbers recorded per task.
5. **Post-processing.** Default: anti-aliasing and mild bloom only; dropped if it costs more than 5 FPS on the owner's laptop.
6. **Layout stays as is.** Default: no furniture is moved and the room size does not change, so collision, seats and the validator are untouched.

## 7. Out of scope

A usable desktop with applications, drink types, coffee beans or water levels, dirty cups, inventory, new furniture positions or room size, custom-made or paid 3D assets, Blender work, new avatar models, chat, mobile, deployment (Phase 5).

## 8. Risks

| Risk                                                                      | Mitigation                                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| More detail makes an already over-budget scene slower                     | Budget and instancing first (tasks 1, 3); every task records before and after numbers; avatar cost work is a gate |
| CC0 packs do not match each other in style or scale                       | Task 2 picks packs from the same authors already in use where possible; a person opens screenshots                |
| Software WebGL in e2e is too slow for post-processing and reflections     | A render-quality switch turns them off in e2e; visual checks are manual on real hardware                          |
| The coffee change touches the server activity state machine used by seats | Pure-module unit tests first (task 9); existing sit, work and drink tests must still pass                         |
| Canvas textures for eight screens cost memory and redraw time             | One shared texture per screen state, redrawn at most once per second, only for occupied working desks             |
| Browsers block audio until a user gesture                                 | Audio context starts on the Join click                                                                            |
| "Everything upgraded" keeps growing                                       | Scope is the 16 tasks here; new ideas become new proposals, not additions to running tasks                        |

## 9. Documents to update when the phase lands (task 16)

`docs/SPEC.md` (REQ-INT-003 text and OQ-015 resolution, in task 8), `docs/CODEMAP.md`, `docs/ARCHITECTURE.md` §4, `docs/DECISIONS.md` (coffee routine, render budget, post-processing, new asset packs), `docs/STATUS.md`, `CHANGELOG.md`, `apps/web/public/assets/CREDITS.md`.
