import type { TvStatus } from '@office/protocol';
import type { TvPlayer } from './player';

/**
 * REQ-TV-002: what the TV panel asks for. The panel only talks to this seam: in P4.8 it
 * drives the local player ({@link LocalTvControls}); P4.9 swaps in an implementation that
 * sends `tv` commands to the room instead. Semantics follow the server `TvSim`: `load`
 * changes the video and starts playing, play / pause / seek do nothing while idle and
 * `stop` returns to idle. `unmute` is always local (autoplay policy, plan §6.5).
 */
export interface TvControls {
  load(videoId: string): void;
  play(): void;
  pause(): void;
  seek(time: number): void;
  stop(): void;
  unmute(): void;
}

/** What the panel shows: the current video, status, position and mute state. */
export type TvView = {
  videoId: string | null;
  status: TvStatus;
  /** Seconds of video time. */
  time: number;
  /** Seconds, or null while unknown. */
  duration: number | null;
  muted: boolean;
};

/** Read side of the seam; P4.9 derives it from the room `tv` state plus the player. */
export interface TvViewSource {
  view(): TvView;
}

/** P4.8: the controls drive only the local player; nothing is sent to the server. */
export class LocalTvControls implements TvControls, TvViewSource {
  private videoId: string | null = null;
  private status: TvStatus = 'idle';

  constructor(
    private readonly player: TvPlayer,
    /** Catalog duration fallback when the player has no metadata (the fake player). */
    private readonly catalogDuration: (videoId: string) => number | null = () => null,
  ) {}

  load(videoId: string): void {
    this.videoId = videoId;
    this.status = 'playing';
    this.player.load(videoId, 0);
    this.player.play();
  }
  play(): void {
    if (this.status === 'idle') return;
    this.status = 'playing';
    this.player.play();
  }
  pause(): void {
    if (this.status === 'idle') return;
    this.status = 'paused';
    this.player.pause();
  }
  seek(time: number): void {
    if (this.status === 'idle' || !Number.isFinite(time)) return;
    this.player.seek(Math.max(0, time));
  }
  stop(): void {
    this.videoId = null;
    this.status = 'idle';
    this.player.stop();
  }
  unmute(): void {
    this.player.unmute();
  }

  view(): TvView {
    const id = this.videoId;
    return {
      videoId: id,
      status: this.status,
      time: id === null ? 0 : this.player.getTime(),
      duration: id === null ? null : (this.player.getDuration() ?? this.catalogDuration(id)),
      muted: this.player.isMuted(),
    };
  }
}
