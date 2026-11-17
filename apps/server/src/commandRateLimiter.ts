/**
 * REQ-NFR-005: sliding-window command budget per key (a session id). The clock is
 * injectable so tests control time.
 */
export class CommandRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Records a command; returns 0 when it is allowed, otherwise the milliseconds until the
   * oldest command in the window expires (the command is not recorded).
   */
  tryUse(key: string): number {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => t - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, recent[0]! + this.windowMs - t);
    }
    recent.push(t);
    this.hits.set(key, recent);
    return 0;
  }

  forget(key: string): void {
    this.hits.delete(key);
  }
}
