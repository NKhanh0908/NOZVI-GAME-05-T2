import {
  canEmote,
  findInteractionTarget,
  isSeated,
  nextActivity,
  officeLayout,
  type Activity,
  type EmoteId,
  type IntentMessage,
  type Interactable,
  type Item,
  type PlayerState,
} from '@office/protocol';
import type { SeatOccupancy } from '../../net/occupancy';
import { MACHINE_IN_USE } from './extras';

/** `progress` (0 to 1) draws a progress bar under the text (brewing, T-1154). */
export type Prompt = { text: string; available: boolean; progress?: number } | null;
export interface PlayerLike {
  state: PlayerState;
  activity: Activity;
  /** Held item as the server reports it ('' or absent = empty hand; REQ-INT-003). */
  readonly item?: Item;
  /** Brewing progress from 0 to 1 while `brewing`. */
  readonly brewProgress?: number;
}
export type InteractionHooks = {
  onExit(): void;
  /** Sends an activity request to the server; the result arrives in room state. */
  sendIntent(intent: IntentMessage): void;
  onAction?(target: Interactable): void;
  /** E at the TV opens TV mode (REQ-TV-002). */
  onTv?(): void;
  /** The employee brewing at the coffee machine (room state), or null when it is free. */
  brewer?(): string | null;
};

const LABELS: Record<string, string> = {
  main_door: 'E — Leave office',
  coffee_machine: 'E — Make coffee',
  water_dispenser: 'E — Drink water',
  sofa: 'E — Rest',
  storage_cabinet: 'E — Open cabinet',
  TV: 'E — Watch TV',
};
const TARGETS = officeLayout.interactables.filter((i) => i.type !== 'computer');

function deskSeatId(target: Interactable): string | null {
  return officeLayout.workstations.find((w) => w.id === target.workstationId)?.seat.id ?? null;
}

/**
 * REQ-INT-001/002/005: interaction targeting and prompts. Seats are not owned here: occupancy
 * comes from room state, and E / G only send intents. Seat pose and activity change when the
 * server state confirms them (no optimistic sit), see `Player.applyServer`.
 */
export class InteractionController {
  constructor(
    private readonly player: PlayerLike,
    private readonly seats: SeatOccupancy,
    private readonly ownerId: string,
    private readonly hooks: InteractionHooks,
  ) {}

  private target(): Interactable | null {
    return findInteractionTarget(this.player.state, TARGETS);
  }

  /** True when no other employee holds the seat. */
  seatFree(seatId: string): boolean {
    const holder = this.seats.occupant(seatId);
    return holder === null || holder === this.ownerId;
  }

  /** True while another employee brews at the coffee machine (REQ-INT-003). */
  machineBusy(): boolean {
    const brewer = this.hooks.brewer?.() ?? null;
    return brewer !== null && brewer !== this.ownerId;
  }

  /** True when F would take a sip now (holding a coffee, standing or seated). */
  canSip(): boolean {
    const a = this.player.activity;
    return this.player.item === 'coffee' && nextActivity(a, { type: 'drink' }, 'coffee') !== a;
  }

  currentPrompt(): Prompt {
    const a = this.player.activity;
    const sip = this.canSip() ? 'F — Sip' : null;
    /** `parts` joined with ' · ', with the sip key after the first part when it applies. */
    const line = (first: string | null, ...rest: string[]): Prompt => {
      const parts = [first, sip, ...rest].filter((p): p is string => p !== null);
      return parts.length > 0 ? { text: parts.join(' · '), available: true } : null;
    };
    if (a === 'brewing') {
      const progress = this.player.brewProgress ?? 0;
      const percent = Math.floor(progress * 20) * 5;
      return { text: `Brewing coffee… ${percent}% · WASD — Cancel`, available: true, progress };
    }
    if (a === 'drinking' && this.player.item === 'coffee') {
      return { text: 'Sipping…', available: true };
    }
    if (a === 'sitting') return line('E — Start working', 'WASD — Stand up');
    if (a === 'working') return line('E — Stop working', 'WASD — Stand up');
    if (a === 'resting') return line(null, 'WASD — Stand up');
    const t = this.target();
    if (!t) return line(null);
    if (t.type === 'chair') {
      const seatId = deskSeatId(t);
      if (!seatId) return null;
      if (this.seatFree(seatId)) return line('E — Sit');
      return { ...line('Desk taken')!, available: false };
    }
    // Holding a coffee: no brew (empty hand only) and no water drink; F sips it.
    if (t.type === 'coffee_machine' || t.type === 'water_dispenser') {
      if (this.player.item === 'coffee') return line(null);
      if (t.type === 'coffee_machine' && this.machineBusy()) {
        return { text: MACHINE_IN_USE, available: false };
      }
    }
    return line(LABELS[t.type] ?? null);
  }

  press(): void {
    const a = this.player.activity;
    if (a === 'sitting' || a === 'working') {
      this.hooks.sendIntent({ type: 'toggleWork' });
      return;
    }
    if (isSeated(a)) return;
    const t = this.target();
    if (!t) return;
    if (t.type === 'chair') {
      const seatId = deskSeatId(t);
      if (seatId) this.requestSeat(seatId, 'desk');
      return;
    }
    if (t.type === 'main_door') {
      this.hooks.onExit();
      return;
    }
    if (t.type === 'TV') {
      this.hooks.onTv?.();
      return;
    }
    this.hooks.onAction?.(t);
  }

  /**
   * F: one sip of the held coffee (REQ-INT-003, T-1154), standing or seated (owner decision
   * 2026-11-17). Returns whether the intent was sent; the server still decides.
   */
  sip(): boolean {
    if (!this.canSip()) return false;
    this.hooks.sendIntent({ type: 'drink' });
    return true;
  }

  /**
   * G: the `wave` emote (T-1222 moved the key from the Phase 2 `wave` intent, DECISIONS
   * 2026-11-17 T-1220).
   */
  wave(): void {
    this.emote('wave');
  }

  /**
   * REQ-AVATAR-004: asks for an emote when the current activity allows it (`canEmote`);
   * returns whether the intent was sent. The server still decides (gap, timers).
   */
  emote(emote: EmoteId): boolean {
    if (!this.canEmote(emote)) return false;
    this.hooks.sendIntent({ type: 'emote', emote });
    return true;
  }

  canEmote(emote: EmoteId): boolean {
    return canEmote(this.player.activity, emote);
  }

  /**
   * Sends `sit` for a free seat when the player can enter the seated activity. Returns
   * whether the intent was sent; the server still decides (range, contested seat).
   */
  requestSeat(seatId: string, kind: 'desk' | 'sofa'): boolean {
    const a = this.player.activity;
    if (nextActivity(a, { type: 'sit', kind }) === a) return false;
    if (!this.seatFree(seatId)) return false;
    this.hooks.sendIntent({ type: 'sit', seatId });
    return true;
  }

  /** Sends an intent other than `sit` (e.g. a break from `handleAction`). */
  request(intent: IntentMessage): void {
    this.hooks.sendIntent(intent);
  }
}
