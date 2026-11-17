import { expect, test, type Page } from '@playwright/test';
import { join } from './helpers';

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
