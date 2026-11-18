import { describe, expect, it } from 'vitest';
import { BALANCE, EMOTES, officeLayout, type EmoteId, type InputMessage } from '@office/protocol';
import { OfficeSim, seatSpots, type ActivityBody } from '../src/sim/activity';

/** REQ-AVATAR-004, T-1221: emotes in the activity simulation, driven by a controlled clock. */

const colliders = officeLayout.colliders;
const spots = seatSpots();
const DESK = 'ws_1_seat';
const SOFA = 'sofa_seat_1';
const coffee = officeLayout.interactables.find((i) => i.type === 'coffee_machine')!;

function body(x: number, z: number): ActivityBody {
  return {
    x,
    z,
    heading: 0,
    activity: 'idle',
    lastSeq: 0,
    seatId: '',
    item: '',
    sips: 0,
    emote: '',
  };
}
const near = (seatId: string) => {
  const [x, , z] = spots.get(seatId)!.standPoint;
  return body(x, z);
};
const atMachine = () => body(coffee.interactionPoint[0], coffee.interactionPoint[2]);

function setup(entries: Record<string, ActivityBody>) {
  const sim = new OfficeSim();
  const bodies = new Map(Object.entries(entries));
  for (const id of bodies.keys()) sim.add(id);
  return {
    sim,
    get: (id: string) => bodies.get(id)!,
    /** Runs one tick at `ms` on the controlled clock. */
    at: (ms: number) => sim.tick(bodies, colliders, ms),
  };
}

const input = (seq: number, extra: Partial<InputMessage> = {}): InputMessage => ({
  seq,
  forward: 0,
  right: 0,
  run: false,
  yaw: 0,
  ...extra,
});
const ms = (id: EmoteId) => BALANCE.emote.durationSeconds[id] * 1000;
const gapMs = BALANCE.emote.minGapSeconds * 1000;

/** An employee seated on DESK in the given activity at time 0. */
function seated(activity: 'sitting' | 'working') {
  const s = setup({ a: near(DESK) });
  s.sim.intent('a', { type: 'sit', seatId: DESK });
  if (activity === 'working') s.sim.intent('a', { type: 'toggleWork' });
  s.at(0);
  expect(s.get('a').activity).toBe(activity);
  return s;
}

describe('emote start, timer and previous activity (criterion 1)', () => {
  it.each(EMOTES)('%s starts standing and ends after its duration, back to idle', (id) => {
    const s = setup({ a: near(DESK) });
    expect(s.sim.intent('a', { type: 'emote', emote: id })).toBe(true);
    s.at(1000);
    expect(s.get('a')).toMatchObject({ activity: 'idle', emote: id });
    s.at(1000 + ms(id) - 1);
    expect(s.get('a').emote).toBe(id);
    s.at(1000 + ms(id));
    expect(s.get('a')).toMatchObject({ activity: 'idle', emote: '' });
  });

  it('keeps a working employee working on the same seat during and after a seated emote', () => {
    const s = seated('working');
    s.sim.intent('a', { type: 'emote', emote: 'think' });
    s.at(100);
    expect(s.get('a')).toMatchObject({ activity: 'working', seatId: DESK, emote: 'think' });
    s.at(100 + ms('think'));
    expect(s.get('a')).toMatchObject({ activity: 'working', seatId: DESK, emote: '' });
    expect(s.sim.activity.seats.occupant(DESK)).toBe('a');
  });

  it('plays an emote while holding a coffee and leaves the cup alone', () => {
    const s = setup({ a: { ...near(DESK), item: 'coffee', sips: 2 } });
    s.sim.intent('a', { type: 'emote', emote: 'laugh' });
    s.at(0);
    expect(s.get('a')).toMatchObject({ emote: 'laugh', item: 'coffee', sips: 2 });
    s.at(ms('laugh'));
    expect(s.get('a')).toMatchObject({ emote: '', item: 'coffee', sips: 2 });
  });

  it('keeps emotes and gaps per employee and forgets them on leave', () => {
    const s = setup({ a: near(DESK), b: near(SOFA) });
    s.sim.intent('a', { type: 'emote', emote: 'dance' });
    s.sim.intent('b', { type: 'emote', emote: 'wave' });
    s.at(0);
    expect([s.get('a').emote, s.get('b').emote]).toEqual(['dance', 'wave']);
    s.sim.remove('a');
    s.sim.add('a');
    s.sim.intent('a', { type: 'emote', emote: 'laugh' });
    s.at(10);
    expect(s.get('a').emote).toBe('laugh');
  });
});

describe('emote gap, allowed states and movement (criterion 2)', () => {
  it('refuses a second emote inside the minimum gap and accepts one after it', () => {
    const s = setup({ a: near(DESK) });
    s.sim.intent('a', { type: 'emote', emote: 'dance' });
    s.at(0);
    s.sim.intent('a', { type: 'emote', emote: 'wave' });
    s.at(gapMs - 1);
    expect(s.get('a').emote).toBe('dance');
    // The refused emote did not restart the gap clock: one at the gap replaces dance.
    s.sim.intent('a', { type: 'emote', emote: 'wave' });
    s.at(gapMs);
    expect(s.get('a').emote).toBe('wave');
    s.at(gapMs + ms('wave'));
    expect(s.get('a').emote).toBe('');
  });

  it('counts the gap from the start even when the previous emote was cut short', () => {
    const s = setup({ a: near(DESK) });
    s.sim.intent('a', { type: 'emote', emote: 'stretch' });
    s.at(0);
    s.sim.input('a', input(1, { forward: 1 }));
    s.at(50);
    expect(s.get('a').emote).toBe('');
    s.sim.intent('a', { type: 'emote', emote: 'stretch' });
    s.at(gapMs - 1);
    expect(s.get('a').emote).toBe('');
  });

  it('refuses dance while seated and changes nothing', () => {
    const s = seated('sitting');
    const before = { ...s.get('a') };
    s.sim.intent('a', { type: 'emote', emote: 'dance' });
    s.at(100);
    expect(s.get('a')).toEqual(before);
    // A refused emote does not consume the gap.
    s.sim.intent('a', { type: 'emote', emote: 'wave' });
    s.at(150);
    expect(s.get('a').emote).toBe('wave');
  });

  it.each(['drink', 'wave', 'brew'] as const)('refuses every emote after %s starts', (start) => {
    const s = setup({ a: atMachine() });
    s.sim.intent('a', { type: start });
    s.at(0);
    const before = { ...s.get('a') };
    expect(before.activity).not.toBe('idle');
    for (const id of EMOTES) s.sim.intent('a', { type: 'emote', emote: id });
    s.at(50);
    expect(s.get('a')).toEqual(before);
  });

  it('ends a running emote on movement input, not on a zero-axis input', () => {
    const s = setup({ a: near(DESK) });
    s.sim.intent('a', { type: 'emote', emote: 'dance' });
    s.at(0);
    s.sim.input('a', input(1));
    s.at(50);
    expect(s.get('a')).toMatchObject({ activity: 'idle', emote: 'dance' });
    s.sim.input('a', input(2, { forward: 1 }));
    s.at(100);
    expect(s.get('a')).toMatchObject({ activity: 'walking', emote: '' });
  });

  it('ends a seated emote when movement stands the employee up', () => {
    const s = seated('sitting');
    s.sim.intent('a', { type: 'emote', emote: 'wave' });
    s.at(100);
    s.sim.input('a', input(1, { right: 1 }));
    s.at(150);
    expect(s.get('a')).toMatchObject({ activity: 'walking', seatId: '', emote: '' });
  });

  it('ends an emote when toggling work or standing up', () => {
    const toggled = seated('sitting');
    toggled.sim.intent('a', { type: 'emote', emote: 'stretch' });
    toggled.at(100);
    toggled.sim.intent('a', { type: 'toggleWork' });
    toggled.at(150);
    expect(toggled.get('a')).toMatchObject({ activity: 'working', emote: '' });

    const stood = seated('working');
    stood.sim.intent('a', { type: 'emote', emote: 'laugh' });
    stood.at(100);
    stood.sim.intent('a', { type: 'stand' });
    stood.at(150);
    expect(stood.get('a')).toMatchObject({ activity: 'idle', emote: '' });
  });

  it.each(['drink', 'wave', 'brew'] as const)('ends an emote when %s starts', (next) => {
    const s = setup({ a: atMachine() });
    s.sim.intent('a', { type: 'emote', emote: 'think' });
    s.at(0);
    s.sim.intent('a', { type: next });
    s.at(50);
    expect(s.get('a').emote).toBe('');
    expect(s.get('a').activity).not.toBe('idle');
  });

  it('rejects unknown emote ids at enqueue', () => {
    const s = setup({ a: near(DESK) });
    expect(s.sim.intent('a', { type: 'emote', emote: 'cry' })).toBe(false);
    expect(s.sim.intent('a', { type: 'emote' })).toBe(false);
  });
});
