import raw from './office-decor.json';
import type { Vec3 } from './layout';

/** T-1158: one decorative model; `model` is relative to the web app's `/assets/`. */
export type DecorItem = {
  id: string;
  model: string;
  position: Vec3;
  size: Vec3;
  rotY: number;
  /** Layout item whose palette box this decor replaces (the pantry counter). */
  replaces?: string;
};
export type WallClock = { id: string; position: Vec3; radius: number; depth: number; wall: string };
export type OfficeDecor = { items: DecorItem[]; clock: WallClock };

/** Decoration only: no colliders, no interactables (plan §3.2, T-1158). */
export const officeDecor: OfficeDecor = {
  items: raw.items.map((i) => ({
    ...i,
    position: i.position as Vec3,
    size: i.size as Vec3,
  })),
  clock: { ...raw.clock, position: raw.clock.position as Vec3 },
};
