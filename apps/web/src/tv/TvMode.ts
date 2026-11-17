/**
 * REQ-TV-002: TV mode on / off. A small external store (React reads it with
 * `useSyncExternalStore`); the DOM side effects (iframe pointer events, canvas pass-through,
 * focus back to the game) are injected so the state logic stays testable without a DOM.
 */
export class TvMode {
  private open = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly apply: (open: boolean) => void) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** E at the TV. */
  enter(): void {
    this.set(true);
  }

  /** On-screen Close or Esc. Returns whether TV mode was open. */
  exit(): boolean {
    if (!this.open) return false;
    this.set(false);
    return true;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): boolean => this.open;

  private set(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.apply(open);
    for (const l of [...this.listeners]) l();
  }
}
