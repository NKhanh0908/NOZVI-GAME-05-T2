import { expect, test, type Page } from '@playwright/test';
import { TO_DESK, activity, atDesk, atSofa, join, walkTo } from './helpers';
import { POSES, type Pose } from './poses';

// Evidence capture, not a pixel-diff test: writes fixed camera poses to visual-out/ for review
// next to the reference photos in except/. Fails only on console errors (and, softly, on a
// camera above the ceiling). Override the folder with VISUAL_OUT=<dir>.
const OUT = process.env.VISUAL_OUT ?? 'visual-out';
const CEILING = 2.7;

type Hook = {
  setPose(p: Pose): void;
  getCamera(): { x: number; y: number; z: number; yaw: number; pitch: number };
  getDrawCalls(): { total: number; main: number; shadow: number; triangles: number };
};
type Win = { __office: Hook };

const setPose = (page: Page, p: Pose) =>
  page.evaluate((pose) => (window as unknown as Win).__office.setPose(pose), p);
const getCamera = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__office.getCamera());
const getDrawCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__office.getDrawCalls());

test('captures fixed visual poses', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await join(page);
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __office?: { isLightingReady?(): boolean } }
      ).__office?.isLightingReady?.() === true,
  );
  // Furniture GLBs load asynchronously; capture only after the swap finished.
  const furniture = await page.waitForFunction(() =>
    (window as unknown as { __office?: { getFurniture?(): unknown } }).__office?.getFurniture?.(),
  );
  console.log(`[visual] furniture: ${JSON.stringify(await furniture.jsonValue())}`);
  for (const { name, pose, note } of POSES) {
    if (pose) await setPose(page, pose);
    // Let the spring-damped camera settle before capturing.
    await page.waitForTimeout(1500);
    const cam = await getCamera(page);
    const calls = await getDrawCalls(page);
    console.log(
      `[visual] ${name}: ${note}; camera y=${cam.y.toFixed(2)} m; draw calls main=${calls.main} ` +
        `shadow=${calls.shadow} total=${calls.total}; triangles(all passes)=${calls.triangles}`,
    );
    expect.soft(cam.y, `${name}: camera above ceiling`).toBeLessThan(CEILING);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
  expect(errors).toEqual([]);
});

const furnished = (page: Page) =>
  page.waitForFunction(() => {
    const o = (
      window as unknown as { __office?: { isLightingReady?(): boolean; getFurniture?(): unknown } }
    ).__office;
    return o?.isLightingReady?.() === true && o.getFurniture?.() !== undefined;
  });
const setCameraYaw = (page: Page, yaw: number) =>
  page.evaluate(
    (y) =>
      (window as unknown as { __office: { setCameraYaw(y: number): void } }).__office.setCameraYaw(
        y,
      ),
    yaw,
  );
/** Pulls the orbit camera in with the mouse wheel. */
async function zoomIn(page: Page) {
  await page.mouse.move(640, 360);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -50);
    await page.waitForTimeout(50);
  }
}
/** Side view (`side` yaw) and three-quarter view from behind the seat's left (`threeQuarter`). */
async function captureSeated(page: Page, name: string, side: number, threeQuarter: number) {
  await setCameraYaw(page, side);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await setCameraYaw(page, threeQuarter);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}-3q.png` });
}

// T-1609: seated side view of ws_7 (seat faces +X, toward its desk). The desk's open knee
// space must face the chair: shins go under the desktop, not through the modesty panel.
// T-1614: the hips rest on the cushion with the back at the backrest; hands on the thighs
// while sitting, at the keyboard while working.
test('06-desk-side seated: shins under the desk', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await join(page, 'Seated', 'VIS-06');
  await furnished(page);
  await walkTo(page, TO_DESK);
  await atDesk(page);
  await page.keyboard.press('e');
  await expect.poll(() => activity(page)).toBe('sitting');
  await page.waitForTimeout(2000);
  await zoomIn(page);
  // Side: camera looking south (+Z) from the north, the desk on the left, the chair on the
  // right. Three-quarter: from behind the chair's left, as in the owner's screenshot.
  await captureSeated(page, '06-desk-side-seated', 0, 0.6);
  await page.keyboard.press('e');
  await expect.poll(() => activity(page)).toBe('working');
  await page.waitForTimeout(1500);
  await captureSeated(page, '06-desk-side-working', 0, 0.6);
  expect(errors).toEqual([]);
});

// T-1614: resting on the sofa (seat faces -X, toward the TV): hips on the cushion, back
// against the backrest, feet on the floor.
test('07-sofa-side resting: hips on the cushion', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await join(page, 'Resting', 'VIS-07');
  await furnished(page);
  await walkTo(page, [[0, -2.3]]);
  await atSofa(page);
  await page.keyboard.press('e');
  await expect.poll(() => activity(page)).toBe('resting');
  await page.waitForTimeout(2500);
  await zoomIn(page);
  // Side: looking north (-Z) from the south. Three-quarter: from behind the sofa's left.
  await captureSeated(page, '07-sofa-side-resting', Math.PI, Math.PI + 0.6);
  expect(errors).toEqual([]);
});
