import type { TvStatus } from '@office/protocol';

/**
 * REQ-TV-002: what the TV panel asks for. The panel only talks to this seam; `TvBinding`
 * sends `tv` commands to the room and the player follows the replicated state. Semantics
 * follow the server `TvSim`: `load`
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

/** Read side of the seam, derived from the room `tv` state plus the player. */
export interface TvViewSource {
  view(): TvView;
}
