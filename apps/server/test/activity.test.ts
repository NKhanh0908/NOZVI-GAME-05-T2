import { describe, expect, it } from 'vitest';
import { BALANCE, FIXED_DT, officeLayout, type InputMessage } from '@office/protocol';
import { OfficeSim, seatSpots, type ActivityBody } from '../src/sim/activity';

const colliders = officeLayout.colliders;
const spots = seatSpots();
const DESK = 'ws_1_seat';
const DESK_2 = 'ws_3_seat'; // shares the stand point of ws_1
const SOFA = 'sofa_seat_1';
const deskSpot = spots.get(DESK)!;
const sofaSpot = spots.get(SOFA)!;

function body(x: number, z: number, heading = 0): ActivityBody {
  return { x, z, heading, activity: 'idle', lastSeq: 0, seatId: '', item: '', sips: 0, emote: '' };
}
/** A body standing on a seat's interaction point (in range of it). */
const near = (seatId: string) => {
  const [x, , z] = spots.get(seatId)!.standPoint;
  return body(x, z);
};
const coffee = officeLayout.interactables.find((i) => i.type === 'coffee_machine')!;
const water = officeLayout.interactables.find((i) => i.type === 'water_dispenser')!;

function setup(entries: Record<string, ActivityBody>) {
  const sim = new OfficeSim();
  const bodies = new Map(Object.entries(entries));
  for (const id of bodies.keys()) sim.add(id);
  let now = 0;
  return {
    sim,
    bodies,
    get: (id: string) => bodies.get(id)!,
    /** Runs one tick at `now`, then advances the controlled clock by one step. */
    tick: () => {
      sim.tick(bodies, colliders, now);
      now += 1000 * FIXED_DT;
    },
    at: (ms: number) => sim.tick(bodies, colliders, (now = ms)),
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

describe('seat layout', () => {
  it('resolves 8 desk seats and 2 sofa seats with their range targets', () => {
    expect([...spots.values()].filter((s) => s.kind === 'desk')).toHaveLength(8);
    expect([...spots.values()].filter((s) => s.kind === 'sofa')).toHaveLength(2);
    expect(deskSpot.target.type).toBe('chair');
    expect(sofaSpot.target.type).toBe('sofa');
  });
});

describe('sit (criteria 1 and 2)', () => {
  it('seats a nearby idle employee on the socket position and rotation', () => {
    const s = setup({ a: near(DESK) });
    expect(s.sim.intent('a', { type: 'sit', seatId: DESK })).toBe(true);
    s.tick();
    const a = s.get('a');
    expect(a).toMatchObject({ seatId: DESK, activity: 'sitting' });
    expect([a.x, a.z]).toEqual([deskSpot.position[0], deskSpot.position[2]]);
    expect(a.heading).toBeCloseTo((deskSpot.rotY * Math.PI) / 180);
    expect(s.sim.activity.seats.occupant(DESK)).toBe('a');
  });

  it('seats a sofa request with the resting activity', () => {
    const s = setup({ a: near(SOFA) });
    s.sim.intent('a', { type: 'sit', seatId: SOFA });
    s.tick();
    expect(s.get('a')).toMatchObject({ seatId: SOFA, activity: 'resting' });
  });

  it('gives a desk contested in the same tick to exactly one employee', () => {
    const s = setup({ a: near(DESK), b: near(DESK) });
    const before = { ...s.get('b') };
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.sim.intent('b', { type: 'sit', seatId: DESK });
    s.tick();
    expect(s.get('a')).toMatchObject({ seatId: DESK, activity: 'sitting' });
    expect(s.get('b')).toEqual(before);
    expect(s.sim.activity.seats.occupant(DESK)).toBe('a');
    expect(s.sim.activity.seats.seatOf('b')).toBeNull();
  });

  it('ignores a sit from outside the interaction range', () => {
    const [x, , z] = officeLayout.spawn.position;
    const s = setup({ a: body(x, z) });
    const before = { ...s.get('a') };
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.tick();
    expect(s.get('a')).toEqual(before);
    expect(s.sim.activity.seats.occupant(DESK)).toBeNull();
  });

  it('rejects an unknown seat id and malformed intents at the queue', () => {
    const s = setup({ a: near(DESK) });
    const before = { ...s.get('a') };
    expect(s.sim.intent('a', { type: 'sit', seatId: 'ws_99_seat' })).toBe(false);
    expect(s.sim.intent('a', { type: 'sit' })).toBe(false);
    expect(s.sim.intent('a', { type: 'teleport' })).toBe(false);
    expect(s.sim.intent('a', null)).toBe(false);
    expect(s.sim.intent('nobody', { type: 'wave' })).toBe(false);
    s.tick();
    expect(s.get('a')).toEqual(before);
  });

  it('ignores a sit while already seated', () => {
    const s = setup({ a: near(DESK) });
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.tick();
    const seated = { ...s.get('a') };
    s.sim.intent('a', { type: 'sit', seatId: DESK_2 });
    s.tick();
    expect(s.get('a')).toEqual(seated);
    expect(s.sim.activity.seats.occupant(DESK_2)).toBeNull();
  });

  it('ignores a sit while drinking', () => {
    const [x, , z] = water.interactionPoint;
    const s = setup({ a: body(x, z) });
    s.sim.intent('a', { type: 'drink' });
    s.tick();
    // Move the drinking body next to the desk so only the activity rule can reject the sit.
    const a = s.get('a');
    a.x = deskSpot.standPoint[0];
    a.z = deskSpot.standPoint[2];
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.tick();
    expect(s.get('a')).toMatchObject({ activity: 'drinking', seatId: '' });
  });

  it('judges a sit after the inputs the client sent before it', () => {
    // 2.05 m east of the stand point: out of range now, in range after one 0.1 m step west.
    const [px, , pz] = deskSpot.standPoint;
    const s = setup({ a: body(px + 2.05, pz) });
    expect(s.sim.input('a', input(1, { forward: 1, yaw: -Math.PI / 2 }))).toBe(true);
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.tick();
    expect(s.get('a')).toMatchObject({ seatId: DESK, activity: 'sitting', lastSeq: 1 });
  });

  it('drops intents past the per-client queue cap', () => {
    const s = setup({ a: near(DESK) });
    s.sim.input('a', input(1));
    for (let i = 0; i < BALANCE.net.intentQueueMax; i++) {
      expect(s.sim.intent('a', { type: 'wave' })).toBe(true);
    }
    expect(s.sim.intent('a', { type: 'wave' })).toBe(false);
  });
});

describe('toggleWork (criterion 3)', () => {
  it('switches sitting and working for a desk occupant', () => {
    const s = setup({ a: near(DESK) });
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.sim.intent('a', { type: 'toggleWork' });
    s.tick();
    expect(s.get('a').activity).toBe('working');
    s.sim.intent('a', { type: 'toggleWork' });
    s.tick();
    expect(s.get('a')).toMatchObject({ activity: 'sitting', seatId: DESK });
  });

  it('does nothing for a standing employee or a sofa occupant', () => {
    const s = setup({ a: near(DESK), b: near(SOFA) });
    s.sim.intent('a', { type: 'toggleWork' });
    s.sim.intent('b', { type: 'sit', seatId: SOFA });
    s.sim.intent('b', { type: 'toggleWork' });
    s.tick();
    expect(s.get('a').activity).toBe('idle');
    expect(s.get('b').activity).toBe('resting');
  });
});

describe('standing up (criterion 4)', () => {
  it('keeps the seated pose for a zero-axis input and only advances lastSeq', () => {
    const s = setup({ a: near(DESK) });
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.tick();
    const seated = { ...s.get('a') };
    s.sim.input('a', input(1, { yaw: 1.3 }));
    s.tick();
    expect(s.get('a')).toEqual({ ...seated, lastSeq: 1 });
  });

  it('stands up at the interaction point, frees the seat and walks on movement input', () => {
    const s = setup({ a: near(DESK), b: near(DESK) });
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.tick();
    s.sim.intent('a', { type: 'toggleWork' });
    s.tick();
    expect(s.get('a').activity).toBe('working');
    // yaw 0 walks +z, away from the desk row, along the aisle.
    s.sim.input('a', input(1, { forward: 1 }));
    s.tick();
    const a = s.get('a');
    expect(a).toMatchObject({ activity: 'walking', seatId: '', lastSeq: 1 });
    expect(a.x).toBeCloseTo(deskSpot.standPoint[0], 9);
    expect(a.z).toBeCloseTo(deskSpot.standPoint[2] + BALANCE.movement.walkSpeed * FIXED_DT, 9);
    expect(s.sim.activity.seats.occupant(DESK)).toBeNull();
    // The freed desk can be taken by someone else.
    s.sim.intent('b', { type: 'sit', seatId: DESK });
    s.tick();
    expect(s.get('b').seatId).toBe(DESK);
  });

  it('stands up to idle at the interaction point on a stand intent', () => {
    const s = setup({ a: near(SOFA) });
    s.sim.intent('a', { type: 'sit', seatId: SOFA });
    s.tick();
    s.sim.intent('a', { type: 'stand' });
    s.tick();
    const a = s.get('a');
    expect(a).toMatchObject({ activity: 'idle', seatId: '' });
    expect([a.x, a.z]).toEqual([sofaSpot.standPoint[0], sofaSpot.standPoint[2]]);
    expect(s.sim.activity.seats.occupant(SOFA)).toBeNull();
  });

  it('ignores stand while not seated', () => {
    const s = setup({ a: near(DESK) });
    const before = { ...s.get('a') };
    s.sim.intent('a', { type: 'stand' });
    s.tick();
    expect(s.get('a')).toEqual(before);
  });
});

describe('timed breaks and leaving (criterion 5)', () => {
  const drinkMs = BALANCE.activity.drinkSeconds * 1000;
  const waveMs = BALANCE.activity.waveSeconds * 1000;

  it('drinking at the water dispenser returns to idle after drinkSeconds', () => {
    const [x, , z] = water.interactionPoint;
    const s = setup({ a: body(x, z) });
    s.sim.intent('a', { type: 'drink' });
    s.at(1000);
    expect(s.get('a').activity).toBe('drinking');
    s.at(1000 + drinkMs - 1);
    expect(s.get('a').activity).toBe('drinking');
    s.at(1000 + drinkMs);
    expect(s.get('a').activity).toBe('idle');
  });

  it('ignores an empty-hand drink at the coffee machine (it only brews; T-1154)', () => {
    const [x, , z] = coffee.interactionPoint;
    const s = setup({ a: body(x, z) });
    s.sim.intent('a', { type: 'drink' });
    s.tick();
    expect(s.get('a').activity).toBe('idle');
  });

  it('ignores drink away from the pantry', () => {
    const s = setup({ a: near(DESK) });
    s.sim.intent('a', { type: 'drink' });
    s.tick();
    expect(s.get('a').activity).toBe('idle');
  });

  it('waving returns to idle after waveSeconds', () => {
    const s = setup({ a: near(DESK) });
    s.sim.intent('a', { type: 'wave' });
    s.at(0);
    expect(s.get('a').activity).toBe('waving');
    s.at(waveMs - 1);
    expect(s.get('a').activity).toBe('waving');
    s.at(waveMs);
    expect(s.get('a').activity).toBe('idle');
  });

  it('cancels a break on movement and a stale timer never ends a later break early', () => {
    const [x, , z] = water.interactionPoint;
    const s = setup({ a: body(x, z) });
    s.sim.intent('a', { type: 'drink' });
    s.at(0);
    s.sim.input('a', input(1, { forward: 1 }));
    s.at(50);
    expect(s.get('a').activity).toBe('walking');
    s.sim.input('a', input(2));
    // Start the wave so the cancelled drink's end time falls inside it.
    const waveAt = drinkMs - waveMs / 2;
    s.sim.intent('a', { type: 'wave' });
    s.at(waveAt);
    expect(s.get('a').activity).toBe('waving');
    s.at(drinkMs);
    expect(s.get('a').activity).toBe('waving');
    s.at(waveAt + waveMs);
    expect(s.get('a').activity).toBe('idle');
  });

  it('ignores an empty-hand drink and wave while seated', () => {
    const s = setup({ a: near(DESK) });
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.sim.intent('a', { type: 'drink' });
    s.sim.intent('a', { type: 'wave' });
    s.tick();
    expect(s.get('a').activity).toBe('sitting');
  });

  it('frees the seat when a client leaves', () => {
    const s = setup({ a: near(DESK), b: near(DESK) });
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.tick();
    s.sim.remove('a');
    s.bodies.delete('a');
    expect(s.sim.activity.seats.occupant(DESK)).toBeNull();
    s.sim.intent('b', { type: 'sit', seatId: DESK });
    s.tick();
    expect(s.get('b').seatId).toBe(DESK);
  });
});

describe('coffee routine (REQ-INT-003)', () => {
  const brewMs = BALANCE.coffee.brewSeconds * 1000;
  const drinkMs = BALANCE.activity.drinkSeconds * 1000;
  const atMachine = () => body(coffee.interactionPoint[0], coffee.interactionPoint[2]);
  /** Lets `id` brew at 0 ms and finish; the controlled clock ends at brewMs. */
  const brewed = (s: ReturnType<typeof setup>, id: string) => {
    s.sim.intent(id, { type: 'brew' });
    s.at(0);
    s.at(brewMs);
  };

  it('brew completes after brewSeconds with a full coffee and frees the machine', () => {
    const s = setup({ a: atMachine() });
    s.sim.intent('a', { type: 'brew' });
    s.at(0);
    expect(s.get('a')).toMatchObject({ activity: 'brewing', item: '', sips: 0 });
    expect(s.sim.activity.machineBusy).toBe(true);
    s.at(brewMs - 1);
    expect(s.get('a')).toMatchObject({ activity: 'brewing', item: '' });
    s.at(brewMs);
    expect(s.get('a')).toMatchObject({ activity: 'idle', item: 'coffee', sips: 3 });
    expect(BALANCE.coffee.sips).toBe(3);
    expect(s.sim.activity.machineBusy).toBe(false);
  });

  it('movement during brewing cancels it, hands over nothing and frees the machine', () => {
    const s = setup({ a: atMachine(), b: atMachine() });
    s.sim.intent('a', { type: 'brew' });
    s.at(0);
    // A zero-axis input keeps the brew going.
    s.sim.input('a', input(1));
    s.at(50);
    expect(s.get('a').activity).toBe('brewing');
    s.sim.input('a', input(2, { forward: 1 }));
    s.at(100);
    expect(s.get('a').activity).toBe('walking');
    expect(s.sim.activity.machineBusy).toBe(false);
    s.at(brewMs + 100);
    expect(s.get('a')).toMatchObject({ item: '', sips: 0 });
    // The freed machine serves the next employee.
    s.sim.intent('b', { type: 'brew' });
    s.at(brewMs + 150);
    expect(s.get('b').activity).toBe('brewing');
  });

  it('three sips empty the cup; each sip uses the drink timer and works away from the pantry', () => {
    const s = setup({ a: atMachine() });
    brewed(s, 'a');
    // Move the employee away from the pantry: a sip needs no machine in range.
    Object.assign(s.get('a'), { x: deskSpot.standPoint[0], z: deskSpot.standPoint[2] });
    let t = brewMs;
    for (const left of [2, 1, 0]) {
      s.sim.intent('a', { type: 'drink' });
      s.at((t += 50));
      expect(s.get('a')).toMatchObject({ activity: 'drinking', sips: left + 1 });
      s.at((t += drinkMs - 1));
      expect(s.get('a').activity).toBe('drinking');
      s.at((t += 1));
      expect(s.get('a')).toMatchObject({ activity: 'idle', sips: left });
    }
    expect(s.get('a').item).toBe('');
    // With the cup gone a drink away from the pantry is refused again.
    s.sim.intent('a', { type: 'drink' });
    s.at((t += 50));
    expect(s.get('a').activity).toBe('idle');
  });

  it('a sip cancelled by movement costs nothing', () => {
    const s = setup({ a: atMachine() });
    brewed(s, 'a');
    s.sim.intent('a', { type: 'drink' });
    s.at(brewMs + 50);
    s.sim.input('a', input(1, { forward: 1 }));
    s.at(brewMs + 100);
    s.at(brewMs + 100 + drinkMs);
    expect(s.get('a')).toMatchObject({ activity: 'walking', item: 'coffee', sips: 3 });
  });

  it("refuses a second employee's brew while the machine is busy; leave frees it", () => {
    const s = setup({ a: atMachine(), b: atMachine() });
    s.sim.intent('a', { type: 'brew' });
    s.at(0);
    s.sim.intent('b', { type: 'brew' });
    s.at(50);
    expect(s.get('b').activity).toBe('idle');
    s.sim.remove('a');
    s.bodies.delete('a');
    expect(s.sim.activity.machineBusy).toBe(false);
    s.sim.intent('b', { type: 'brew' });
    s.at(100);
    expect(s.get('b').activity).toBe('brewing');
  });

  it('a dropped connection cancels the brew and frees the machine', () => {
    const s = setup({ a: atMachine(), b: atMachine() });
    s.sim.intent('a', { type: 'brew' });
    s.at(0);
    s.sim.suspend('a', s.get('a').lastSeq);
    expect(s.get('a')).toMatchObject({ activity: 'idle', item: '' });
    s.sim.intent('b', { type: 'brew' });
    s.at(50);
    expect(s.get('b').activity).toBe('brewing');
    s.at(brewMs + 50);
    expect(s.get('a').item).toBe('');
    expect(s.get('b')).toMatchObject({ activity: 'idle', item: 'coffee' });
  });

  it('refuses a brew away from the machine, with a cup in hand, or while seated', () => {
    const away = setup({ a: near(DESK) });
    away.sim.intent('a', { type: 'brew' });
    away.at(0);
    expect(away.get('a').activity).toBe('idle');

    const holding = setup({ a: atMachine() });
    brewed(holding, 'a');
    holding.sim.intent('a', { type: 'brew' });
    holding.at(brewMs + 50);
    expect(holding.get('a')).toMatchObject({ activity: 'idle', sips: 3 });

    const seated = setup({ a: near(DESK) });
    seated.sim.intent('a', { type: 'sit', seatId: DESK });
    seated.at(0);
    seated.get('a').x = coffee.interactionPoint[0];
    seated.get('a').z = coffee.interactionPoint[2];
    seated.sim.intent('a', { type: 'brew' });
    seated.at(50);
    expect(seated.get('a').activity).toBe('sitting');
  });

  /** Brews, then seats `a` at DESK holding a full coffee; the clock ends at brewMs + 50. */
  const seatedWithCoffee = (seat = DESK) => {
    const s = setup({ a: atMachine() });
    brewed(s, 'a');
    const [x, , z] = spots.get(seat)!.standPoint;
    Object.assign(s.get('a'), { x, z });
    s.sim.intent('a', { type: 'sit', seatId: seat });
    s.at(brewMs + 50);
    return s;
  };

  it.each([
    ['sitting', DESK],
    ['working', DESK],
    ['resting', SOFA],
  ] as const)('sips while %s: keeps the seat and returns to it', (seatedAs, seat) => {
    // Owner decision 2026-11-17: lift the cup, sip, stay seated.
    const s = seatedWithCoffee(seat);
    let t = brewMs + 50;
    if (seatedAs === 'working') {
      s.sim.intent('a', { type: 'toggleWork' });
      s.at((t += 50));
    }
    const pose = { x: s.get('a').x, z: s.get('a').z, heading: s.get('a').heading };
    expect(s.get('a').activity).toBe(seatedAs);
    s.sim.intent('a', { type: 'drink' });
    s.at((t += 50));
    expect(s.get('a')).toMatchObject({ activity: 'drinking', seatId: seat, sips: 3 });
    expect(s.sim.activity.seats.occupant(seat)).toBe('a');
    // Zero-axis inputs during the sip keep the seated pose.
    s.sim.input('a', input(1));
    s.at((t += 50));
    expect(s.get('a')).toMatchObject({ activity: 'drinking', seatId: seat, ...pose });
    s.at((t += drinkMs));
    expect(s.get('a')).toMatchObject({ activity: seatedAs, seatId: seat, item: 'coffee', sips: 2 });
  });

  it('three seated sips empty the cup and the employee stays seated', () => {
    const s = seatedWithCoffee();
    let t = brewMs + 50;
    for (const left of [2, 1, 0]) {
      s.sim.intent('a', { type: 'drink' });
      s.at((t += 50));
      s.at((t += drinkMs));
      expect(s.get('a')).toMatchObject({ activity: 'sitting', seatId: DESK, sips: left });
    }
    expect(s.get('a').item).toBe('');
    // With the cup gone a seated drink is refused.
    s.sim.intent('a', { type: 'drink' });
    s.at((t += 50));
    expect(s.get('a').activity).toBe('sitting');
  });

  it('standing up during a seated sip cancels it, costs nothing and frees the seat', () => {
    const moved = seatedWithCoffee();
    moved.sim.intent('a', { type: 'drink' });
    moved.at(brewMs + 100);
    moved.sim.input('a', input(1, { right: 1 }));
    moved.at(brewMs + 150);
    expect(moved.get('a')).toMatchObject({ activity: 'walking', seatId: '', sips: 3 });
    expect(moved.sim.activity.seats.occupant(DESK)).toBeNull();
    moved.at(brewMs + 150 + drinkMs);
    expect(moved.get('a')).toMatchObject({ activity: 'walking', item: 'coffee', sips: 3 });

    const stood = seatedWithCoffee();
    stood.sim.intent('a', { type: 'drink' });
    stood.at(brewMs + 100);
    stood.sim.intent('a', { type: 'stand' });
    stood.at(brewMs + 150);
    const [sx, , sz] = deskSpot.standPoint;
    expect(stood.get('a')).toMatchObject({ activity: 'idle', seatId: '', x: sx, z: sz, sips: 3 });
    stood.at(brewMs + 150 + drinkMs);
    expect(stood.get('a')).toMatchObject({ activity: 'idle', sips: 3 });
  });

  it('refuses toggling work, sitting elsewhere and emotes during a seated sip', () => {
    const s = seatedWithCoffee();
    s.sim.intent('a', { type: 'drink' });
    s.at(brewMs + 100);
    s.sim.intent('a', { type: 'toggleWork' });
    s.sim.intent('a', { type: 'sit', seatId: DESK_2 });
    s.sim.intent('a', { type: 'emote', emote: 'think' });
    s.at(brewMs + 150);
    expect(s.get('a')).toMatchObject({ activity: 'drinking', seatId: DESK, emote: '' });
  });

  it('keeps the cup while sitting and standing', () => {
    const s = setup({ a: atMachine() });
    brewed(s, 'a');
    Object.assign(s.get('a'), { x: deskSpot.standPoint[0], z: deskSpot.standPoint[2] });
    s.sim.intent('a', { type: 'sit', seatId: DESK });
    s.at(brewMs + 50);
    expect(s.get('a')).toMatchObject({ activity: 'sitting', item: 'coffee', sips: 3 });
    s.sim.intent('a', { type: 'stand' });
    s.at(brewMs + 100);
    expect(s.get('a')).toMatchObject({ activity: 'idle', item: 'coffee', sips: 3 });
  });
});
