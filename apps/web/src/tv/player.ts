/**
 * REQ-TV-001, REQ-TV-003: the TV video player behind an interface, so the room binding
 * (P4.9) and the drift sync (`sync.ts`) never touch the YouTube IFrame API directly and
 * unit / e2e tests run with {@link FakeTvPlayer}.
 *
 * Times are seconds of video time. `onError` receives the IFrame API error code
 * (2, 5, 100, 101, 150); `onEnded` fires when the video reaches its end.
 */
export interface TvPlayer {
  /** Which implementation this is (dev hook and e2e use it). */
  readonly kind: 'youtube' | 'fake';
  /** Cues `videoId` at `startAt` without starting playback. */
  load(videoId: string, startAt: number): void;
  play(): void;
  pause(): void;
  seek(time: number): void;
  /** Stops playback and unloads the video (the TV returns to idle). */
  stop(): void;
  /** Playback rate; 1 is normal speed, the drift sync nudges around it. */
  setRate(rate: number): void;
  getTime(): number;
  /** Video length in seconds, or null while unknown (nothing loaded, metadata pending). */
  getDuration(): number | null;
  mute(): void;
  unmute(): void;
  isMuted(): boolean;
  /** Registers an error listener; returns a function that removes it. */
  onError(listener: (code: number) => void): () => void;
  /** Registers an end-of-video listener; returns a function that removes it. */
  onEnded(listener: () => void): () => void;
  dispose(): void;
}

/** Small listener set shared by both players. */
export class Listeners<A extends unknown[]> {
  private readonly set = new Set<(...args: A) => void>();
  add(listener: (...args: A) => void): () => void {
    this.set.add(listener);
    return () => this.set.delete(listener);
  }
  emit(...args: A): void {
    for (const l of [...this.set]) l(...args);
  }
  clear(): void {
    this.set.clear();
  }
}

export type FakeTvPlayerState = {
  videoId: string | null;
  playing: boolean;
  rate: number;
  muted: boolean;
  disposed: boolean;
};

/**
 * Test double with a controllable clock (`now` in milliseconds, default
 * `performance.now`). Video time advances only while playing, at the current rate.
 * Tests drive errors and the end of a video with {@link emitError} and {@link emitEnded}.
 */
export class FakeTvPlayer implements TvPlayer {
  readonly kind = 'fake' as const;
  private videoId: string | null = null;
  private playing = false;
  private rate = 1;
  private muted = true; // plan §6.5: start muted until a user gesture
  private disposed = false;
  /** Video time at `baseNow` (s) and the clock reading it was taken at (ms). */
  private baseTime = 0;
  private baseNow: number;
  private readonly errors = new Listeners<[number]>();
  private readonly ended = new Listeners<[]>();
  private readonly label: HTMLElement | null;

  constructor(
    container: HTMLElement | null = null,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.baseNow = now();
    if (container) {
      const doc = container.ownerDocument;
      this.label = doc.createElement('div');
      this.label.dataset.testid = 'tv-fake-player';
      this.label.style.cssText =
        'width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
        'color:#9aa;font:24px sans-serif;pointer-events:none';
      container.appendChild(this.label);
      this.render();
    } else {
      this.label = null;
    }
  }

  load(videoId: string, startAt: number): void {
    this.videoId = videoId;
    this.playing = false;
    this.rebase(Math.max(0, startAt));
    this.render();
  }
  play(): void {
    if (this.videoId === null || this.playing) return;
    this.rebase(this.getTime());
    this.playing = true;
    this.render();
  }
  pause(): void {
    if (!this.playing) return;
    this.rebase(this.getTime());
    this.playing = false;
    this.render();
  }
  seek(time: number): void {
    if (this.videoId === null) return;
    this.rebase(Math.max(0, time));
  }
  stop(): void {
    this.videoId = null;
    this.playing = false;
    this.rebase(0);
    this.render();
  }
  setRate(rate: number): void {
    this.rebase(this.getTime());
    this.rate = rate;
  }
  getTime(): number {
    if (!this.playing) return this.baseTime;
    return this.baseTime + ((this.now() - this.baseNow) / 1000) * this.rate;
  }
  /** The fake has no media metadata; callers fall back to the catalog duration. */
  getDuration(): number | null {
    return null;
  }
  mute(): void {
    this.muted = true;
  }
  unmute(): void {
    this.muted = false;
  }
  isMuted(): boolean {
    return this.muted;
  }
  onError(listener: (code: number) => void): () => void {
    return this.errors.add(listener);
  }
  onEnded(listener: () => void): () => void {
    return this.ended.add(listener);
  }
  dispose(): void {
    this.disposed = true;
    this.playing = false;
    this.errors.clear();
    this.ended.clear();
    this.label?.remove();
  }

  /** Test control: report an IFrame API error code. */
  emitError(code: number): void {
    this.errors.emit(code);
  }
  /** Test control: report the end of the video (pauses at the current time). */
  emitEnded(): void {
    this.pause();
    this.ended.emit();
  }
  /** Test and dev-hook view of the player. */
  get state(): FakeTvPlayerState {
    return {
      videoId: this.videoId,
      playing: this.playing,
      rate: this.rate,
      muted: this.muted,
      disposed: this.disposed,
    };
  }

  private rebase(time: number): void {
    this.baseTime = time;
    this.baseNow = this.now();
  }
  private render(): void {
    if (!this.label) return;
    this.label.textContent =
      this.videoId === null ? '' : `fake ${this.videoId} ${this.playing ? '▶' : '❚❚'}`;
  }
}
