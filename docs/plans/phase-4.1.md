# Phase 4.1 — Office Upgrade (visuals, interactions, details)

> Status: Approved by the owner on 2026-11-16 (chat), including the §6 defaults and tasks 17 to 21. Drafted 2026-11-15. Branch: `feat/phase-4.1` from `dev`, after Phase 4 (`docs/plans/phase-4.md`, FEAT-67) is done. Tracked in Meridian as FEAT-68 (auto-approved 2026-11-15); task ids are in §4. The FEAT-68 goal and scope text in Meridian predates tasks 17 to 21 and the sound decision; only a person can edit it there, so this file is the current scope. This plan covers design, scope and acceptance. Step-by-step implementation detail belongs in each task.

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
- The layout already lists a computer, keyboard, mouse, desk lamp, stationery and a decorative object per desk, but none of them is drawn: `DESK_SCREEN` (`computerScreen.glb`) and `COFFEE_MACHINE` are declared in the manifest and never loaded (task 1, §3.1.1).
- Materials are roughness-1 with a baked light probe; there are no specular environment reflections (DECISIONS 2026-11-10). There is no post-processing.
- Coffee: E at the coffee machine or water dispenser sets `drinking` for 2.5 s on the server (`BALANCE.activity.drinkSeconds`). There is no cup and no brewing step.
- Cabinets show a "Cabinet opened" toast. The fridge, plants and shelves have no interaction.
- There is no audio in the client, and none is added in this phase (owner, 2026-11-15).
- Render cost is already over the ARCHITECTURE target (45 calls, 120k triangles): about 170 calls with one employee and about 350 with ten. Two avatar cost proposals from Phase 3 are waiting for owner approval.

## 2. Entry gates

| Gate                                                                   | Blocks       | Why                                                                |
| ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------ |
| Phase 4 done (FEAT-67, T-1145)                                         | All tasks    | Owner decision 1; both phases edit `Game.ts`, protocol and e2e     |
| Owner approves this plan, the Meridian requirement and the §6 defaults | All tasks    | Met on 2026-11-16 (AGENTS.md §5: scope changes need approval)      |
| Avatar render cost proposals (Phase 3 follow-ups) approved and done    | Tasks 3 to 7 | New visual detail must not land on a scene that is over the budget |
| Owner approves each new CC0 asset pack (task 2)                        | Task 2       | AGENTS.md §6: explain material new assets; licences in CREDITS.md  |

## 3. Design

### 3.1 Render budget first

- Task 1 sets a measured budget for this phase with the owner's laptop as the reference machine: the frame rate with ten employees must not drop below the Phase 3 reading (about 55 FPS), and every later task records draw calls and triangles before and after with `__office.getDrawCalls()`.
- Static furniture and desk props are drawn with `InstancedMesh` or merged geometry per model and material, so eight desks with six props each do not add 48 or more draw calls. Shadow casting is limited to large furniture.

#### 3.1.1 Baseline (task 1, T-1146, measured 2026-11-17 on `req/feat-68` at `0a37261`)

**Budget rule (owner default §6.4).** There is no fixed draw-call or triangle cap for this phase. The gate is: with ten employees the owner's laptop must not be slower than the Phase 3 reading (about 55 FPS). Every later Phase 4.1 task that changes what is drawn re-runs the baseline spec below and reports draw calls (main + shadow) and triangles before and after in its Meridian evidence; the owner's laptop FPS is checked at Milestone A and in task 16. The ARCHITECTURE target (45 calls, 120k triangles) is already exceeded and stays a reference, not the gate.

**How to re-run.** `RENDER_BASELINE=1 pnpm --filter @office/web e2e renderBaseline` (`apps/web/e2e/renderBaseline.spec.ts`; skipped without the variable). It joins one browser plus idle headless bots standing at the spawn, waits for furniture, lighting and every remote avatar model, then reads `__office.getDrawCalls()` at the seven `visual.spec` views (shared in `e2e/poses.ts`). `RENDER_BASELINE_COUNTS=1,3,10` picks employee counts; the JSON lands in `visual-out/render-baseline.json`.

**Render-quality switch.** `VITE_RENDER_QUALITY` (`apps/web/src/game/renderQuality.ts`): `high` by default, `e2e` in Playwright builds (`playwright.config.ts`). Nothing reads it yet; tasks 4 and 5 use it to keep reflections and post-processing off under software WebGL. The baseline below ran with `e2e`, which today renders exactly what `high` renders.

**What is drawn today** (33 layout items, `furnitureManifest.ts`, `room.ts`, `loadFurniture.ts`):

| Layout content                                                                                                                            | Count | Drawn as                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| desk, chair                                                                                                                               | 8 + 8 | Kenney GLB model (`desk`, `chairDesk`)                                                   |
| fridge, countertop, water_dispenser, storage_cabinet, lockers, shelves, plant (2), shoe_rack, sofa, coffee_table, TV, decorative_lighting | 13    | Kenney GLB model (`furnitureManifest.ts`; 29 models loaded in total)                     |
| main_door, utility_door, air_conditioner                                                                                                  | 3     | Palette box (`room.ts`)                                                                  |
| Shell: floor, ceiling, 6 wall boxes                                                                                                       | 8     | Procedural planes and boxes; the south window is part of the `wall_south` box            |
| TV `tv_screen` component                                                                                                                  | 1     | Procedural bezel and depth-only occluder (`TvScreen`) under the CSS3D video              |
| Entrance online board                                                                                                                     | 1     | Procedural plane with a canvas texture (`EntranceBoard`)                                 |
| Avatars (local and each remote)                                                                                                           | 1–10  | Modular Suit GLB (`men_suit` / `women_suit`), capsule until loaded; nameplates are CSS2D |
| Desk components: computer, keyboard, mouse, desk_lamp, stationery, decorative_object, desk_divider, desk_frame                            | 8 × 8 | **Not drawn** (`DESK_SCREEN` declared, unused; the desk model has its own frame)         |
| Countertop components: cabinets (2), coffee_machine, cups                                                                                 | 4     | **Not drawn** (`COFFEE_MACHINE` declared, unused); the countertop model only             |
| main_door components: door, door_frame, signage, intercom, breaker_box; TV speakers (2); shelves personal_decorative_items, boxes         | 9     | **Not drawn**                                                                            |
| Shell window glass and blinds, ceiling light fixture                                                                                      | 2     | **Not drawn** (lighting only: hemisphere, sun with shadows, baked light probe)           |

**Draw calls and triangles** — headless Chromium with **SwiftShader software WebGL** in the cloud container, 1280×720, render quality `e2e`. Call and triangle counts depend on the scene and view, not the GPU, so they are the comparable numbers; the FPS row is not representative of real hardware. Triangles are summed over the shadow and main passes. Bots stand idle at the spawn.

| View              | 1 employee: main / shadow / total | Triangles | 3 employees: main / shadow / total | Triangles | 10 employees: main / shadow / total | Triangles |
| ----------------- | --------------------------------- | --------- | ---------------------------------- | --------- | ----------------------------------- | --------- |
| 01-spawn          | 70 / 104 / 174                    | 25,898    | 90 / 124 / 214                     | 52,434    | 160 / 194 / 354                     | 145,310   |
| 02-pods           | 68 / 104 / 172                    | 27,628    | 88 / 124 / 212                     | 54,164    | 158 / 194 / 352                     | 147,040   |
| 03-tv-wall        | 71 / 104 / 175                    | 27,018    | 91 / 124 / 215                     | 53,554    | 161 / 194 / 355                     | 146,430   |
| 04-across-tv-wall | 49 / 104 / 153                    | 24,524    | 69 / 124 / 193                     | 51,060    | 139 / 194 / 333                     | 143,936   |
| 05-near-wall-fade | 89 / 104 / 193                    | 29,358    | 109 / 124 / 233                    | 55,894    | 179 / 194 / 373                     | 148,770   |
| 06-desk-side      | 79 / 104 / 183                    | 26,520    | 99 / 124 / 223                     | 53,056    | 169 / 194 / 363                     | 145,932   |
| 07-sofa-side      | 81 / 104 / 185                    | 26,336    | 103 / 124 / 227                    | 53,180    | 169 / 194 / 363                     | 145,720   |
| FPS at 01-spawn   | 4.8 (SwiftShader)                 |           | 3.4 (SwiftShader)                  |           | 3.1 (SwiftShader)                   |           |

Repeat runs can differ by a few calls in a view (the same session's `visual.spec` run read 83 main calls and 26,644 triangles at 07-sofa-side). Readings: each extra employee adds about 10 main and 10 shadow calls and about 13,300 triangles in every view (avatars dominate the triangle count from three employees up); the shadow pass (104 calls with one employee) costs more calls than the main pass because every furniture mesh casts. Desk props and room details are the next additions, which is why task 3 (instancing) comes before tasks 6, 7 and 14.

**Owner item:** FPS with ten employees on the owner's laptop for the current scene (the Phase 3 reading was about 55 FPS); not measurable in this container.

#### 3.1.2 After instancing (task 3, T-1148, measured 2026-11-18 on `wt-instancing2`)

`loadFurniture` groups placements by model file and shadow flag; a model placed more than once becomes one `InstancedMesh` per part (geometry + material), with each instance matrix equal to the world matrix `fitModel` gives that copy. 29 models load as 19 `InstancedMesh` objects (desk 3, chair 3, potted plant 3, kitchen cabinet 5, closed bookcase 5) plus 7 single models. Only layout boxes of at least 0.05 m³ cast shadows (`SHADOW_MIN_VOLUME`); every current furniture item is larger, so the picture is unchanged and only desk props and details added later stop casting. The camera hides an occluding instance by collapsing its matrix for one frame (`occluderHider.ts`). Collision is unchanged: it reads `office-layout.json` in `packages/protocol`, not the meshes. Same run conditions as the table above (SwiftShader, 1280×720, `e2e` quality, before numbers re-run on the same commit and machine).

| View              | 1 employee: main / shadow / total (before) | Triangles (before) | 3 employees (before) | Triangles (before) | 10 employees (before) | Triangles (before) |
| ----------------- | ------------------------------------------ | ------------------ | -------------------- | ------------------ | --------------------- | ------------------ |
| 01-spawn          | 56 / 49 / 105 (174)                        | 30,128 (25,898)    | 76 / 69 / 145 (214)  | 56,664 (52,434)    | 146 / 139 / 285 (354) | 149,540 (145,310)  |
| 02-pods           | 40 / 49 / 89 (172)                         | 29,304 (27,628)    | 60 / 69 / 129 (212)  | 55,840 (54,164)    | 130 / 139 / 269 (352) | 148,716 (147,040)  |
| 03-tv-wall        | 46 / 49 / 95 (175)                         | 29,716 (27,018)    | 66 / 69 / 135 (215)  | 56,252 (53,554)    | 136 / 139 / 275 (355) | 149,128 (146,430)  |
| 04-across-tv-wall | 35 / 49 / 84 (153)                         | 29,180 (24,524)    | 55 / 69 / 124 (193)  | 55,716 (51,060)    | 125 / 139 / 264 (333) | 148,592 (143,936)  |
| 05-near-wall-fade | 49 / 49 / 98 (193)                         | 29,758 (29,358)    | 69 / 69 / 138 (233)  | 56,294 (55,894)    | 139 / 139 / 278 (373) | 149,170 (148,770)  |
| 06-desk-side      | 57 / 49 / 106 (183)                        | 30,140 (26,520)    | 77 / 69 / 146 (223)  | 56,676 (53,056)    | 147 / 139 / 286 (363) | 149,552 (145,932)  |
| 07-sofa-side      | 57 / 49 / 106 (187)                        | 30,140 (26,644)    | 77 / 69 / 146 (225)  | 56,676 (52,872)    | 147 / 139 / 286 (363) | 149,552 (145,720)  |

Readings: total calls drop by 69 to 95 per view (the shadow pass from 104 to 49 with one employee). Triangles rise by up to about 4,700 because an `InstancedMesh` is culled as a whole: all eight desks are drawn when any is in view. Avatars still add about 10 main and 10 shadow calls each. Before / after screenshots of the seven views differ only in the avatar's idle-animation phase.

### 3.2 Visuals (CC0 only)

- Materials: wood, metal, fabric and glass get distinct roughness and metalness values, and a PMREM environment map adds soft reflections on glass, metal and screens.
- Lighting: daylight through the window wall, ceiling light fixtures that match the photos, softer contact shadows. Light post-processing (anti-aliasing and a mild bloom on screens and lamps) uses the `EffectComposer` that ships with three; no new package.
- Room shell: window frames with glass, skirting boards, ceiling panels, real door models for the main and utility doors, an air-conditioner model, wall signage.
- Small details: desk clutter, pantry cups and sink items, a wall clock showing the local time, a rug in the entertainment corner, books on shelves, plant variety. All from CC0 packs, credited in `apps/web/public/assets/CREDITS.md`.

**Task 2 result (T-1147, 2026-11-18).** The owner-approved models (DECISIONS 2026-11-17) were copied unchanged from the official Kenney zips the owner committed to `dev` in 6c15589; none is placed in the room yet (tasks 6, 7, 10, 14). Manifest constants: `FURNITURE_PROPS`, `FOOD`, `FOOD_DIR` in `apps/web/src/game/assets/furnitureManifest.ts`; `apps/web/test/furnitureManifest.test.ts` checks every manifest entry is an existing glTF 2.0 binary whose external resources exist. The 17 models already in the repo are byte-identical (SHA-256) to the Furniture Kit zip. Triangles and primitives come from the GLB JSON (index count / 3, triangle mode); every file is glTF 2.0.

| File (`apps/web/public/assets/`)  | Pack          | Bytes  | Triangles | Primitives |
| --------------------------------- | ------------- | ------ | --------- | ---------- |
| `furniture/computerKeyboard.glb`  | Furniture Kit | 3,476  | 32        | 2          |
| `furniture/computerMouse.glb`     | Furniture Kit | 5,868  | 71        | 1          |
| `furniture/lampSquareTable.glb`   | Furniture Kit | 5,624  | 60        | 2          |
| `furniture/lampRoundTable.glb`    | Furniture Kit | 6,604  | 76        | 2          |
| `furniture/lampSquareCeiling.glb` | Furniture Kit | 5,628  | 60        | 2          |
| `furniture/books.glb`             | Furniture Kit | 6,864  | 62        | 4          |
| `furniture/plantSmall1.glb`       | Furniture Kit | 8,224  | 102       | 2          |
| `furniture/plantSmall2.glb`       | Furniture Kit | 12,996 | 158       | 2          |
| `furniture/plantSmall3.glb`       | Furniture Kit | 8,424  | 98        | 2          |
| `furniture/rugRectangle.glb`      | Furniture Kit | 3,188  | 28        | 2          |
| `furniture/rugRounded.glb`        | Furniture Kit | 10,876 | 204       | 2          |
| `furniture/doorwayFront.glb`      | Furniture Kit | 13,016 | 156       | 4          |
| `furniture/kitchenSink.glb`       | Furniture Kit | 23,480 | 318       | 8          |
| `furniture/kitchenMicrowave.glb`  | Furniture Kit | 11,248 | 152       | 6          |
| `furniture/toaster.glb`           | Furniture Kit | 14,924 | 220       | 2          |
| `furniture/trashcan.glb`          | Furniture Kit | 6,452  | 68        | 2          |
| `furniture/laptop.glb`            | Furniture Kit | 5,540  | 68        | 3          |
| `furniture/radio.glb`             | Furniture Kit | 25,020 | 432       | 3          |
| `furniture/bear.glb`              | Furniture Kit | 11,884 | 134       | 3          |
| `furniture/speakerSmall.glb`      | Furniture Kit | 15,244 | 220       | 2          |
| `food/cup-coffee.glb`             | Food Kit      | 7,872  | 108       | 1          |
| `food/mug.glb`                    | Food Kit      | 20,236 | 232       | 1          |
| `food/glass.glb`                  | Food Kit      | 4,216  | 44        | 1          |
| `food/Textures/colormap.png`      | Food Kit      | 10,715 | —         | —          |

Food Kit models use one textured primitive each and reference `Textures/colormap.png` (512 × 512) relative to their folder, so they stay in `food/`; Furniture Kit models are untextured with embedded buffers. Per desk, keyboard + mouse + table lamp adds about 170 triangles and 5 primitives before instancing (task 3).

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

**Task 10 result (T-1154, 2026-11-19).** E at the machine brews (progress prompt, steam while anyone brews, "Machine in use" from replicated state); the cup is drawn in the right hand and on the desk or coffee table while seated, on local and remote avatars; F sips, also seated (owner decision 2026-11-17, added to the protocol and server rules; the coffee machine lost its one-step drink, `PROTOCOL_VERSION` 6). Draw calls on the observing page in e2e quality (`coffee.spec.ts`): 64 before, 65 while brewing (steam), 65 with the cup in view (+108 triangles). Choices in DECISIONS 2026-11-19.

### 3.5 Interaction feedback

- The current interaction target gets a visible highlight, and the prompt shows the key and the action name.
- Cabinet, fridge and door interactions play a local open and close animation instead of only a toast. They stay local presentation, as today.

### 3.6 2D UI

- One set of design tokens (colours from the SPEC palette, spacing, radius, type scale) applied to the join screen, employee list, prompt, toast, connection banner and the Phase 4 TV panel. Keyboard focus states and readable contrast are part of the restyle.

**Task 15 result (T-1159, 2026-11-17).** Tokens: `apps/web/src/ui/tokens.css` (CSS custom properties `--ov-*`: palette colours from the layout `palette` — walls `#F5F6F8`, chair seat ink `#222426`, lime `#6CB33F` / `#48A832`, walnut — plus light-surface, dark-HUD, accent, focus, spacing on a 4 px grid, radius, type scale and two shadows). `ui/tokens.ts` holds typed `var(--ov-…)` references for inline styles; `ui/ui.css` holds the states inline styles cannot express (buttons, inputs, hover, disabled, `:focus-visible` ring: 3 px deep lime on light surfaces, lime on the dark HUD, white on the red alert banner; the game canvas keeps no ring). Join screen, employee list, prompt, toast, connection banner, TV panel and the key hint read only tokens; `apps/web/test/uiTokens.test.ts` fails on any hex, `rgb()` / `hsl()` or `system-ui` literal in those files and on an unresolved token. Disconnected rows in the list are muted and italic instead of 50 % opacity (opacity broke contrast). Contrast (WCAG 2.x, translucent HUD composited over white, the worst case), checked by the same test:

| Pair                                              | Ratio               |
| ------------------------------------------------- | ------------------- |
| Join card text / muted text / error               | 15.57 / 8.27 / 6.57 |
| Join Office button (ink on lime, normal / hover)  | 5.13 / 6.05         |
| HUD text / muted text / unavailable prompt        | 12.22 / 7.65 / 6.20 |
| HUD button text (normal / hover)                  | 8.39 / 6.52         |
| TV selected catalog entry; error box text / muted | 6.87; 9.94 / 6.22   |
| Connection lost banner                            | 5.99                |

Focus rings and input borders reach at least 3:1 against their surface (WCAG 1.4.11). Disabled buttons (50 % opacity) are exempt.

### 3.7 Avatars

- Starting point: two presets (`men_suit.glb`, `women_suit.glb`, Quaternius Modular Suit) animated with clips retargeted from the Quaternius Universal Animation Library (`anim/ual.glb`, 46 clips). `working` plays `Sitting_Idle_Loop`, so a working employee looks the same as a seated idle one; the wave is a procedural arm override. The library has no typing, laughing or waving clip. Office-usable unused clips: `Idle_Talking_Loop`, `Sitting_Talking_Loop`, `Sitting_Enter`, `Sitting_Exit`, `PickUp_Table`, `Dance_Loop`, `Walk_Formal_Loop`.
- Task 17 compares three options with licence, size, rig compatibility, draw calls and effort: keep the models and add procedural overlays plus unused library clips (default), add another CC0 animation pack, or add or replace presets with other CC0 rigged models. The owner picks one. Replacing the models changes the REQ-AVATAR-001 decision and redoes the avatar render cost work, so it needs an explicit owner choice.
- Task 18 gives `working` a typing motion on both presets and on remote avatars. It derives from the replicated `activity`; no new network state.

**Task 17 result (T-1218, 2026-11-17).** Measured from the files in `apps/web/public/assets` (GLB JSON parsed in Node): `men_suit.glb` 858 KB, 4 skinned meshes, 10 primitives, 49 joints; `women_suit.glb` 815 KB, 10 primitives, 51 joints; `anim/ual.glb` 3.2 MB, 46 clips, 53 joints. One avatar is 10 draw calls (one per primitive) plus the same 10 in the shadow pass. Sizes of packs that are not in the repository were not measured (the container cannot download them) and are marked "not measured".

| Option                                                                 | Licence                  | Extra download                   | Rig compatibility with `avatar/retarget.ts`                                                          | Draw calls per avatar                        | Effort                                                                                  |
| ---------------------------------------------------------------------- | ------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| (a) Keep Modular Suit; unused UAL1 clips plus procedural bone overlays | CC0 (already credited)   | 0 bytes (UAL1 is already loaded) | Already retargeted (49 / 51 to 53 joints); the wave overlay already drives `UpperArmR` / `LowerArmR` | Unchanged: 10                                | Low to medium: one more clip in the retarget list, overlay code in `AvatarView.ts`      |
| (b) Add another CC0 animation pack (for example UAL2)                  | CC0 (to verify per pack) | Not measured                     | Needs a second skeleton map in `retarget.ts`; UAL2 also needs a clip-extraction step                 | Unchanged: 10 (animation adds no draw calls) | Medium to high: new asset approval, bone map, retarget tests on both rigs               |
| (c) Add or replace presets with other CC0 rigged models                | CC0 (to verify per pack) | Not measured                     | New rig: new retarget map, or a pack with its own clips; seated-pose alignment redone                | Depends on the model's primitive count       | High: changes the REQ-AVATAR-001 decision, redoes the avatar render-cost work (plan §2) |

Owner choice (2026-11-17, DECISIONS): **(a)**. UAL1 clip inventory (46): `A_TPose`, `Crouch_Fwd_Loop`, `Crouch_Idle_Loop`, `Dance_Loop`, `Death01`, `Driving_Loop`, `Fixing_Kneeling`, `Hit_Chest`, `Hit_Head`, `Idle_Loop`, `Idle_Talking_Loop`, `Idle_Torch_Loop`, `Interact`, `Jog_Fwd_Loop`, `Jump_Land`, `Jump_Loop`, `Jump_Start`, `PickUp_Table`, `Pistol_Aim_Down`, `Pistol_Aim_Neutral`, `Pistol_Aim_Up`, `Pistol_Idle_Loop`, `Pistol_Reload`, `Pistol_Shoot`, `Punch_Cross`, `Punch_Enter`, `Punch_Jab`, `Push_Loop`, `Roll`, `Roll_RM`, `Sitting_Enter`, `Sitting_Exit`, `Sitting_Idle_Loop`, `Sitting_Talking_Loop`, `Spell_Simple_Enter`, `Spell_Simple_Exit`, `Spell_Simple_Idle_Loop`, `Spell_Simple_Shoot`, `Sprint_Loop`, `Swim_Fwd_Loop`, `Swim_Idle_Loop`, `Sword_Attack`, `Sword_Attack_RM`, `Sword_Idle`, `Walk_Formal_Loop`, `Walk_Loop`. In use today: `Idle_Loop`, `Walk_Loop`, `Sitting_Idle_Loop`, `Interact`.

Emote list and what plays each one (base clip: `Idle_Loop` standing, `Sitting_Idle_Loop` seated):

| Emote     | Source                                                    | Standing | Seated              |
| --------- | --------------------------------------------------------- | -------- | ------------------- |
| `wave`    | Procedural right-arm override (exists in `AvatarView.ts`) | yes      | yes                 |
| `dance`   | UAL1 `Dance_Loop` (1.0 s loop, full body)                 | yes      | no (full-body clip) |
| `think`   | Procedural overlay: right hand to chin, head tilted down  | yes      | yes                 |
| `laugh`   | Procedural overlay: spine and head shake                  | yes      | yes                 |
| `stretch` | Procedural overlay: both arms raised overhead             | yes      | yes                 |

**Task 18 result (T-1219, 2026-11-17).** `working` keeps `Sitting_Idle_Loop` and adds a procedural typing overlay (`apps/web/src/game/avatar/overlays.ts`, `applyTyping`): both upper arms reach forward, forearms point at the keyboard and the hands tap in alternation; values in `BALANCE.avatar.typing` (client presentation only). The overlay weight ramps 0 → 1 → 0 over `BALANCE.activity.crossFadeSeconds` (0.25 s) on entering and leaving `working`, so a weight of 0 leaves the clip pose untouched; switching between `sitting` and `working` no longer restarts the shared seated loop (no pop). Local and remote avatars use the same `AvatarView`, driven by the replicated `activity`; no protocol or server change. Evidence: `avatarClips.test.ts` (both presets: arms differ from seated idle and move over time, finite bones, back on the seated idle pose within the cross-fade); two-page `e2e/typing.spec.ts` (local `getTyping()` and the remote list's `typing` reach 1 while working and 0 after). Draw calls on the observing page with one remote at the desk: 176 total (62 main, 114 shadow), 39,846 triangles both before and while typing — the overlay only moves bones.

### 3.8 Emotes

- A fixed list of four to five emotes (wave included), approved in task 17. The `emote` intent carries only an id from that list: no free text, so the prototype stays chat-free.
- The server owns the emote like it owns wave today: it starts it, runs the timer from `BALANCE.emote`, enforces a minimum gap per employee and restores the previous activity. Task 19 decides whether emotes are allowed while seated, while holding a coffee and while brewing.
- Task 19 result (T-1220, 2026-11-17): intent `{ type: 'emote', emote }`, replicated `EmployeeState.emote` as a layer over `activity`, `BALANCE.emote`, `PROTOCOL_VERSION` 5 (SPEC REQ-AVATAR-004, DECISIONS).
- The client adds an emote button and a small menu to the 2D UI and plays the emote on local and remote avatars from replicated state.
- Task 21 result (T-1222, 2026-11-17): `apps/web/src/ui/EmoteMenu.tsx` (an "Emotes" toggle next to the "G — Wave" hint, bottom left; one button per protocol emote with an emoji icon and a label; emotes `canEmote` refuses for the current activity are disabled; Escape closes; closing or picking returns keyboard focus to the game canvas; hidden in TV mode). `AvatarView.setEmote` plays each emote per §3.7 (`EMOTE_SOURCE`): `dance` cross-fades to UAL1 `Dance_Loop` (now retargeted with the other clips), `wave` reuses the Phase 2 arm override, `think` / `laugh` / `stretch` are overlays in `avatar/overlays.ts` (`BALANCE.avatar.emote`), blended over the 0.25 s cross-fade; a running emote suspends typing. The local avatar follows `EmployeeState.emote` like breaks (dropped at once when moving); remote avatars follow the replicated field. The G key now sends the `wave` emote (DECISIONS 2026-11-17, T-1222). Evidence: `test/emoteMenu.test.tsx` (lists the protocol emotes, sends the matching emote on click, Escape closes), `avatarClips.test.ts` (every emote on both presets, standing and seated where allowed: pose changes, finite bones, back to the activity pose after the cross-fade), two-page `e2e/emote.spec.ts` (menu by mouse and keyboard, B sees A's dance, think, laugh, stretch and the G wave). Draw calls on the observing page: 191 total (77 main, 114 shadow), 38,282 triangles before and during the dance.

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
| 8   | T-1165   | Protocol: coffee item, sips, `brewing` activity, `BALANCE.coffee`; SPEC and DECISIONS | Phase 4           | REQ-INT-003                   |
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
7. **Avatar option.** Decided by the owner on 2026-11-17: option (a), keep the Modular Suit models and add procedural overlays plus unused UAL1 clips (§3.7, DECISIONS).
8. **Emote list.** Decided by the owner on 2026-11-17: wave, dance, think, laugh, stretch. Allowed states (task 19, DECISIONS): standing and seated, not while drinking, waving or brewing; dance standing only.

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
