export const FURNITURE: Record<string, string> = {
  desk: 'desk.glb',
  chair: 'chairDesk.glb',
  fridge: 'kitchenFridge.glb',
  countertop: 'kitchenCabinet.glb',
  water_dispenser: 'kitchenCabinet.glb',
  storage_cabinet: 'bookcaseClosedDoors.glb',
  lockers: 'bookcaseClosedDoors.glb',
  shelves: 'bookcaseOpen.glb',
  plant: 'pottedPlant.glb',
  shoe_rack: 'coatRack.glb',
  sofa: 'loungeSofaLong.glb',
  coffee_table: 'tableCoffee.glb',
  TV: 'televisionModern.glb',
  decorative_lighting: 'lampSquareFloor.glb',
  // T-1151: both doors use the Kenney doorway with door, fitted to the layout box.
  main_door: 'doorwayFront.glb',
  utility_door: 'doorwayFront.glb',
};
// The air conditioner is procedural (`roomDetails.ts`, owner decision 2026-11-17).
export const DESK_SCREEN = 'computerScreen.glb';
export const COFFEE_MACHINE = 'kitchenCoffeeMachine.glb';

// Phase 4.1 props (T-1147, owner list in DECISIONS 2026-11-17). Desk props are placed by
// `deskProps.ts` (T-1152); the rest wait for tasks 6, 10 and 14. Kenney Furniture Kit 2.0,
// served from `/assets/furniture/`.
export const FURNITURE_PROPS = {
  keyboard: 'computerKeyboard.glb',
  mouse: 'computerMouse.glb',
  lampSquareTable: 'lampSquareTable.glb',
  lampRoundTable: 'lampRoundTable.glb',
  ceilingLamp: 'lampSquareCeiling.glb',
  books: 'books.glb',
  plantSmall1: 'plantSmall1.glb',
  plantSmall2: 'plantSmall2.glb',
  plantSmall3: 'plantSmall3.glb',
  rugRectangle: 'rugRectangle.glb',
  rugRounded: 'rugRounded.glb',
  door: 'doorwayFront.glb',
  sink: 'kitchenSink.glb',
  microwave: 'kitchenMicrowave.glb',
  toaster: 'toaster.glb',
  trashcan: 'trashcan.glb',
  // Desk decoration options.
  laptop: 'laptop.glb',
  radio: 'radio.glb',
  bear: 'bear.glb',
  speakerSmall: 'speakerSmall.glb',
} as const;

// Kenney Food Kit 2.0, served from `/assets/food/`. These GLBs reference the shared texture
// `Textures/colormap.png` relative to their own folder, so they must stay in `FOOD_DIR`.
export const FOOD_DIR = 'food';
export const FOOD = {
  coffeeCup: 'cup-coffee.glb',
  mug: 'mug.glb',
  glass: 'glass.glb',
} as const;
