import { expect, test, type Browser, type Page } from '@playwright/test';
import { TO_COFFEE, activity, atCoffee, atDesk, walkTo } from './helpers';

// T-1154 (REQ-INT-003): E at the coffee machine brews on the server; the brewer then holds a
// coffee with three sips that every page draws (hand standing, desk seated). F sips. A busy
// machine shows "Machine in use" to others; walking away cancels a brew.

type Prop = { kind: 'cup' | 'glass'; place: 'hand' | 'rest' } | null;
type Held = { item: string; sips: number; prop: Prop };
type Remote = {
  name: string;
  activity: string;
  seatId: string;
  item: string;
  sips: number;
  prop: Prop;
};
type DrawCalls = { total: number; main: number; shadow: number; triangles: number };
type Office = {
  getRemotes(): Remote[];
  getHeld(): Held;
  isSteaming(): boolean;
  getDrawCalls(): DrawCalls;
  isLightingReady(): boolean;
  getFurniture(): unknown;
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
  // Let the light probe and the furniture land before draw calls are counted (emote.spec).
  await page.waitForFunction(() => {
    const o = (window as unknown as Win).__office;
    return o.isLightingReady() && o.getFurniture() !== undefined;
  });
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 640, y: 360 } });
  return page;
}

const remote = (page: Page, name: string) =>
  page.evaluate(
    (n) => (window as unknown as Win).__office.getRemotes().find((r) => r.name === n) ?? null,
    name,
  );
const held = (page: Page) => page.evaluate(() => (window as unknown as Win).__office.getHeld());
const steaming = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__office.isSteaming());
const drawCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__office.getDrawCalls());
const prompt = (page: Page) => page.getByTestId('prompt').first();
const shots = process.env.SHOTS_DIR;

test.describe.configure({ mode: 'serial' });

let ana: Page;
let ben: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  // A fresh code per run: a previous run's employees may still hold a 20 s reservation.
  const code = `COF-${Date.now().toString(36).slice(-6)}`;
  ana = await joinAs(browser, 'Ana', code);
  ben = await joinAs(browser, 'Ben', code);
  await expect
    .poll(async () => (await remote(ben, 'Ana'))?.activity, { timeout: 30_000 })
    .toBe('idle');
  // Both stand at the coffee machine; Ben's camera sees the machine and Ana.
  await walkTo(ana, TO_COFFEE);
  await atCoffee(ana);
  await walkTo(ben, TO_COFFEE);
  await atCoffee(ben);
});

test.afterAll(async () => {
  await ana?.context().close();
  await ben?.context().close();
});

test('walking away during brewing cancels it and hands over nothing', async () => {
  test.setTimeout(150_000);
  await expect(prompt(ana)).toHaveText('E — Make coffee');
  await expect(prompt(ben)).toHaveText('E — Make coffee');
  expect(await steaming(ben)).toBe(false);

  await ana.keyboard.press('e');
  await expect.poll(() => activity(ana)).toBe('brewing');
  // Walk away at once (well inside the 4 s brew): the server cancels the brew.
  await ana.keyboard.down('s');
  await expect.poll(async () => (await remote(ben, 'Ana'))?.activity).toBe('walking');
  await ana.keyboard.up('s');
  await expect.poll(() => activity(ana)).toBe('idle');
  await expect.poll(() => steaming(ben)).toBe(false);
  // Longer than the brew would have taken: still an empty hand on both pages.
  await ana.waitForTimeout(4_500);
  expect(await held(ana)).toEqual({ item: '', sips: 0, prop: null });
  expect(await remote(ben, 'Ana')).toMatchObject({ item: '', sips: 0, prop: null });
  // The machine is free again for Ben.
  await expect(prompt(ben)).toHaveText('E — Make coffee');
});

test('page A brews (B sees Machine in use), both pages see the coffee with 3 sips, three sips clear it', async () => {
  test.setTimeout(180_000);
  await atCoffee(ana);
  await expect(prompt(ana)).toHaveText('E — Make coffee');
  await ben.waitForTimeout(500);
  const before = await drawCalls(ben);

  await ana.keyboard.press('e');
  await expect.poll(() => activity(ana)).toBe('brewing');
  // While Ana brews: Ben is refused locally from replicated state (the server sends no
  // refusal), steam shows on both pages and Ana sees the progress prompt.
  await expect(prompt(ben)).toHaveText('Machine in use');
  await ben.keyboard.press('e');
  await expect.poll(() => steaming(ben)).toBe(true);
  await expect.poll(() => steaming(ana)).toBe(true);
  await expect(prompt(ana)).toContainText('Brewing coffee…');
  await expect(ana.getByTestId('prompt-progress')).toBeVisible();
  const brewing = await drawCalls(ben);
  if (shots) await ben.screenshot({ path: `${shots}/t1154-machine-in-use.png` });

  // Done: Ana holds a coffee with three sips, drawn in the hand on both pages.
  await expect.poll(async () => (await held(ana)).item, { timeout: 15_000 }).toBe('coffee');
  await expect
    .poll(async () => {
      const r = await remote(ben, 'Ana');
      return r && { item: r.item, sips: r.sips, prop: r.prop };
    })
    .toEqual({ item: 'coffee', sips: 3, prop: { kind: 'cup', place: 'hand' } });
  await expect
    .poll(() => held(ana))
    .toEqual({ item: 'coffee', sips: 3, prop: { kind: 'cup', place: 'hand' } });
  await expect.poll(() => steaming(ben)).toBe(false);
  await expect(prompt(ana)).toHaveText('F — Sip');
  // Ben's refused E changed nothing.
  expect(await activity(ben)).toBe('idle');
  expect((await held(ben)).item).toBe('');
  await ben.waitForTimeout(500);
  const holding = await drawCalls(ben);
  if (shots) await ben.screenshot({ path: `${shots}/t1154-remote-cup.png` });
  console.info(
    `[coffee] draw calls on Ben: before ${JSON.stringify(before)} brewing ${JSON.stringify(
      brewing,
    )} holding ${JSON.stringify(holding)}`,
  );
  // Steam is one Points draw; the cup a few meshes at most.
  expect(brewing.total - before.total).toBeLessThanOrEqual(2);
  expect(holding.total - before.total).toBeLessThanOrEqual(4);

  // F sips: each sip counts when the drink ends; the last one clears the cup on both pages.
  for (const left of [2, 1, 0]) {
    await expect.poll(() => activity(ana)).toBe('idle');
    await ana.keyboard.press('f');
    await expect.poll(async () => (await held(ana)).sips, { timeout: 10_000 }).toBe(left);
    await expect.poll(async () => (await remote(ben, 'Ana'))?.sips).toBe(left);
  }
  await expect.poll(() => held(ana)).toEqual({ item: '', sips: 0, prop: null });
  await expect
    .poll(async () => {
      const r = await remote(ben, 'Ana');
      return r && { item: r.item, sips: r.sips, prop: r.prop };
    })
    .toEqual({ item: '', sips: 0, prop: null });
  await expect(prompt(ana)).toHaveText('E — Make coffee');
});

test('seated: the cup stands on the desk, a seated sip keeps the seat', async () => {
  test.setTimeout(180_000);
  await atCoffee(ana);
  await expect(prompt(ana)).toHaveText('E — Make coffee');
  await ana.keyboard.press('e');
  await expect.poll(async () => (await held(ana)).item, { timeout: 15_000 }).toBe('coffee');

  await walkTo(ana, [[0, -2.4]]);
  await atDesk(ana);
  await expect(prompt(ana)).toHaveText('E — Sit · F — Sip');
  await ana.keyboard.press('e');
  await expect.poll(() => activity(ana)).toBe('sitting');
  // Seated: the cup is on the desk on both pages (owner decision 2026-11-17).
  await expect
    .poll(async () => (await remote(ben, 'Ana'))?.prop)
    .toEqual({ kind: 'cup', place: 'rest' });
  await expect.poll(async () => (await held(ana)).prop).toEqual({ kind: 'cup', place: 'rest' });
  await expect(prompt(ana)).toHaveText('E — Start working · F — Sip · WASD — Stand up');
  if (shots) await ana.screenshot({ path: `${shots}/t1154-cup-on-desk.png` });

  // F while seated: one sip, the seat stays held and the employee is seated again after.
  await ana.keyboard.press('f');
  await expect.poll(async () => (await held(ana)).sips, { timeout: 10_000 }).toBe(2);
  await expect.poll(() => activity(ana)).toBe('sitting');
  const seated = (await remote(ben, 'Ana'))!;
  expect(seated).toMatchObject({ seatId: 'ws_7_seat', item: 'coffee', sips: 2 });
  await expect
    .poll(async () => (await remote(ben, 'Ana'))?.prop)
    .toEqual({ kind: 'cup', place: 'rest' });

  // Standing up takes the cup back into the hand.
  await ana.keyboard.down('s');
  await expect.poll(async () => (await remote(ben, 'Ana'))?.seatId).toBe('');
  await ana.keyboard.up('s');
  await expect
    .poll(async () => (await remote(ben, 'Ana'))?.prop)
    .toEqual({ kind: 'cup', place: 'hand' });
});
