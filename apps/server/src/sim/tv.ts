import type { TvCommand, TvStatus } from '@office/protocol';

/** The replicated TV fields the simulation writes (`SharedTVState` fits). */
export type TvBody = {
  videoId: string | null;
  status: string;
  currentTime: number;
  updatedAt: number;
  controllerSessionId: string | null;
};

/** Server clock in epoch milliseconds. */
export type Clock = () => number;

/**
 * REQ-TV-004, REQ-TV-005: shared TV state machine. Pure (no Colyseus), with an injected
 * clock. Commands apply one at a time in the order the room receives them, and every
 * employee may control the TV. `currentTime` is seconds of video time at `updatedAt`.
 */
export class TvSim {
  constructor(
    private readonly tv: TvBody,
    private readonly now: Clock = Date.now,
  ) {}

  /** Video position in seconds at server time `at` (defaults to now). */
  positionAt(at: number = this.now()): number {
    const { status, currentTime, updatedAt } = this.tv;
    if (status !== 'playing') return currentTime;
    return currentTime + Math.max(0, at - updatedAt) / 1000;
  }

  /**
   * Applies one validated command from `sessionId`. Returns false when it does not apply
   * (play, pause or seek while idle) and leaves the state untouched.
   */
  apply(sessionId: string, cmd: TvCommand): boolean {
    const at = this.now();
    const tv = this.tv;
    switch (cmd.type) {
      case 'load':
        this.write(sessionId, at, { videoId: cmd.videoId, status: 'playing', currentTime: 0 });
        return true;
      case 'stop':
        this.write(sessionId, at, { videoId: null, status: 'idle', currentTime: 0 });
        return true;
    }
    if (tv.videoId === null || tv.status === 'idle') return false;
    switch (cmd.type) {
      case 'play':
        this.write(sessionId, at, { status: 'playing', currentTime: this.positionAt(at) });
        return true;
      case 'pause':
        this.write(sessionId, at, { status: 'paused', currentTime: this.positionAt(at) });
        return true;
      case 'seek':
        this.write(sessionId, at, { currentTime: cmd.time });
        return true;
    }
  }

  /** OQ-022: playback continues when the controller leaves; only the controller id clears. */
  leave(sessionId: string): void {
    if (this.tv.controllerSessionId === sessionId) this.tv.controllerSessionId = null;
  }

  private write(
    sessionId: string,
    at: number,
    patch: Partial<{ videoId: string | null; status: TvStatus; currentTime: number }>,
  ): void {
    Object.assign(this.tv, patch);
    this.tv.updatedAt = at;
    this.tv.controllerSessionId = sessionId;
  }
}
