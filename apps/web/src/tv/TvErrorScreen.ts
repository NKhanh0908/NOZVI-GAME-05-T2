import { VIDEO_ERROR_TITLE, type TvVideoError } from './videoError';

/**
 * REQ-TV-009: the per-video error card on the TV screen itself. It sits over the player
 * inside the CSS3D screen container (which keeps `pointer-events: none`), so everyone near
 * the TV sees why the screen is dark; the panel offers the choice of another video.
 */
export class TvErrorScreen {
  readonly element: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly detail: HTMLDivElement;

  constructor(container: HTMLElement) {
    const doc = container.ownerDocument;
    this.element = doc.createElement('div');
    this.element.dataset.testid = 'tv-screen-error';
    this.element.setAttribute('role', 'status');
    this.element.style.cssText =
      'position:absolute;inset:0;z-index:1;display:none;flex-direction:column;gap:40px;' +
      'align-items:center;justify-content:center;text-align:center;padding:48px;' +
      'box-sizing:border-box;background:#101114;color:#eee;font:700 110px system-ui;' +
      'pointer-events:none';
    this.title = doc.createElement('div');
    this.title.textContent = VIDEO_ERROR_TITLE;
    this.detail = doc.createElement('div');
    this.detail.style.cssText = 'font:400 64px system-ui;color:#c4c8d4';
    this.element.append(this.title, this.detail);
    container.appendChild(this.element);
  }

  show(error: TvVideoError | null): void {
    this.detail.textContent = error ? `${error.detail} Choose another video.` : '';
    this.element.style.display = error ? 'flex' : 'none';
  }

  dispose(): void {
    this.element.remove();
  }
}
