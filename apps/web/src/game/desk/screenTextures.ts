import * as THREE from 'three';
import { BALANCE, officeLayout } from '@office/protocol';

const CFG = BALANCE.deskScreen;

/** The subset of a 2D canvas the screens draw with; tests pass a recording fake. */
export type ScreenCanvas = {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D | null;
};
export type CanvasFactory = (width: number, height: number) => ScreenCanvas;

const domCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const palette = (name: string): string => officeLayout.palette[name] ?? '#808080';

/** Wallpaper in the office palette: a base colour with two diagonal bands. */
function paintWallpaper(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const [base, band] = CFG.wallpaper;
  ctx.fillStyle = palette(base);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = palette(band);
  for (const start of [0.15, 0.55]) {
    ctx.beginPath();
    ctx.moveTo(w * start, h);
    ctx.lineTo(w * (start + 0.25), h);
    ctx.lineTo(w * (start + 0.6), 0);
    ctx.lineTo(w * (start + 0.35), 0);
    ctx.closePath();
    ctx.fill();
  }
}

/** Pseudo-random line length in [0.35, 1) for line number `n`; the same on every client. */
export function lineLength(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return 0.35 + 0.65 * (x - Math.floor(x));
}

/**
 * The simulated desktop at `now` (plan §6.3 default): wallpaper, a clock in the task bar and
 * one window whose text lines scroll by one line per redraw. Grey bars stand in for text;
 * no employee data is drawn.
 */
export function paintDesktop(ctx: CanvasRenderingContext2D, w: number, h: number, now: Date) {
  paintWallpaper(ctx, w, h);
  const bar = Math.round(h * 0.12);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, h - bar, w, bar);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(bar * 0.6)}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${hh}:${mm}`, w - bar * 0.4, h - bar / 2);
  // One application window with a title bar and scrolling text lines.
  const x = w * 0.1;
  const y = h * 0.1;
  const ww = w * 0.62;
  const wh = h * 0.68;
  ctx.fillStyle = palette(CFG.window);
  ctx.fillRect(x, y, ww, wh);
  ctx.fillStyle = palette(CFG.text);
  ctx.fillRect(x, y, ww, wh * 0.12);
  const tick = Math.floor(now.getTime() / (CFG.redrawSeconds * 1000));
  const step = (wh * 0.82) / CFG.lines;
  ctx.globalAlpha = 0.55;
  for (let k = 0; k < CFG.lines; k++) {
    const len = lineLength(tick + k) * (ww - 16);
    ctx.fillRect(x + 8, y + wh * 0.16 + k * step, len, step * 0.45);
  }
  ctx.globalAlpha = 1;
}

/** Lock screen: the wallpaper dimmed, with a padlock. Static, drawn once. */
export function paintLocked(ctx: CanvasRenderingContext2D, w: number, h: number) {
  paintWallpaper(ctx, w, h);
  ctx.fillStyle = `rgba(0,0,0,${CFG.lockDim})`;
  ctx.fillRect(0, 0, w, h);
  const s = h * 0.2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(w / 2 - s / 2, h / 2 - s * 0.1, s, s * 0.8);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = s * 0.14;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2 - s * 0.1, s * 0.3, Math.PI, 0);
  ctx.stroke();
}

/**
 * REQ-INT-002 (T-1155): the two shared screen textures. Every desk showing the desktop uses
 * the same `desktop` texture and every locked desk the same `locked` one, so N desks cost no
 * extra canvases or uploads. The desktop is redrawn at most once per
 * `BALANCE.deskScreen.redrawSeconds`, and only while some desk shows it.
 */
export class ScreenTextures {
  readonly desktop: THREE.CanvasTexture;
  readonly locked: THREE.CanvasTexture;
  /** How many times the desktop canvas was painted (dev hook, tests). */
  redraws = 0;
  private lastDraw = -Infinity;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly w: number;
  private readonly h: number;

  constructor(createCanvas: CanvasFactory = domCanvas) {
    [this.w, this.h] = CFG.canvas;
    const desktop = createCanvas(this.w, this.h);
    const locked = createCanvas(this.w, this.h);
    this.ctx = desktop.getContext('2d');
    const lockedCtx = locked.getContext('2d');
    if (lockedCtx) paintLocked(lockedCtx, this.w, this.h);
    this.desktop = new THREE.CanvasTexture(desktop as unknown as HTMLCanvasElement);
    this.locked = new THREE.CanvasTexture(locked as unknown as HTMLCanvasElement);
    for (const t of [this.desktop, this.locked]) t.colorSpace = THREE.SRGBColorSpace;
  }

  /** Repaints the desktop when it is shown and the last paint is `redrawSeconds` old. */
  update(nowMs: number, desktopShown: boolean): boolean {
    if (!desktopShown || nowMs - this.lastDraw < CFG.redrawSeconds * 1000) return false;
    this.lastDraw = nowMs;
    if (this.ctx) paintDesktop(this.ctx, this.w, this.h, new Date(nowMs));
    this.desktop.needsUpdate = true;
    this.redraws++;
    return true;
  }

  dispose(): void {
    this.desktop.dispose();
    this.locked.dispose();
  }
}
