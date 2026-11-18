# Asset credits (all CC0 1.0)

- furniture/*.glb — Kenney Furniture Kit, https://kenney.nl (KENNEY-LICENSE.txt)
- avatars/*.glb — Quaternius Modular Men / Women (Suit), https://quaternius.com
  - `men_suit.glb` (858 KB, 10 primitives, 49 joints), `women_suit.glb` (815 KB, 10 primitives, 51 joints)
- anim/*.glb — Quaternius Universal Animation Library (UAL1), https://quaternius.com
  - `ual.glb` (3.2 MB, 46 clips, 53 joints), retargeted at runtime onto both suit rigs
  - Clips used: `Idle_Loop`, `Walk_Loop`, `Sitting_Idle_Loop`, `Interact`; `Dance_Loop` is approved for the dance emote (DECISIONS 2026-11-17, plan phase-4.1 §3.7)
  - Wave, think, laugh and stretch emotes are procedural bone overlays, not assets

## Phase 4.1 additions (T-1147)

Provenance for both packs: the official zips downloaded by the owner from kenney.nl, committed to `dev` in 6c15589 (`kenney/kenney_furniture-kit.zip`, `kenney/kenney_food-kit.zip`). Files were copied unchanged; sizes, triangles and primitives are in `docs/plans/phase-4.1.md` §3.2.

- **Kenney Furniture Kit (2.0)** — author Kenney (www.kenney.nl), licence Creative Commons Zero (CC0 1.0, http://creativecommons.org/publicdomain/zero/1.0/), License.txt creation date 20-10-2018. Licence text: `furniture/KENNEY-LICENSE.txt` (byte-identical to the zip's `License.txt`). Files in `furniture/`: `computerKeyboard.glb`, `computerMouse.glb`, `lampSquareTable.glb`, `lampRoundTable.glb`, `lampSquareCeiling.glb`, `books.glb`, `plantSmall1.glb`, `plantSmall2.glb`, `plantSmall3.glb`, `rugRectangle.glb`, `rugRounded.glb`, `doorwayFront.glb`, `kitchenSink.glb`, `kitchenMicrowave.glb`, `toaster.glb`, `trashcan.glb`, `laptop.glb`, `radio.glb`, `bear.glb`, `speakerSmall.glb`, and since T-1158 (owner, 2026-11-18: use more of the Kenney packs) `kitchenCabinetUpperDouble.glb`, `pillowBlue.glb`, `rugDoormat.glb` (from `Models/GLTF format/`). The 17 earlier `furniture/*.glb` files are byte-identical to the same zip.
- **Kenney Food Kit (2.0)** — author Kenney (www.kenney.nl), licence Creative Commons Zero (CC0 1.0, http://creativecommons.org/publicdomain/zero/1.0/), License.txt creation date 26-06-2024. Licence text: `food/KENNEY-FOOD-LICENSE.txt`. Files in `food/`: `cup-coffee.glb`, `mug.glb`, `glass.glb`, and since T-1158 `bowl.glb`, `apple.glb`, `banana.glb` (from `Models/GLB format/`) and the texture they reference, `Textures/colormap.png`.
