import { expect, test, type Browser, type Page } from '@playwright/test';

// T-1222 (REQ-AVATAR-004): the emote menu sends an emote; every page plays it from the
// replicated `emote` field. Emote ids and allowed states come from the protocol.

type Remote = {
  name: string;
  x: number;
  z: number;
  activity: string;
  emote: string;
  model: string;
};
type DrawCalls = { total: number; main: number; shadow: number; triangles: number };
type Office = {
  getRemotes(): Remote[];
  getEmote(): string;
  getActivity(): string;
  getDrawCalls(): DrawCalls;
  setPose(p: { x: number; z: number; heading: number; yaw?: number; pitch?: number }): void;
};
type Win = { __office: Office };

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
    (n) => (window as unknown as Win).__office.getRemotes().find((r) => r.name === n),
    name,
  );
const localEmote = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__office.getEmote());
const drawCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__office.getDrawCalls());
const focused = (page: Page) => page.evaluate(() => document.activeElement?.tagName ?? '');
const shots = process.env.SHOTS_DIR;

/**
 * Records on `page`, once per rendered frame, every change of the emote drawn on the remote
 * `name`. Software WebGL can stall a page for seconds, longer than a 1.6 s wave, so the
 * test reads what was drawn instead of sampling with `evaluate`.
 */
async function traceEmotes(page: Page, name: string) {
  await page.evaluate((n) => {
    const w = window as unknown as Win & { __seen: string[] };
    w.__seen = [];
    const tick = () => {
      const e = w.__office.getRemotes().find((r) => r.name === n)?.emote ?? 'gone';
      if (w.__seen.at(-1) !== e) w.__seen.push(e);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, name);
}
const seen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
/** Waits until `page` has drawn `emote` on the traced remote since the last reset. */
async function sawEmote(page: Page, emote: string) {
  await expect.poll(() => seen(page), { timeout: 15_000 }).toContain(emote);
  await page.evaluate(() => {
    const w = window as unknown as { __seen: string[] };
    w.__seen = w.__seen.slice(-1);
  });
}

/** Puts `page`'s camera 2.7 m west of (ax, az), looking at it (the player stands behind). */
async function lookAt(page: Page, ax: number, az: number) {
  await page.evaluate(
    ([x, z]) => {
      const [cx, cz] = [x! - 2.7, z! + 0.24];
      const heading = Math.atan2(x! - cx, z! - cz);
      (window as unknown as Win).__office.setPose({
        x: cx + 4 * Math.sin(heading),
        z: cz + 4 * Math.cos(heading),
        heading,
        pitch: (12 * Math.PI) / 180,
      });
    },
    [ax, az],
  );
}

test('page A picks emotes from the menu and page B sees them on A', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  // A fresh code per run: a previous run's employees may still hold a 20 s reservation.
  const code = `EM-${Date.now().toString(36).slice(-6)}`;
  const ana = await joinAs(browser, 'Ana', code);
  const ben = await joinAs(browser, 'Ben', code);
  await expect
    .poll(async () => (await remote(ben, 'Ana'))?.model, { timeout: 30_000 })
    .toBe('avatar');
  // Ana stands at the spawn (-1.2, -3.24) facing west; Ben's camera looks at her face.
  await lookAt(ben, -1.2, -3.24);
  await ben.waitForTimeout(1000);
  const before = await drawCalls(ben);
  await traceEmotes(ben, 'Ana');

  // Mouse: the button opens the menu with every protocol emote; Escape closes it and the
  // game canvas has the keyboard again.
  const toggle = ana.getByRole('button', { name: 'Emotes' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const menu = ana.getByRole('group', { name: 'Emotes' });
  // Icons are decorative (aria-hidden); the accessible names are the labels, in protocol order.
  await expect(menu.getByRole('button')).toHaveCount(5);
  const names = ['Wave', 'Dance', 'Think', 'Laugh', 'Stretch'];
  for (const [i, name] of names.entries())
    await expect(menu.getByRole('button').nth(i)).toHaveAccessibleName(name);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('button', { name: 'Wave' })).toBeFocused();
  if (shots) await ana.screenshot({ path: `${shots}/t1222-menu-open.png` });
  await testInfo.attach('menu-open', { body: await ana.screenshot(), contentType: 'image/png' });
  await ana.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(await focused(ana)).toBe('CANVAS');
  expect(await localEmote(ana)).toBe('');

  // Keyboard: Tab from the game reaches the toggle, Enter opens, Tab + Enter picks Dance.
  await ana.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await ana.keyboard.press('Enter');
  await expect(menu.getByRole('button', { name: 'Wave' })).toBeFocused();
  await ana.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'Dance' })).toBeFocused();
  await ana.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  expect(await focused(ana)).toBe('CANVAS');
  await expect.poll(() => localEmote(ana)).toBe('dance');
  await sawEmote(ben, 'dance');
  expect((await remote(ben, 'Ana'))?.activity).toBe('idle');
  await ben.waitForTimeout(600);
  const during = await drawCalls(ben);
  if (shots) await ben.screenshot({ path: `${shots}/t1222-remote-dance.png` });
  console.info(
    `[emote] draw calls on Ben: before ${JSON.stringify(before)} during ${JSON.stringify(during)}`,
  );
  expect(during.total).toBe(before.total);
  expect(during.triangles).toBe(before.triangles);
  // The keys still drive the game after the menu: W moves Ana and ends the dance.
  await ana.keyboard.down('w');
  await expect.poll(async () => (await remote(ben, 'Ana'))?.emote).toBe('');
  await ana.keyboard.up('w');
  await expect.poll(async () => (await remote(ben, 'Ana'))?.activity).toBe('idle');
  const moved = (await remote(ben, 'Ana'))!;
  await lookAt(ben, moved.x, moved.z);

  // Every other emote, picked with the mouse, is seen on Ben's page.
  for (const [label, id] of [
    ['Think', 'think'],
    ['Laugh', 'laugh'],
    ['Stretch', 'stretch'],
  ] as const) {
    await expect.poll(async () => (await remote(ben, 'Ana'))?.activity).toBe('idle');
    await ana.waitForTimeout(1100); // BALANCE.emote.minGapSeconds
    const pick = async () => {
      await toggle.click();
      await menu.getByRole('button', { name: label }).click();
      await expect(menu).toHaveCount(0);
    };
    await pick();
    await sawEmote(ben, id);
    // Review screenshots only: a stalled page can miss the running emote, so pick it again.
    for (let attempt = 0; shots && attempt < 3; attempt++) {
      if ((await remote(ben, 'Ana'))?.emote === id) {
        await ben.screenshot({ path: `${shots}/t1222-remote-${id}.png` });
        break;
      }
      await expect.poll(async () => (await remote(ben, 'Ana'))?.emote).toBe('');
      await ana.waitForTimeout(1100);
      await pick();
      await expect.poll(async () => (await remote(ben, 'Ana'))?.emote).not.toBe('');
    }
    await expect.poll(async () => (await remote(ben, 'Ana'))?.emote, { timeout: 10_000 }).toBe('');
  }

  // G still waves: it now sends the `wave` emote, and the activity stays idle.
  await ana.waitForTimeout(1100);
  await ana.keyboard.press('g');
  await sawEmote(ben, 'wave');
  expect((await remote(ben, 'Ana'))?.activity).toBe('idle');
  await ben.waitForTimeout(300);
  if (shots) await ben.screenshot({ path: `${shots}/t1222-remote-wave.png` });
  await expect.poll(async () => (await remote(ben, 'Ana'))?.emote, { timeout: 10_000 }).toBe('');
  await ana.context().close();
  await ben.context().close();
});
