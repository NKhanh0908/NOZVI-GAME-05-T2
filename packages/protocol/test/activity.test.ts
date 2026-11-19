import { describe, expect, it } from 'vitest';
import {
  EMPTY_HAND,
  isSeated,
  nextActivity,
  nextHeld,
  statusFor,
  toItem,
  type Held,
} from '../src/activity';
import { BALANCE } from '../src/balance';

describe('activity', () => {
  it('walks and stops', () => {
    expect(nextActivity('idle', { type: 'move' })).toBe('walking');
    expect(nextActivity('walking', { type: 'stop' })).toBe('idle');
  });
  it('sits at a desk, toggles work, stands', () => {
    const s = nextActivity('idle', { type: 'sit', kind: 'desk' });
    expect(s).toBe('sitting');
    expect(nextActivity(s, { type: 'toggleWork' })).toBe('working');
    expect(nextActivity('working', { type: 'toggleWork' })).toBe('sitting');
    expect(nextActivity('working', { type: 'stand' })).toBe('idle');
  });
  it('rests on the sofa', () => {
    expect(nextActivity('walking', { type: 'sit', kind: 'sofa' })).toBe('resting');
    expect(nextActivity('resting', { type: 'toggleWork' })).toBe('resting');
  });
  it('ignores moves while seated (caller must stand first)', () => {
    expect(nextActivity('sitting', { type: 'move' })).toBe('sitting');
  });
  it('drinks and waves, moving cancels, actionDone ends', () => {
    expect(nextActivity('idle', { type: 'drink' })).toBe('drinking');
    expect(nextActivity('drinking', { type: 'move' })).toBe('walking');
    expect(nextActivity('idle', { type: 'wave' })).toBe('waving');
    expect(nextActivity('waving', { type: 'actionDone' })).toBe('idle');
    expect(nextActivity('sitting', { type: 'wave' })).toBe('sitting');
  });
  it('brews from a free state with an empty hand only (REQ-INT-003)', () => {
    expect(nextActivity('idle', { type: 'brew' })).toBe('brewing');
    expect(nextActivity('walking', { type: 'brew' }, '')).toBe('brewing');
    expect(nextActivity('idle', { type: 'brew' }, 'coffee')).toBe('idle');
    expect(nextActivity('sitting', { type: 'brew' })).toBe('sitting');
    expect(nextActivity('drinking', { type: 'brew' })).toBe('drinking');
    expect(nextActivity('brewing', { type: 'brew' })).toBe('brewing');
  });
  it('brewDone ends brewing and hands over a full coffee', () => {
    expect(nextActivity('brewing', { type: 'brewDone' })).toBe('idle');
    expect(nextActivity('idle', { type: 'brewDone' })).toBe('idle');
    expect(nextHeld('brewing', EMPTY_HAND, { type: 'brewDone' })).toEqual({
      item: 'coffee',
      sips: BALANCE.coffee.sips,
    });
    // A brew that was cancelled (no longer brewing) gives nothing.
    expect(nextHeld('walking', EMPTY_HAND, { type: 'brewDone' })).toEqual(EMPTY_HAND);
    // actionDone does not end a brew; only brewDone does.
    expect(nextActivity('brewing', { type: 'actionDone' })).toBe('brewing');
  });
  it('moving cancels brewing; standing still keeps it; other intents are refused', () => {
    expect(nextActivity('brewing', { type: 'move' })).toBe('walking');
    expect(nextActivity('brewing', { type: 'stop' })).toBe('brewing');
    expect(nextActivity('brewing', { type: 'sit', kind: 'desk' })).toBe('brewing');
    expect(nextActivity('brewing', { type: 'drink' })).toBe('brewing');
    expect(nextActivity('brewing', { type: 'wave' })).toBe('brewing');
    expect(nextHeld('brewing', EMPTY_HAND, { type: 'move' })).toEqual(EMPTY_HAND);
  });
  it('drink without a cup is a plain drink and leaves the hand empty', () => {
    expect(nextActivity('idle', { type: 'drink' }, '')).toBe('drinking');
    expect(nextHeld('drinking', EMPTY_HAND, { type: 'actionDone' })).toEqual(EMPTY_HAND);
  });
  it('drink with a cup takes one sip per finished drink; the last sip removes the cup', () => {
    expect(nextActivity('walking', { type: 'drink' }, 'coffee')).toBe('drinking');
    let held: Held = nextHeld('brewing', EMPTY_HAND, { type: 'brewDone' });
    for (let left = BALANCE.coffee.sips - 1; left > 0; left--) {
      held = nextHeld('drinking', held, { type: 'actionDone' });
      expect(held).toEqual({ item: 'coffee', sips: left });
    }
    held = nextHeld('drinking', held, { type: 'actionDone' });
    expect(held).toEqual(EMPTY_HAND);
    // A sip cancelled by moving costs nothing.
    const full: Held = { item: 'coffee', sips: 3 };
    expect(nextHeld('drinking', full, { type: 'move' })).toBe(full);
    // Waving with a cup does not drink from it.
    expect(nextHeld('waving', full, { type: 'actionDone' })).toBe(full);
  });
  it('a seated sip needs a coffee, keeps the seat and resumes the seated activity', () => {
    // Owner decision 2026-11-17: lift the cup from the desk, sip, stay seated.
    for (const seated of ['sitting', 'working', 'resting'] as const) {
      expect(nextActivity(seated, { type: 'drink' }, 'coffee')).toBe('drinking');
      expect(nextActivity(seated, { type: 'drink' }, '')).toBe(seated);
      expect(nextActivity(seated, { type: 'drink' })).toBe(seated);
      expect(nextActivity('drinking', { type: 'actionDone', resume: seated })).toBe(seated);
    }
    // Without `resume` a finished drink returns to idle (a standing sip or a water drink).
    expect(nextActivity('drinking', { type: 'actionDone' })).toBe('idle');
    // A seated sip counts like a standing one.
    const held = nextHeld('drinking', { item: 'coffee', sips: 2 }, {
      type: 'actionDone',
      resume: 'working',
    });
    expect(held).toEqual({ item: 'coffee', sips: 1 });
  });
  it('reads replicated item strings', () => {
    expect(toItem('coffee')).toBe('coffee');
    expect(toItem('')).toBe('');
    expect(toItem('tea')).toBe('');
  });
  it('maps status', () => {
    expect(statusFor('working')).toBe('working');
    expect(statusFor('resting')).toBe('online');
    expect(isSeated('resting')).toBe(true);
    expect(isSeated('drinking')).toBe(false);
  });
});
