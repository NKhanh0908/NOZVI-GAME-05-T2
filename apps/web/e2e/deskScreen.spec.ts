import { expect, test, type Browser, type Page } from '@playwright/test';
import { TO_DESK, activity, atDesk, walkTo } from './helpers';

// T-1155 (REQ-INT-002, plan phase-4.1 §3.3): a working employee's monitor shows the simulated
// desktop and their desk lamp is lit on every client; it locks when they stop. Every client
// derives this from the replicated `seatId` and `activity`; no new network state.

type DeskScreen = {
  state: 'off' | 'locked' | 'desktop';
  lampLit: boolean;
  screenDrawn: boolean;
  texture: string | null;
  redraws: number;
};
type DrawCalls = { total: number; main: number; shadow: number; triangles: number };
type Office = {
  getDeskScreen(deskId: string): DeskScreen | null;
  getRemotes(): { name: string; activity: string }[];
  getDrawCalls(): DrawCalls;
  setPose(p: { x: number; z: number; heading: number; yaw?: number; pitch?: number }): void;
};

const DESK = 'ws_7_desk';

async function joinAs(browser: Browser, name: string, code: string) {
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  ).newPage();
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Office code').fill(code);
  await page.getByRole('button', { name: 'Join Office' }).click();
  await page.waitForFunction(
    () => 'getDeskScreen' in ((window as unknown as { __office?: object }).__office ?? {}),
  );
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 640, y: 360 } });
  return page;
}

const screen = (page: Page) =>
  page.evaluate(
    (id) => (window as unknown as { __office: Office }).__office.getDeskScreen(id),
    DESK,
  );
const drawCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __office: Office }).__office.getDrawCalls());

test('a working desk shows the desktop and a lit lamp on both pages, locked after', async ({
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const code = `DS-${Date.now().toString(36).slice(-6)}`;
  const ana = await joinAs(browser, 'Ana', code);
  const ben = await joinAs(browser, 'Ben', code);
  await expect.poll(async () => (await screen(ben))?.state, { timeout: 30_000 }).toBe('off');
  expect(await screen(ana)).toMatchObject({ state: 'off', lampLit: false });

  // Ana sits at ws_7 (seat 0.66, 3.72 facing +x); Ben looks at her monitor from across the desk.
  await walkTo(ana, TO_DESK);
  await atDesk(ana);
  await ana.keyboard.press('e');
  await expect.poll(() => activity(ana)).toBe('sitting');
  await ben.evaluate(() => {
    // Ben stands west of the desk aiming past its south end, so the screen is beside him.
    const [bx, bz, ax, az] = [-0.3, 3.2, 1.26, 4.5];
    const heading = Math.atan2(ax - bx, az - bz);
    (window as unknown as { __office: Office }).__office.setPose({
      x: bx,
      z: bz,
      heading,
      pitch: (20 * Math.PI) / 180,
    });
  });
  for (const page of [ana, ben]) {
    await expect.poll(async () => (await screen(page))?.state).toBe('locked');
  }
  await ben.waitForTimeout(500);
  const before = await drawCalls(ben);

  // Working: desktop and lit lamp on Ana's page (local) and Ben's page (remote).
  await ana.keyboard.press('e');
  await expect.poll(() => activity(ana)).toBe('working');
  for (const page of [ana, ben]) {
    await expect
      .poll(() => screen(page))
      .toMatchObject({ state: 'desktop', lampLit: true, screenDrawn: true });
  }
  // The shared desktop texture keeps redrawing (clock, moving lines) while shown.
  const first = (await screen(ben))!.redraws;
  await expect
    .poll(async () => (await screen(ben))!.redraws, { timeout: 10_000 })
    .toBeGreaterThan(first);
  await ben.waitForTimeout(300);
  const after = await drawCalls(ben);
  await testInfo.attach('desk-desktop', { body: await ben.screenshot(), contentType: 'image/png' });
  if (process.env.SHOTS_DIR) {
    await ben.screenshot({ path: `${process.env.SHOTS_DIR}/t1155-desktop.png` });
  }
  console.info(
    `[deskScreen] draw calls on Ben: locked ${JSON.stringify(before)} working ${JSON.stringify(after)}`,
  );

  // Stop working: both pages lock the screen and turn the lamp off.
  await ana.keyboard.press('e');
  await expect.poll(() => activity(ana)).toBe('sitting');
  for (const page of [ana, ben]) {
    await expect
      .poll(() => screen(page))
      .toMatchObject({ state: 'locked', lampLit: false, screenDrawn: true });
  }
  if (process.env.SHOTS_DIR) {
    await ben.waitForTimeout(300);
    await ben.screenshot({ path: `${process.env.SHOTS_DIR}/t1155-locked.png` });
  }
  await ana.context().close();
  await ben.context().close();
});
