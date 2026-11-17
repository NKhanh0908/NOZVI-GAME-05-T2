import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { joinBot, leaveAll, type BotRoom } from './bots';
import { join } from './helpers';
import { POSES, type Pose } from './poses';

// Phase 4.1 render baseline (T-1146, docs/plans/phase-4.1.md §3.1): draw calls (main +
// shadow) and triangles for the seven visual-spec views with 1, 3 and 10 employees (the
// browser plus idle headless bots standing at the spawn). Evidence only, skipped unless
// RENDER_BASELINE=1; every later Phase 4.1 task re-runs it for before / after numbers:
//   RENDER_BASELINE=1 pnpm --filter @office/web e2e renderBaseline
// RENDER_BASELINE_COUNTS=1,3,10 picks the employee counts. Numbers come from headless
// SwiftShader software WebGL in Playwright: call and triangle counts match real hardware for
// the same scene and view, but the FPS column does not (the owner measures real FPS).
const ENABLED = process.env.RENDER_BASELINE === '1';
const COUNTS = (process.env.RENDER_BASELINE_COUNTS ?? '1,3,10')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isInteger(n) && n >= 1 && n <= 10);
const OUT = process.env.VISUAL_OUT ?? 'visual-out';

type Calls = { total: number; main: number; shadow: number; triangles: number };
type Hook = {
  setPose(p: Pose): void;
  getDrawCalls(): Calls;
  getRenderQuality(): string;
  isLightingReady(): boolean;
  getFurniture(): { loaded: number; failed: string[] } | undefined;
  getRemotes(): { model: string }[];
};
type Win = { __office: Hook };

const setPose = (page: Page, p: Pose) =>
  page.evaluate((pose) => (window as unknown as Win).__office.setPose(pose), p);
const drawCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__office.getDrawCalls());

/** Frames rendered per second over `ms`, measured in the page (software WebGL here). */
const fps = (page: Page, ms: number) =>
  page.evaluate(
    (window) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - start < window) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (performance.now() - start));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

type Row = { employees: number; view: string } & Calls;

const bots: BotRoom[] = [];
test.afterEach(() => leaveAll(bots));

test('records the render baseline per view and employee count', async ({ page, browser }) => {
  test.skip(!ENABLED, 'evidence run: set RENDER_BASELINE=1');
  test.setTimeout(60_000 + COUNTS.length * 90_000);
  const rows: Row[] = [];
  const rates: { employees: number; fps: number }[] = [];
  let quality = '';
  for (const employees of COUNTS) {
    const code = `BASE-${employees}`;
    for (let i = 1; i < employees; i++) bots.push(await joinBot(code, `Bot${i}`));
    // A fresh page per count, so 01-spawn is the real view right after joining.
    const p = employees === COUNTS[0] ? page : await (await browser.newContext()).newPage();
    await join(p, 'Observer', code);
    await p.waitForFunction(() => {
      const o = (window as unknown as Win).__office;
      return o.isLightingReady() && o.getFurniture() !== undefined;
    });
    await expect
      .poll(
        () =>
          p.evaluate(() =>
            (window as unknown as Win).__office.getRemotes().filter((r) => r.model === 'avatar'),
          ),
        { timeout: 60_000 },
      )
      .toHaveLength(employees - 1);
    quality = await p.evaluate(() => (window as unknown as Win).__office.getRenderQuality());
    for (const { name, pose } of POSES) {
      if (pose) await setPose(p, pose);
      // Let the spring-damped camera settle, as visual.spec does.
      await p.waitForTimeout(1500);
      if (name === '01-spawn') rates.push({ employees, fps: await fps(p, 3_000) });
      rows.push({ employees, view: name, ...(await drawCalls(p)) });
    }
    if (p !== page) await p.context().close();
    await leaveAll(bots);
  }
  const lines = rows.map(
    (r) => `| ${r.employees} | ${r.view} | ${r.main} | ${r.shadow} | ${r.total} | ${r.triangles} |`,
  );
  const fpsLine = rates.map((r) => `${r.employees}: ${r.fps.toFixed(1)}`).join(', ');
  const report =
    `[baseline] render quality ${quality}; SwiftShader software WebGL, 1280x720\n` +
    `| Employees | View | Main | Shadow | Total | Triangles |\n` +
    lines.join('\n') +
    `\n[baseline] spawn-view FPS (SwiftShader, not representative): ${fpsLine}`;
  console.log(report);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    `${OUT}/render-baseline.json`,
    JSON.stringify({ quality, renderer: 'SwiftShader', rows, fps: rates }, null, 2),
  );
  expect(rows).toHaveLength(COUNTS.length * POSES.length);
});
