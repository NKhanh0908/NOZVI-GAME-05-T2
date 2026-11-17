import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { E2E_WIRE } from './bots';
import { join } from './helpers';

/**
 * REQ-TV-006 drift soak (Phase 4 task 11, plan §5). Skipped unless NET_PROFILE=test, which
 * the game server started by Playwright inherits (REQ-NET-004 delayed-patch profile):
 *
 *   NET_PROFILE=test pnpm --filter @office/web e2e e2e/tvSoak.spec.ts --trace off
 *
 * Three pages with the fake player watch one video in one office for `TV_SOAK_MINUTES`
 * (default: the balance run length). Every two minutes the pages take turns to pause, seek
 * and play again. Twice a second the test reads every page's player time and its replicated
 * `tv` state; the browser and the server share this machine's clock, so each page's error is
 * measured against the server timeline (`currentTime` at `updatedAt`, advancing while
 * playing). Inter-client drift is the spread of those errors in one tick. Ticks within the
 * convergence time of a command, or while the pages disagree on the state, are skipped.
 */
const minutes = Number(process.env.TV_SOAK_MINUTES ?? E2E_WIRE.netProfileMinutes);
const CODE = 'TV-SOAK-E2E';
const TICK_MS = 500;
const CYCLE_MS = 120_000;
const DEG = Math.PI / 180;

test.skip(process.env.NET_PROFILE !== 'test', 'manual soak: set NET_PROFILE=test');

type Sample = {
  now: number;
  time: number;
  playing: boolean;
  playerVideo: string | null;
  videoId: string | null;
  status: string;
  currentTime: number;
  updatedAt: number;
};
type Hook = {
  openTvMode(): void;
  setPose(p: { x: number; z: number; heading: number; pitch?: number }): void;
  getDrawCalls(): { total: number; main: number; shadow: number; triangles: number };
  getTvSync(): { videoId: string | null; status: string; currentTime: number; updatedAt: number };
  getTvPlayer(): { getTime(): number; state: { videoId: string | null; playing: boolean } };
};

const sample = (page: Page) =>
  page.evaluate((): Sample => {
    const o = (window as unknown as { __office: Hook }).__office;
    const s = o.getTvSync();
    const p = o.getTvPlayer();
    return {
      now: Date.now(),
      time: p.getTime(),
      playing: p.state.playing,
      playerVideo: p.state.videoId,
      videoId: s.videoId,
      status: s.status,
      currentTime: s.currentTime,
      updatedAt: s.updatedAt,
    };
  });

/** Where the server says the video is at local time `now` (same machine clock). */
const serverPosition = (s: Sample) =>
  s.status === 'playing' ? s.currentTime + (s.now - s.updatedAt) / 1000 : s.currentTime;

const drawCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __office: Hook }).__office.getDrawCalls());

async function joinPage(browser: Browser, name: string) {
  const page = await (await browser.newContext()).newPage();
  await join(page, name, CODE);
  return page;
}

async function openPanel(page: Page) {
  await page.evaluate(() => (window as unknown as { __office: Hook }).__office.openTvMode());
  const panel = page.getByTestId('tv-panel');
  await expect(panel).toBeVisible();
  return panel;
}

const pct = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
const round = (n: number) => Number(n.toFixed(3));

test('three clients stay within the drift target under the delayed-patch profile', async ({
  browser,
}) => {
  test.setTimeout(minutes * 60_000 + 240_000);
  const pages = [
    await joinPage(browser, 'SoakA'),
    await joinPage(browser, 'SoakB'),
    await joinPage(browser, 'SoakC'),
  ];
  const [a] = pages as [Page, Page, Page];
  try {
    // Draw calls with the TV idle and closed, facing the TV (SwiftShader: not representative).
    await a.evaluate((pose) => (window as unknown as { __office: Hook }).__office.setPose(pose), {
      x: -1.2,
      z: -1.62,
      heading: -90 * DEG,
      pitch: 10 * DEG,
    });
    await a.waitForTimeout(500);
    const drawClosed = await drawCalls(a);

    const panels: Locator[] = [];
    for (const page of pages) panels.push(await openPanel(page));
    await panels[0]!
      .getByRole('list', { name: 'Catalog' })
      .getByRole('button', { name: 'Alpha clip' })
      .click();
    let lastCommandAt = Date.now();
    for (const page of pages) {
      await expect
        .poll(async () => {
          const s = await sample(page);
          return [s.videoId, s.status, s.playerVideo, s.playing];
        })
        .toEqual(['AAAAAAAAAAA', 'playing', 'AAAAAAAAAAA', true]);
    }
    const drawOpen = await drawCalls(a);

    // Commands, as offsets into each two-minute cycle, from a different page each time.
    const script: { at: number; run: (i: number) => Promise<void>; name: string }[] = [
      {
        at: 60_000,
        name: 'pause',
        run: (i) => panels[i]!.getByRole('button', { name: 'Pause', exact: true }).click(),
      },
      {
        at: 70_000,
        name: 'seek',
        run: (i) =>
          panels[i]!.getByRole('slider', { name: 'Seek' }).fill(String(10 + ((i * 37) % 100))),
      },
      {
        at: 80_000,
        name: 'play',
        run: (i) => panels[i]!.getByRole('button', { name: 'Play', exact: true }).click(),
      },
    ];
    const commands: string[] = [];

    const convergenceMs = E2E_WIRE.tvConvergenceSeconds * 1000;
    const spreads: number[] = [];
    let maxAbsError = 0;
    let ticks = 0;
    let skipped = 0;
    let worst: { at: number; errors: number[] } | null = null;
    const start = Date.now();
    const end = start + minutes * 60_000;
    let next = 0;
    // The first settled state after each command is appended to its log line.
    let logged = true;
    while (Date.now() < end) {
      const step = script[next % script.length]!;
      const due = start + Math.floor(next / script.length) * CYCLE_MS + step.at;
      if (Date.now() >= due && due < end - convergenceMs) {
        const who = next % pages.length;
        await step.run(who);
        lastCommandAt = Date.now();
        commands.push(`${Math.round((lastCommandAt - start) / 1000)}s ${step.name} by ${who}`);
        next++;
        logged = false;
      }

      const t0 = Date.now();
      const samples = await Promise.all(pages.map(sample));
      ticks++;
      const s0 = samples[0]!;
      const agree = samples.every(
        (s) =>
          s.updatedAt === s0.updatedAt &&
          s.status === s0.status &&
          s.videoId === s0.videoId &&
          s.playerVideo === s0.videoId,
      );
      const oldest = Math.min(...samples.map((s) => s.now));
      const settled =
        oldest - s0.updatedAt >= convergenceMs && oldest - lastCommandAt >= convergenceMs;
      if (!agree || !settled || s0.status === 'idle') {
        skipped++;
      } else {
        if (!logged) {
          commands[commands.length - 1] += ` -> ${s0.status} at ${s0.currentTime.toFixed(2)}`;
          logged = true;
        }
        const errors = samples.map((s) => s.time - serverPosition(s));
        const spread = Math.max(...errors) - Math.min(...errors);
        spreads.push(spread);
        maxAbsError = Math.max(maxAbsError, ...errors.map(Math.abs));
        if (!worst || spread > Math.max(...worst.errors) - Math.min(...worst.errors))
          worst = { at: Math.round((t0 - start) / 1000), errors: errors.map(round) };
      }
      await a.waitForTimeout(Math.max(0, TICK_MS - (Date.now() - t0)));
    }

    const sorted = [...spreads].sort((x, y) => x - y);
    const report = {
      minutes,
      clients: pages.length,
      ticks,
      samples: spreads.length,
      skipped,
      driftSeconds: {
        max: round(sorted.at(-1) ?? NaN),
        p95: round(pct(sorted, 0.95)),
        p50: round(pct(sorted, 0.5)),
      },
      maxAbsErrorVsServerSeconds: round(maxAbsError),
      worst,
      target: E2E_WIRE.tvDriftTargetSeconds,
      commands,
      drawCalls: { tvClosedIdle: drawClosed, tvOpenPlaying: drawOpen },
    };
    const note = JSON.stringify(report);
    test.info().annotations.push({ type: 'tv-soak', description: note });
    console.log(`tv drift soak: ${note}`);
    expect(spreads.length).toBeGreaterThan(0);
    expect(sorted.at(-1)!).toBeLessThan(E2E_WIRE.tvDriftTargetSeconds);
  } finally {
    await Promise.all(pages.map((p) => p.context().close()));
  }
});
