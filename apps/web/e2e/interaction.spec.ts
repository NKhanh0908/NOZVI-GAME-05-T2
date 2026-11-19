import { expect, test, type Page } from '@playwright/test';
import { join } from './helpers';

// T-1156 (REQ-INT-001/004/005): the faced target is highlighted and the prompt names its
// action; E opens and closes the cabinet and the fridge locally; the main door swings open
// before the exit. Open states are local presentation (dev hook `getInteraction`).

type Interaction = {
  highlighted: string | null;
  tintedMeshes: number;
  open: Record<string, boolean>;
  lifted: string[];
};
type DrawCalls = { total: number; main: number; shadow: number; triangles: number };
type Office = {
  getInteraction(): Interaction;
  getDrawCalls(): DrawCalls;
  getFurniture(): unknown;
  isLightingReady(): boolean;
  teleport(x: number, z: number, heading: number): void;
};
type Win = { __office: Office };

const interaction = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__office.getInteraction());
const drawCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__office.getDrawCalls());
const teleport = (page: Page, x: number, z: number, heading: number) =>
  page.evaluate(
    ([x, z, h]) => (window as unknown as Win).__office.teleport(x!, z!, h!),
    [x, z, heading],
  );

/** Interaction points from the layout, facing the target (north, -z). */
const CABINET = [1.32, -0.36, Math.PI] as const;
const FRIDGE = [0.96, -3.3, Math.PI] as const;
/** Facing the cabinet just outside its 2 m range (same view as `NEAR_CABINET`). */
const OUT_OF_RANGE = [1.32, 1.7, Math.PI] as const;
const NEAR_CABINET = [1.32, 1.6, Math.PI] as const;
/** Open floor with no target in range or in the facing cone. */
const AWAY = [0.96, -1, 0] as const;

async function ready(page: Page, code: string) {
  await join(page, 'Opener', code);
  await page.waitForFunction(() => {
    const o = (window as unknown as Win).__office;
    return o.isLightingReady() && o.getFurniture() !== undefined;
  });
}

test('approaching a target highlights it and the prompt names the action; leaving removes both', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await ready(page, 'HIL-01');
  const prompt = page.getByTestId('prompt');
  // Draw calls just out of range and just in range: the same view, without and with the lift.
  await teleport(page, ...OUT_OF_RANGE);
  await expect.poll(async () => (await interaction(page)).highlighted).toBeNull();
  await expect(prompt).toBeHidden();
  const rest = await drawCalls(page);
  await teleport(page, ...NEAR_CABINET);
  await expect.poll(async () => (await interaction(page)).highlighted).toBe('storage_cabinet');
  const highlighted = await drawCalls(page);
  await teleport(page, ...OUT_OF_RANGE);
  await expect.poll(async () => (await interaction(page)).highlighted).toBeNull();
  const back = await drawCalls(page);
  console.log(
    `draw calls main/shadow/total: out of range ${rest.main}/${rest.shadow}/${rest.total}, ` +
      `cabinet highlighted ${highlighted.main}/${highlighted.shadow}/${highlighted.total}, ` +
      `out of range again ${back.main}/${back.shadow}/${back.total}`,
  );
  expect(back.total).toBe(rest.total);

  await teleport(page, ...CABINET);
  await expect.poll(async () => (await interaction(page)).highlighted).toBe('storage_cabinet');
  await expect(prompt).toHaveText('E — Open cabinet');
  await expect(prompt.locator('kbd')).toHaveText('E');
  const lit = await interaction(page);
  expect(lit.tintedMeshes).toBeGreaterThan(0);
  // The cabinet is one instance of the shared bookcase parts: it is lifted while highlighted.
  expect(lit.lifted).toEqual(['storage_cabinet']);
  await page.screenshot({ path: 'test-results/interaction-highlight-cabinet.png' });

  await teleport(page, ...FRIDGE);
  await expect.poll(async () => (await interaction(page)).highlighted).toBe('fridge');
  await expect(prompt).toHaveText('E — Open fridge');

  await teleport(page, ...AWAY);
  await expect.poll(async () => (await interaction(page)).highlighted).toBeNull();
  await expect(prompt).toBeHidden();
  const after = await interaction(page);
  expect(after).toMatchObject({ tintedMeshes: 0, lifted: [] });
});

test('E opens the cabinet and the fridge, a second E closes them, walking away closes', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await ready(page, 'OPN-01');
  const prompt = page.getByTestId('prompt');
  for (const [id, at, noun] of [
    ['storage_cabinet', CABINET, 'cabinet'],
    ['fridge', FRIDGE, 'fridge'],
  ] as const) {
    await teleport(page, at[0], at[1], at[2]);
    await expect(prompt).toHaveText(`E — Open ${noun}`);
    await page.keyboard.press('e');
    await expect.poll(async () => (await interaction(page)).open[id]).toBe(true);
    await expect(prompt).toHaveText(`E — Close ${noun}`);
    // Let the swing finish before the evidence shot.
    await page.waitForTimeout(700);
    await page.screenshot({ path: `test-results/interaction-open-${id}.png` });
    const open = await drawCalls(page);
    console.log(
      `${id} open draw calls main/shadow/total: ${open.main}/${open.shadow}/${open.total}`,
    );
    await page.keyboard.press('e');
    await expect.poll(async () => (await interaction(page)).open[id]).toBe(false);
    await expect(prompt).toHaveText(`E — Open ${noun}`);
  }
  // REQ-INT-004: an open fridge closes when the player walks out of range.
  await page.keyboard.press('e');
  await expect.poll(async () => (await interaction(page)).open.fridge).toBe(true);
  await teleport(page, ...AWAY);
  await expect.poll(async () => (await interaction(page)).open.fridge).toBe(false);
  await expect.poll(async () => (await interaction(page)).lifted).toEqual([]);
});

test('the main door swings open before the exit returns to the join screen', async ({ page }) => {
  test.setTimeout(60_000);
  await ready(page, 'DOR-01');
  await teleport(page, -0.4, -3, Math.PI);
  await expect(page.getByTestId('prompt')).toHaveText('E — Leave office');
  await expect.poll(async () => (await interaction(page)).highlighted).toBe('main_door');
  await page.keyboard.press('e');
  const swung = await interaction(page);
  expect(swung.open.main_door).toBe(true);
  await expect(page.getByTestId('join')).toBeVisible();
});
