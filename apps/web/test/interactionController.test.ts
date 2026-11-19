import { describe, expect, it, vi } from 'vitest';
import {
  SeatRegistry,
  type Activity,
  type IntentMessage,
  type PlayerState,
} from '@office/protocol';
import { InteractionController } from '../src/game/interaction/InteractionController';
import { roomOccupancy, type SeatOccupancy } from '../src/net/occupancy';

function fakePlayer(state: PlayerState, activity: Activity = 'idle') {
  return { state, activity };
}

function setup(state: PlayerState, seats: SeatOccupancy = new SeatRegistry()) {
  const p = fakePlayer(state);
  const sent: IntentMessage[] = [];
  const onExit = vi.fn();
  const c = new InteractionController(p, seats, 'me', {
    onExit,
    sendIntent: (i) => sent.push(i),
  });
  return { p, c, sent, onExit, seats };
}

describe('InteractionController', () => {
  it('sends sit for the faced free desk and changes nothing until the server confirms', () => {
    const { p, c, sent } = setup({ x: 0.66, z: 2.46, heading: Math.PI });
    expect(c.currentPrompt()?.text).toBe('E — Sit');
    c.press();
    expect(sent).toEqual([{ type: 'sit', seatId: 'ws_5_seat' }]);
    // No optimistic sit: activity and position are untouched.
    expect(p.activity).toBe('idle');
    expect(p.state).toEqual({ x: 0.66, z: 2.46, heading: Math.PI });
  });

  it('toggles work through intents while the server reports the player seated', () => {
    const { p, c, sent } = setup({ x: 0.66, z: 1.2, heading: Math.PI / 2 });
    p.activity = 'sitting';
    expect(c.currentPrompt()?.text).toBe('E — Start working · WASD — Stand up');
    c.press();
    p.activity = 'working';
    expect(c.currentPrompt()?.text).toBe('E — Stop working · WASD — Stand up');
    c.press();
    expect(sent).toEqual([{ type: 'toggleWork' }, { type: 'toggleWork' }]);
    p.activity = 'resting';
    expect(c.currentPrompt()?.text).toBe('WASD — Stand up');
    c.press();
    expect(sent).toHaveLength(2);
  });

  it('shows a desk held by another employee as taken and sends nothing', () => {
    const seats = new SeatRegistry();
    seats.claim('ws_5_seat', 'other');
    const { p, c, sent } = setup({ x: 0.66, z: 2.46, heading: Math.PI }, seats);
    expect(c.currentPrompt()).toEqual({ text: 'Desk taken', available: false });
    c.press();
    expect(sent).toEqual([]);
    expect(p.activity).toBe('idle');
  });

  it('reads desk occupancy from replicated room state', () => {
    const employees = new Map([
      ['me', { seatId: '' }],
      ['other', { seatId: '' }],
    ]);
    const occupancy = roomOccupancy({ state: { employees } });
    const { c } = setup({ x: 0.66, z: 2.46, heading: Math.PI }, occupancy);
    expect(c.currentPrompt()?.text).toBe('E — Sit');
    employees.get('other')!.seatId = 'ws_5_seat';
    expect(occupancy.occupant('ws_5_seat')).toBe('other');
    expect(c.currentPrompt()).toEqual({ text: 'Desk taken', available: false });
    employees.get('other')!.seatId = '';
    expect(c.currentPrompt()?.text).toBe('E — Sit');
    // The local player's own seat is never "taken".
    employees.get('me')!.seatId = 'ws_5_seat';
    expect(c.seatFree('ws_5_seat')).toBe(true);
    expect(roomOccupancy({}).occupant('ws_5_seat')).toBeNull();
  });

  it('does not send sit while the activity forbids it', () => {
    const { p, c, sent } = setup({ x: 0.66, z: 2.46, heading: Math.PI });
    p.activity = 'drinking';
    c.press();
    expect(sent).toEqual([]);
  });

  it('G sends the wave emote when the activity allows it (T-1222)', () => {
    const { p, c, sent } = setup({ x: 0, z: 0, heading: 0 });
    c.wave();
    expect(sent).toEqual([{ type: 'emote', emote: 'wave' }]);
    // Seated employees can wave too (protocol canEmote); not while drinking.
    p.activity = 'sitting';
    c.wave();
    p.activity = 'drinking';
    c.wave();
    expect(sent).toEqual([
      { type: 'emote', emote: 'wave' },
      { type: 'emote', emote: 'wave' },
    ]);
  });

  it('sends an emote only where the protocol allows it', () => {
    const { p, c, sent } = setup({ x: 0, z: 0, heading: 0 });
    expect(c.emote('dance')).toBe(true);
    p.activity = 'working';
    expect(c.canEmote('dance')).toBe(false);
    expect(c.emote('dance')).toBe(false);
    expect(c.emote('think')).toBe(true);
    p.activity = 'brewing';
    expect(c.emote('laugh')).toBe(false);
    expect(sent).toEqual([
      { type: 'emote', emote: 'dance' },
      { type: 'emote', emote: 'think' },
    ]);
  });

  it('leaves through the main door locally', () => {
    const { c, onExit, sent } = setup({ x: -0.46, z: -3.8, heading: Math.PI });
    expect(c.currentPrompt()).toEqual({ text: 'E — Leave office', available: true });
    c.press();
    expect(onExit).toHaveBeenCalledOnce();
    expect(sent).toEqual([]);
  });
  it('targets the TV: shows the prompt and opens TV mode locally on E', () => {
    const p = fakePlayer({ x: -5.0, z: -0.9, heading: Math.atan2(-0.83, -0.72) });
    const sent: IntentMessage[] = [];
    const onTv = vi.fn();
    const c = new InteractionController(p, new SeatRegistry(), 'me', {
      onExit: vi.fn(),
      sendIntent: (i) => sent.push(i),
      onTv,
    });
    expect(c.currentPrompt()).toEqual({ text: 'E — Watch TV', available: true });
    c.press();
    expect(onTv).toHaveBeenCalledOnce();
    expect(sent).toEqual([]);
    // Facing away from the TV: no prompt.
    p.state = { x: -5.0, z: -0.9, heading: Math.PI / 2 };
    expect(c.currentPrompt()).toBeNull();
  });

  describe('coffee (REQ-INT-003, T-1154)', () => {
    const coffee = (activity: Activity = 'idle', state = { x: 0, z: -2.4, heading: 0 }) => {
      const p = { state, activity, item: 'coffee' as const, brewProgress: 0 };
      const sent: IntentMessage[] = [];
      const c = new InteractionController(p, new SeatRegistry(), 'me', {
        onExit: vi.fn(),
        sendIntent: (i) => sent.push(i),
      });
      return { p, c, sent };
    };

    it('offers F — Sip while holding a cup and sends drink on sip()', () => {
      const { c, sent } = coffee();
      expect(c.currentPrompt()).toEqual({ text: 'F — Sip', available: true });
      expect(c.sip()).toBe(true);
      expect(sent).toEqual([{ type: 'drink' }]);
    });

    it('offers the seated sip next to work and stand-up keys (owner decision 2026-11-17)', () => {
      expect(coffee('sitting').c.currentPrompt()?.text).toBe(
        'E — Start working · F — Sip · WASD — Stand up',
      );
      expect(coffee('working').c.currentPrompt()?.text).toBe(
        'E — Stop working · F — Sip · WASD — Stand up',
      );
      expect(coffee('resting').c.currentPrompt()?.text).toBe('F — Sip · WASD — Stand up');
      const seated = coffee('working');
      expect(seated.c.sip()).toBe(true);
      expect(seated.sent).toEqual([{ type: 'drink' }]);
    });

    it('sends no sip without a cup, while sipping or while brewing', () => {
      const { p, c, sent } = setup({ x: 0, z: -2.4, heading: 0 });
      expect(c.canSip()).toBe(false);
      expect(c.sip()).toBe(false);
      p.activity = 'sitting';
      expect(c.currentPrompt()?.text).toBe('E — Start working · WASD — Stand up');
      for (const a of ['drinking', 'brewing', 'waving'] as const) {
        const held = coffee(a);
        expect(held.c.sip()).toBe(false);
        expect(held.sent).toEqual([]);
      }
      expect(coffee('drinking').c.currentPrompt()).toEqual({ text: 'Sipping…', available: true });
      expect(sent).toEqual([]);
    });

    it('shows brewing progress in steps of 5 % with a progress value', () => {
      const { p, c } = coffee('brewing');
      Object.assign(p, { item: '', brewProgress: 0.42 });
      expect(c.currentPrompt()).toEqual({
        text: 'Brewing coffee… 40% · WASD — Cancel',
        available: true,
        progress: 0.42,
      });
    });

    it('at the machine with a cup in hand offers only the sip', () => {
      const { c } = coffee('idle', { x: 2.35, z: -2.75, heading: Math.PI });
      expect(c.currentPrompt()).toEqual({ text: 'F — Sip', available: true });
    });
  });
});
