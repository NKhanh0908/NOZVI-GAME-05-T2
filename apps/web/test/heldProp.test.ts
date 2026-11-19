import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BALANCE, officeLayout } from '@office/protocol';
import { AvatarView } from '../src/game/avatar/AvatarView';
import {
  HeldProp,
  normalizeProp,
  propFor,
  propRest,
  type PropKind,
} from '../src/game/avatar/HeldProp';
import { cupRestSpot, seatSocket } from '../src/game/interaction/seats';

// REQ-INT-003 (T-1154): the cup in the hand standing, on the desk or coffee table seated,
// removed when the item clears; the water dispenser shows a glass during its drink.

afterEach(() => {
  vi.restoreAllMocks();
  AvatarView.clearCache();
});

/** A stand-in prop model: one small box mesh with its own material. */
function fakeProp(kind: PropKind): THREE.Object3D {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.1, 0.05),
    new THREE.MeshBasicMaterial(),
  );
  mesh.name = `fake:${kind}`;
  return mesh;
}
const fakeLoader = vi.fn(async (kind: PropKind) => fakeProp(kind));
const flush = () => new Promise((done) => setTimeout(done, 0));
const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe('which prop and where', () => {
  it('shows the cup while holding a coffee, a glass during an empty-hand drink', () => {
    expect(propFor('coffee', 'idle')).toBe('cup');
    expect(propFor('coffee', 'drinking')).toBe('cup');
    expect(propFor('coffee', 'sitting')).toBe('cup');
    expect(propFor('', 'drinking')).toBe('glass');
    expect(propFor('', 'idle')).toBeNull();
    expect(propFor('', 'brewing')).toBeNull();
  });

  it('rests the cup while seated, lifts it for a seated sip, carries it otherwise', () => {
    const spot = [1, 0.75, 4] as const;
    expect(propRest(true, 'sitting', [...spot])).toEqual(spot);
    expect(propRest(true, 'working', [...spot])).toEqual(spot);
    expect(propRest(true, 'drinking', [...spot])).toBeNull();
    expect(propRest(false, 'walking', [...spot])).toBeNull();
  });
});

describe('cupRestSpot', () => {
  const top = (type: string, near: [number, number]) => {
    const boxes = officeLayout.items.filter((i) => i.type === type);
    const box = boxes.sort(
      (a, b) =>
        Math.hypot(a.position[0] - near[0], a.position[2] - near[1]) -
        Math.hypot(b.position[0] - near[0], b.position[2] - near[1]),
    )[0]!;
    return box;
  };
  const inside = (spot: [number, number, number], box: (typeof officeLayout.items)[number]) => {
    const [cx, cy, cz] = box.position;
    const [w, h, d] = box.size;
    expect(spot[1]).toBeCloseTo(cy + h / 2, 6);
    expect(Math.abs(spot[0] - cx)).toBeLessThanOrEqual(w / 2);
    expect(Math.abs(spot[2] - cz)).toBeLessThanOrEqual(d / 2);
  };

  it('puts every desk seat cup on its desk top, in front of the seat and to its right', () => {
    for (const ws of officeLayout.workstations) {
      const socket = seatSocket(ws.seat.id)!;
      const spot = cupRestSpot(ws.seat.id)!;
      const desk = top('desk', [socket.position[0], socket.position[2]]);
      inside(spot, desk);
      const h = (socket.rotY * Math.PI) / 180;
      const [dx, dz] = [spot[0] - socket.position[0], spot[2] - socket.position[2]];
      expect(dx * Math.sin(h) + dz * Math.cos(h)).toBeGreaterThan(0); // in front
      expect(dx * -Math.cos(h) + dz * Math.sin(h)).toBeGreaterThan(0); // to the right
    }
    // ws_7 (seat at 0.66, 3.72 facing +x): on the near half of the desk, mouse side.
    const [x, y, z] = cupRestSpot('ws_7_seat')!;
    expect(y).toBeCloseTo(0.75, 6);
    expect(x).toBeCloseTo(0.96 + BALANCE.coffeeView.rest.inset, 6);
    expect(z).toBeCloseTo(3.72 + BALANCE.coffeeView.rest.side, 6);
  });

  it('puts a sofa seat cup on the coffee table', () => {
    for (const seat of officeLayout.sofaSeats) {
      inside(cupRestSpot(seat.id)!, top('coffee_table', [seat.position[0], seat.position[2]]));
    }
  });

  it('has no spot without a seat', () => {
    expect(cupRestSpot('')).toBeNull();
    expect(cupRestSpot('nope')).toBeNull();
  });
});

describe('HeldProp', () => {
  function rig() {
    const root = new THREE.Group();
    root.position.set(2, 0, 3);
    root.rotation.y = Math.PI / 2;
    // A scaled armature like the Modular Suit avatars (bones in centimetres).
    const armature = new THREE.Group();
    armature.scale.setScalar(100);
    const hand = new THREE.Bone();
    hand.position.set(0.003, 0.009, 0.002);
    hand.rotation.set(0.7, -0.4, 1.1);
    armature.add(hand);
    root.add(armature);
    const scene = new THREE.Scene();
    scene.add(root);
    return { root, hand, scene };
  }

  it('attaches the cup to the hand upright at world scale, moves it to the rest spot and back', async () => {
    const { root, hand } = rig();
    const prop = new HeldProp(root, hand, fakeLoader);
    prop.set('cup', null);
    await flush();
    prop.update();
    const cup = prop.drawn!;
    expect(cup.parent).toBe(hand);
    expect(prop.state).toEqual({ kind: 'cup', place: 'hand' });
    // Upright (world up stays up) and not scaled by the armature.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      cup.getWorldQuaternion(new THREE.Quaternion()),
    );
    expect(up.y).toBeCloseTo(1, 5);
    expect(cup.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(1, 5);
    // Within a few centimetres of the hand.
    expect(world(cup).distanceTo(world(hand))).toBeLessThan(0.1);

    prop.set('cup', [2.5, 0.75, 3.2]);
    prop.update();
    expect(cup.parent).toBe(root);
    expect(prop.state).toEqual({ kind: 'cup', place: 'rest' });
    const at = world(cup);
    expect([at.x, at.y, at.z].map((v) => +v.toFixed(6))).toEqual([2.5, 0.75, 3.2]);

    prop.set('cup', null);
    prop.update();
    expect(cup.parent).toBe(hand);
    expect(fakeLoader).toHaveBeenCalledTimes(1);
  });

  it('removes the prop when the item clears and drops a load that finishes too late', async () => {
    const { root, hand } = rig();
    const prop = new HeldProp(root, hand, fakeLoader);
    prop.set('cup', null);
    await flush();
    const cup = prop.drawn!;
    prop.set(null, null);
    expect(cup.parent).toBeNull();
    expect(prop.state).toBeNull();
    let found = false;
    root.traverse((o) => (found ||= o === cup));
    expect(found).toBe(false);

    // Cleared while loading: nothing appears.
    prop.set('glass', null);
    prop.set(null, null);
    await flush();
    expect(prop.drawn).toBeNull();
    prop.dispose();
    prop.set('cup', null);
    await flush();
    expect(prop.drawn).toBeNull();
  });

  it('normalizes a model to stand on the origin within its size limits', () => {
    const source = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.4));
    source.position.set(5, 5, 5);
    const prop = normalizeProp(source, 'cup');
    const size = new THREE.Box3().setFromObject(prop).getSize(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(prop);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(size.y).toBeLessThanOrEqual(BALANCE.coffeeView.cupHeight + 1e-6);
    expect(Math.max(size.x, size.z)).toBeCloseTo(BALANCE.coffeeView.cupMaxWidth, 6);
  });
});

async function loadLocalGltf(url: string): Promise<GLTF> {
  const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(data, '');
}

describe('AvatarView cup (real avatar rig)', () => {
  it('holds the cup in the hand standing, on the desk seated, in the hand for a seated sip, and removes it', async () => {
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(loadLocalGltf);
    const view = await AvatarView.load('men_suit', { loadProp: fakeLoader });
    const scene = new THREE.Scene();
    scene.add(view.root);
    const hand = view.root.getObjectByName('HandR')!;

    view.setActivity('idle', false);
    view.setHeld('coffee', null);
    view.update(0.016);
    await flush();
    view.update(0.016);
    expect(view.heldProp).toEqual({ kind: 'cup', place: 'hand' });
    const cup = view.root.getObjectByName('fake:cup')!;
    expect(cup.parent).toBe(hand);
    expect(world(cup).distanceTo(world(hand))).toBeLessThan(0.1);
    expect(cup.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(1, 4);

    // Seated at ws_7: the view sits on the seat socket; the cup stands on the desk.
    const socket = seatSocket('ws_7_seat')!;
    view.root.position.set(socket.position[0], 0, socket.position[2]);
    view.root.rotation.y = (socket.rotY * Math.PI) / 180;
    const spot = cupRestSpot('ws_7_seat')!;
    view.setActivity('sitting', true);
    view.setHeld('coffee', spot);
    view.update(0.016);
    expect(view.heldProp).toEqual({ kind: 'cup', place: 'rest' });
    expect(world(cup).distanceTo(new THREE.Vector3(...spot))).toBeLessThan(1e-6);

    // A seated sip lifts it back into the hand; the seated pose stays.
    view.setActivity('drinking', true);
    view.update(0.016);
    expect(view.heldProp).toEqual({ kind: 'cup', place: 'hand' });
    expect(view.hasFiniteBones()).toBe(true);

    // The last sip clears the item: the cup leaves the scene graph.
    view.setActivity('sitting', true);
    view.setHeld('', spot);
    view.update(0.016);
    expect(view.heldProp).toBeNull();
    expect(cup.parent).toBeNull();
    expect(view.root.getObjectByName('fake:cup')).toBeUndefined();

    // Water dispenser: a glass in the hand during an empty-hand drink only.
    view.setActivity('drinking', false);
    view.update(0.016);
    await flush();
    view.update(0.016);
    expect(view.heldProp).toEqual({ kind: 'glass', place: 'hand' });
    view.setActivity('idle', false);
    view.update(0.016);
    expect(view.heldProp).toBeNull();
    view.dispose();
  });
});
