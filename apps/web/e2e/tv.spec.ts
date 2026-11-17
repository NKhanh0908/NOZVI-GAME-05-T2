import { expect, test, type Page } from '@playwright/test';
import { join, player, walkTo } from './helpers';

type Tv = {
  position: [number, number, number];
  width: number;
  height: number;
  rotY: number;
  inView: boolean;
  layerSize: { width: number; height: number };
  screenRect: { x: number; y: number; width: number; height: number };
  pointerEvents: string;
  mounted: boolean;
};
type Office = {
  getTv(): Tv;
  getCameraYaw(): number;
  setPose(p: { x: number; z: number; heading: number; pitch?: number }): void;
};
const getTv = (page: Page) =>
  page.evaluate(() => (window as unknown as { __office: Office }).__office.getTv());
const getYaw = (page: Page) =>
  page.evaluate(() => (window as unknown as { __office: Office }).__office.getCameraYaw());

const DEG = Math.PI / 180;

// REQ-TV-001 (T-1139): the TV screen layer, before any player is loaded.
test('the TV screen sits on the entertainment wall and the CSS3D layer follows the canvas', async ({
  page,
}) => {
  await join(page, 'TvViewer', 'TV-E2E-01');
  // Stand in the entertainment corner and face west toward the TV wall.
  await page.evaluate(
    (pose) => (window as unknown as { __office: Office }).__office.setPose(pose),
    { x: -1.2, z: -1.62, heading: -90 * DEG, pitch: 10 * DEG },
  );
  await expect.poll(async () => (await getTv(page)).inView).toBe(true);
  const tv = await getTv(page);
  expect(tv.mounted).toBe(true);
  expect(tv.rotY).toBe(90);
  expect(tv.position[0]).toBeGreaterThan(-5.83);
  expect(tv.position[0]).toBeLessThan(-5.7);
  expect(tv.position[2]).toBeCloseTo(-1.62, 5);
  expect(tv.width).toBeCloseTo(1.4, 5);
  expect(tv.height).toBeCloseTo(0.8, 5);
  expect(tv.pointerEvents).toBe('none');
  expect(tv.layerSize).toEqual({ width: 1280, height: 720 });
  // The projected screen is a sensible on-screen rectangle.
  expect(tv.screenRect.width).toBeGreaterThan(100);
  expect(tv.screenRect.x).toBeGreaterThan(0);
  expect(tv.screenRect.x + tv.screenRect.width).toBeLessThan(1280);

  // Resizing the window resizes the CSS3D layer with the WebGL canvas.
  await page.setViewportSize({ width: 1000, height: 600 });
  await expect
    .poll(async () => (await getTv(page)).layerSize)
    .toEqual({ width: 1000, height: 600 });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(async () => (await getTv(page)).layerSize)
    .toEqual({ width: 1280, height: 720 });

  // Dragging across the screen still orbits the camera (clicks are not taken by the TV).
  const r = (await getTv(page)).screenRect;
  const yaw0 = await getYaw(page);
  if (process.env.TV_SHOT)
    await page.screenshot({ path: process.env.TV_SHOT.replace('.png', '-before.png') });
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 200, r.y + r.height / 2, { steps: 8 });
  await page.mouse.up();
  if (process.env.TV_SHOT) await page.screenshot({ path: process.env.TV_SHOT });
  await expect.poll(async () => Math.abs((await getYaw(page)) - yaw0)).toBeGreaterThan(0.2);
});

type PlayerView = {
  kind: string;
  time: number;
  muted: boolean;
  state: { videoId: string | null; playing: boolean };
};
type PlayerHook = {
  getTvPlayer(): {
    kind: string;
    load(id: string, t: number): void;
    play(): void;
    pause(): void;
    getTime(): number;
    isMuted(): boolean;
    state: { videoId: string | null; playing: boolean };
  };
};
const playerView = (page: Page) =>
  page.evaluate((): PlayerView => {
    const p = (window as unknown as { __office: PlayerHook }).__office.getTvPlayer();
    return { kind: p.kind, time: p.getTime(), muted: p.isMuted(), state: p.state };
  });
const drive = (page: Page, action: 'play' | 'pause' | ['load', string, number]) =>
  page.evaluate((a) => {
    const p = (window as unknown as { __office: PlayerHook }).__office.getTvPlayer();
    if (a === 'play') p.play();
    else if (a === 'pause') p.pause();
    else p.load(a[1], a[2]);
  }, action);

// T-1140: e2e builds use the fake TV player and never contact YouTube.
test('the TV uses the fake player in e2e and makes no request to YouTube', async ({ page }) => {
  const youtube: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (/(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)$/.test(host))
      youtube.push(r.url());
  });
  await join(page, 'TvPlayer', 'TV-E2E-02');
  const before = await playerView(page);
  expect(before.kind).toBe('fake');
  expect(before.muted).toBe(true);
  expect(before.state.videoId).toBeNull();

  await drive(page, ['load', 'AAAAAAAAAAA', 5]);
  await drive(page, 'play');
  await expect.poll(async () => (await playerView(page)).time).toBeGreaterThan(5.3);
  await drive(page, 'pause');
  const paused = (await playerView(page)).time;
  await page.waitForTimeout(300);
  expect((await playerView(page)).time).toBe(paused);
  await expect(page.getByTestId('tv-fake-player')).toHaveText(/AAAAAAAAAAA/);

  expect(youtube).toEqual([]);
});

// T-1142 (REQ-TV-002, REQ-TV-003): TV mode panel, Close, Esc and focus recovery.
type TvModeHook = {
  isTvMode(): boolean;
  getTvView(): { videoId: string | null; status: string; time: number; muted: boolean };
  getTv(): Tv & { canvasPointerEvents: string };
};
const tvMode = (page: Page) =>
  page.evaluate(() => (window as unknown as { __office: TvModeHook }).__office.isTvMode());
const tvView = (page: Page) =>
  page.evaluate(() => (window as unknown as { __office: TvModeHook }).__office.getTvView());
const tvLayer = (page: Page) =>
  page.evaluate(() => (window as unknown as { __office: TvModeHook }).__office.getTv());

/** Walks (keys, through the server) from spawn round the sofa to face the TV. */
async function walkToTv(page: Page) {
  await walkTo(page, [
    [-1.2, -0.3],
    [-4.0, -0.3],
  ]);
  await walkTo(page, [[-5.0, -0.9]], 0.3);
  await expect(page.getByTestId('prompt')).toHaveText('E — Watch TV');
  // The prompt is painted above the game canvas, not just present in the DOM.
  const box = (await page.getByTestId('prompt').boundingBox())!;
  const onTop = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('[data-testid="prompt"]'),
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(onTop).toBe(true);
}

async function openTv(page: Page) {
  await page.keyboard.press('e');
  await expect(page.getByTestId('tv-panel')).toBeVisible();
  await expect.poll(() => tvMode(page)).toBe(true);
}

/** Holds W until the player has moved; returns the distance covered. */
async function moveWithW(page: Page) {
  const start = await player(page);
  await page.keyboard.down('w');
  try {
    await expect
      .poll(async () => {
        const p = await player(page);
        return Math.hypot(p.x - start.x, p.z - start.z);
      })
      .toBeGreaterThan(0.2);
  } finally {
    await page.keyboard.up('w');
  }
}

test('E at the TV opens the panel with the catalog, URL field and all controls', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await join(page, 'TvPanel', 'TV-E2E-03');
  await walkToTv(page);
  await openTv(page);
  const panel = page.getByTestId('tv-panel');
  // The interaction prompt is hidden while the panel is open.
  await expect(page.getByTestId('prompt')).toHaveCount(0);

  // Catalog (the fake provider in e2e: no ytimg.com thumbnails), URL field and controls.
  const catalog = panel.getByRole('list', { name: 'Catalog' });
  await expect(catalog.getByRole('button')).toHaveText(['Alpha clip', 'Bravo clip', 'Café clip']);
  await expect(panel.getByLabel('YouTube link')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Play link' })).toBeVisible();
  for (const name of ['Play', 'Pause', 'Stop', 'Close', 'Click to unmute'])
    await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(panel.getByRole('slider', { name: 'Seek' })).toBeVisible();
  await expect(panel.getByTestId('tv-now')).toHaveText('Nothing playing');

  // The controls drive the local player (P4.8; nothing is sent to the room yet).
  await catalog.getByRole('button', { name: 'Alpha clip' }).click();
  await expect.poll(async () => (await tvView(page)).status).toBe('playing');
  expect((await tvView(page)).videoId).toBe('AAAAAAAAAAA');
  await expect(page.getByTestId('tv-fake-player')).toHaveText(/AAAAAAAAAAA ▶/);
  await expect(panel.getByTestId('tv-now')).toHaveText('Playing: Alpha clip');
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await tvView(page)).status).toBe('paused');
  await panel.getByRole('slider', { name: 'Seek' }).fill('42');
  await expect.poll(async () => (await tvView(page)).time).toBe(42);
  await expect(panel.getByTestId('tv-time')).toHaveText('0:42 / 2:00');
  await panel.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await tvView(page)).time).toBeGreaterThan(42.2);
  // Evidence screenshot of the open panel (all controls visible).
  if (process.env.TV_PANEL_SHOT) await page.screenshot({ path: process.env.TV_PANEL_SHOT });
  // Muted start (plan §6.5) until the user clicks.
  expect((await tvView(page)).muted).toBe(true);
  await panel.getByRole('button', { name: 'Click to unmute' }).click();
  await expect.poll(async () => (await tvView(page)).muted).toBe(false);
  await expect(panel.getByRole('button', { name: 'Click to unmute' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(async () => (await tvView(page)).status).toBe('idle');
  await expect(panel.getByTestId('tv-now')).toHaveText('Nothing playing');
});

test('after clicking the screen, Close leaves TV mode and gives the keyboard back', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await join(page, 'TvClose', 'TV-E2E-04');
  await walkToTv(page);
  expect((await tvLayer(page)).pointerEvents).toBe('none');
  await openTv(page);
  const inMode = await tvLayer(page);
  expect(inMode.pointerEvents).toBe('auto');
  expect(inMode.canvasPointerEvents).toBe('none');

  // Stand-in for the YouTube iframe (the fake player has none): it takes focus on click.
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.dataset.testid = 'tv-test-iframe';
    frame.srcdoc = '<body style="margin:0;background:#123"></body>';
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0';
    const screen = document.querySelector<HTMLElement>('[data-testid="tv-screen"]')!;
    screen.style.position = 'relative';
    screen.appendChild(frame);
  });
  const r = inMode.screenRect;
  // Click the part of the screen right of the panel.
  const x = Math.max(r.x + r.width / 2, 340);
  expect(x).toBeLessThan(r.x + r.width - 5);
  await page.mouse.click(x, r.y + r.height / 2);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
  // Keys now go to the iframe, so Esc cannot reach the app: the on-screen Close is the way out.
  await page.keyboard.press('Escape');
  expect(await tvMode(page)).toBe(true);

  await page.getByTestId('tv-panel').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('tv-panel')).toHaveCount(0);
  expect(await tvMode(page)).toBe(false);
  const closed = await tvLayer(page);
  expect(closed.pointerEvents).toBe('none');
  expect(closed.canvasPointerEvents).toBe('auto');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('CANVAS');
  await moveWithW(page);

  // Camera orbit works again: a drag across the screen turns the camera.
  const after = await tvLayer(page);
  const yaw0 = await getYaw(page);
  const cx = after.screenRect.x + after.screenRect.width / 2;
  const cy = after.screenRect.y + after.screenRect.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await getYaw(page)) - yaw0)).toBeGreaterThan(0.2);
});

test('Esc closes the panel, and an invalid pasted URL shows a message', async ({ page }) => {
  test.setTimeout(90_000);
  await join(page, 'TvEsc', 'TV-E2E-05');
  await walkToTv(page);
  await openTv(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tv-panel')).toHaveCount(0);
  expect(await tvMode(page)).toBe(false);
  expect((await tvLayer(page)).pointerEvents).toBe('none');
  await expect(page.getByTestId('prompt')).toHaveText('E — Watch TV');

  await openTv(page);
  const panel = page.getByTestId('tv-panel');
  const field = panel.getByLabel('YouTube link');
  const before = await player(page);
  // Typing in the field does not walk the player.
  await field.fill('https://vimeo.com/76979871');
  await field.press('Enter');
  await expect(panel.getByRole('alert')).toHaveText('Not a YouTube link or video id.');
  expect((await tvView(page)).videoId).toBeNull();
  // Holding W in the field would walk ~1 m outside TV mode; late server corrections
  // after the walk can still shift the player by a few centimetres.
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  const still = await player(page);
  expect(Math.hypot(still.x - before.x, still.z - before.z)).toBeLessThan(0.1);

  // A valid link (not in the catalog) is accepted and the message goes away.
  await field.fill('https://youtu.be/BBBBBBBBBBB?t=3');
  await panel.getByRole('button', { name: 'Play link' }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await tvView(page)).videoId).toBe('BBBBBBBBBBB');

  // Esc from inside the URL field still closes (the app has focus).
  await field.focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('CANVAS');
  await moveWithW(page);
});
