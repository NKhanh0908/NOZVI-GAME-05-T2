import { expect, test, type Browser, type Page } from '@playwright/test';
import { TO_DESK, activity, atDesk, walkTo } from './helpers';

// T-1219 (REQ-AVATAR-002): a working employee types on every client. The overlay derives
// from the replicated `activity`; no new network state.

type Remote = { name: string; activity: string; model: string; typing: number };
type DrawCalls = { total: number; main: number; shadow: number; triangles: number };
type Office = {
  getRemotes(): Remote[];
  getTyping(): number;
  getDrawCalls(): DrawCalls;
  setPose(p: { x: number; z: number; heading: number; yaw?: number; pitch?: number }): void;
};

async function joinAs(browser: Browser, name: string, code: string) {
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  ).newPage();
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Office code').fill(code);
  await page.getByRole('button', { name: 'Join Office' }).click();
  await page.waitForFunction(
    () => 'getRemotes' in ((window as unknown as { __office?: object }).__office ?? {}),
  );
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 640, y: 360 } });
  return page;
}

const remote = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      (window as unknown as { __office: Office }).__office.getRemotes().find((r) => r.name === n),
    name,
  );
const localTyping = (page: Page) =>
  page.evaluate(() => (window as unknown as { __office: Office }).__office.getTyping());
const drawCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __office: Office }).__office.getDrawCalls());

test('a working employee types on their own page and on another page', async ({
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  // A fresh code per run: a previous run's employees may still hold a 20 s reservation.
  const code = `TY-${Date.now().toString(36).slice(-6)}`;
  const ana = await joinAs(browser, 'Ana', code);
  const ben = await joinAs(browser, 'Ben', code);
  await expect
    .poll(async () => (await remote(ben, 'Ana'))?.model, { timeout: 30_000 })
    .toBe('avatar');

  // Ana sits at ws_7 (seat 0.66, 3.72 facing +x); Ben's camera looks at her across the desk.
  await walkTo(ana, TO_DESK);
  await atDesk(ana);
  await ana.keyboard.press('e');
  await expect.poll(() => activity(ana)).toBe('sitting');
  // Ben's camera (4 m behind him) sits east of the desks and looks across Ana's seat.
  await ben.evaluate(() => {
    const [cx, cz, ax, az] = [3.2, 2.4, 0.66, 3.72];
    const heading = Math.atan2(ax - cx, az - cz);
    (window as unknown as { __office: Office }).__office.setPose({
      x: cx + 4 * Math.sin(heading),
      z: cz + 4 * Math.cos(heading),
      heading,
      pitch: (20 * Math.PI) / 180,
    });
  });
  await expect.poll(async () => (await remote(ben, 'Ana'))?.activity).toBe('sitting');
  await ben.waitForTimeout(1500);
  const before = await drawCalls(ben);
  expect((await remote(ben, 'Ana'))?.typing).toBe(0);

  // Working: typing on Ana's page (local avatar) and on Ben's page (remote avatar).
  await ana.keyboard.press('e');
  await expect.poll(() => activity(ana)).toBe('working');
  await expect.poll(() => localTyping(ana)).toBe(1);
  await expect.poll(async () => (await remote(ben, 'Ana'))?.typing).toBe(1);
  await ben.waitForTimeout(300);
  const after = await drawCalls(ben);
  const shot = await ben.screenshot();
  await testInfo.attach('remote-typing', { body: shot, contentType: 'image/png' });
  if (process.env.SHOTS_DIR) {
    await ben.screenshot({ path: `${process.env.SHOTS_DIR}/t1219-remote-typing.png` });
    await ben.screenshot({
      path: `${process.env.SHOTS_DIR}/t1219-remote-typing-zoom.png`,
      clip: { x: 440, y: 300, width: 400, height: 400 },
    });
  }
  console.info(
    `[typing] draw calls on Ben: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
  );
  // The overlay only moves bones. The one new draw is the T-1155 desk lamp glow on Ana's
  // desk (ws_7 has the square lamp: a 12-triangle box shell); the screen swaps meshes.
  expect(after.total).toBe(before.total + 1);
  expect(after.triangles).toBe(before.triangles + 12);

  // Stop working: the overlay fades out on both pages.
  await ana.keyboard.press('e');
  await expect.poll(async () => (await remote(ben, 'Ana'))?.activity).toBe('sitting');
  await expect.poll(async () => (await remote(ben, 'Ana'))?.typing).toBe(0);
  await expect.poll(() => localTyping(ana)).toBe(0);
  if (process.env.SHOTS_DIR) {
    await ben.waitForTimeout(500);
    await ben.screenshot({
      path: `${process.env.SHOTS_DIR}/t1219-remote-sitting-zoom.png`,
      clip: { x: 440, y: 300, width: 400, height: 400 },
    });
  }
  await ana.context().close();
  await ben.context().close();
});
