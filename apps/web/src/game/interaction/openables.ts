import { BALANCE, officeLayout, type Interactable, type PlayerState } from '@office/protocol';

/** Which swing (angle in `BALANCE.interactionView.openAngleDeg`) an interactable type uses. */
export type OpenableKind = 'cabinet' | 'fridge' | 'door';

/** Interactable types with doors that open locally (REQ-INT-004/005, T-1156). */
export const OPENABLE_KIND: Readonly<Record<string, OpenableKind>> = {
  storage_cabinet: 'cabinet',
  fridge: 'fridge',
  main_door: 'door',
};

/** Types that E opens and closes; the main door only opens when used to exit. */
export function togglesOnE(type: string): boolean {
  return type === 'storage_cabinet' || type === 'fridge';
}

/** Smoothstep easing of the linear open progress. */
export function easeOpen(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return p * p * (3 - 2 * p);
}

type OpenState = { open: boolean; progress: number };

/**
 * REQ-INT-004/005: local open / closed state of cabinet, fridge and main door, keyed by
 * interactable id. Pure state: nothing here is sent to the server or replicated, and
 * collision never changes. `progress` runs from 0 (closed) to 1 (open) over
 * `BALANCE.interactionView.openSeconds`; walking out of an interactable's range closes it.
 */
export class Openables {
  private readonly states = new Map<string, OpenState>();
  private readonly targets: ReadonlyMap<string, Interactable>;

  constructor(
    interactables: readonly Interactable[] = officeLayout.interactables,
    private readonly seconds: number = BALANCE.interactionView.openSeconds,
  ) {
    this.targets = new Map(
      interactables.filter((i) => OPENABLE_KIND[i.type] !== undefined).map((i) => [i.id, i]),
    );
  }

  /** Kind of an openable interactable id, or undefined when it does not open. */
  kind(id: string): OpenableKind | undefined {
    const target = this.targets.get(id);
    return target ? OPENABLE_KIND[target.type] : undefined;
  }

  /** The openable interactable with this id. */
  target(id: string): Interactable | undefined {
    return this.targets.get(id);
  }

  isOpen(id: string): boolean {
    return this.states.get(id)?.open ?? false;
  }

  /** 0 = closed, 1 = fully open (linear; use `easeOpen` for the swing). */
  progress(id: string): number {
    return this.states.get(id)?.progress ?? 0;
  }

  /** Opens a closed one or closes an open one; returns the new open state. */
  toggle(id: string): boolean {
    const open = !this.isOpen(id);
    this.set(id, open);
    return open;
  }

  set(id: string, open: boolean): void {
    if (!this.targets.has(id)) return;
    const state = this.states.get(id) ?? { open: false, progress: 0 };
    state.open = open;
    this.states.set(id, state);
  }

  /** Advances the swings and closes anything the player has walked out of range of. */
  update(dt: number, player: PlayerState): void {
    const step = this.seconds > 0 ? dt / this.seconds : 1;
    for (const [id, state] of this.states) {
      const target = this.targets.get(id)!;
      const [ix, , iz] = target.interactionPoint;
      if (state.open && Math.hypot(ix - player.x, iz - player.z) > target.interactionRange) {
        state.open = false;
      }
      state.progress = state.open
        ? Math.min(1, state.progress + step)
        : Math.max(0, state.progress - step);
      if (!state.open && state.progress === 0) this.states.delete(id);
    }
  }

  /** Ids that are open or still swinging. */
  active(): string[] {
    return [...this.states.keys()];
  }

  /** Open state of every openable (dev hook). */
  snapshot(): Record<string, boolean> {
    return Object.fromEntries([...this.targets.keys()].map((id) => [id, this.isOpen(id)]));
  }
}
