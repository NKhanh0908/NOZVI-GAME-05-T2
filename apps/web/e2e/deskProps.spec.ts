import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { join } from './helpers';
import { POSES, type Pose } from './poses';

// T-1152 (plan §3.3): every desk draws its six props from the layout, and repeated prop models
// cost one draw call per model part, not one per desk. Writes the desk-side view and a close
// view over two desks to visual-out/ for the owner.
const OUT = process.env.VISUAL_OUT ?? 'visual-out';
const DEG = Math.PI / 180;
const DESKS = Array.from({ length: 8 }, (_, i) => `ws_${i + 1}_desk`);
const TYPES = ['computer', 'decorative_object', 'desk_lamp', 'keyboard', 'mouse', 'stationery'];

type Prop = { id: string; type: string; file: string; loaded: boolean };
type Furniture = {
  loaded: number;
  failed: string[];
  models: Record<string, { placements: number; meshes: number; parts: number }>;
};
type Hook = {
  setPose(p: Pose): void;
  isLightingReady(): boolean;
  getFurniture(): Furniture | undefined;
  getDeskProps(deskId: string): Prop[];
};
type Win = { __office: Hook };

const hook = <T>(page: Page, fn: (o: Hook, arg: string) => T, arg = '') =>
  page.evaluate(
    ([f, a]) =>
      new Function('o', 'a', `return (${f})(o, a)`)((window as unknown as Win).__office, a),
    [fn.toString(), arg] as const,
  ) as Promise<T>;

test('desk props: six per desk, one draw call per model part', async ({ page }) => {
  test.setTimeout(120_000);
  await join(page);
  await page.waitForFunction(() => {
    const o = (window as unknown as Win).__office;
    return o?.isLightingReady() && o.getFurniture() !== undefined;
  });
  const furniture = (await hook(page, (o) => o.getFurniture()))!;
  expect(furniture.failed).toEqual([]);

  const files = new Set<string>();
  for (const desk of DESKS) {
    const props = await hook(page, (o, d) => o.getDeskProps(d), desk);
    expect(props.map((p) => p.type).sort(), desk).toEqual(TYPES);
    expect(
      props.every((p) => p.loaded),
      desk,
    ).toBe(true);
    for (const p of props) files.add(p.file);
  }
  for (const file of files) {
    const model = furniture.models[file];
    expect(model, file).toBeDefined();
    // At most one draw call per model part (geometry + material) for all its desks.
    expect(model!.meshes, file).toBe(model!.parts);
  }

  mkdirSync(OUT, { recursive: true });
  const side = POSES.find((p) => p.name === '06-desk-side')!.pose!;
  await hook(page, (o, p) => o.setPose(JSON.parse(p)), JSON.stringify(side));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/t1152-desk-side.png` });
  // Behind a pod looking over two desks at their props.
  const close: Pose = { x: -4.3, z: 1.2, heading: -90 * DEG, pitch: 40 * DEG };
  await hook(page, (o, p) => o.setPose(JSON.parse(p)), JSON.stringify(close));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/t1152-desk-close.png` });
});
