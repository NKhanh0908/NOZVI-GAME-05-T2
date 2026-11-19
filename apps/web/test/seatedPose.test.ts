import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { officeLayout, type Activity } from '@office/protocol';
import { AvatarView } from '../src/game/avatar/AvatarView';
import { FURNITURE } from '../src/game/assets/furnitureManifest';
import { fitModel, modelRotY } from '../src/game/assets/loadFurniture';
import { seatPose, seatSocket } from '../src/game/interaction/seats';

// T-1614: the seated avatar's hips rest on the seat cushion (not over the backrest), its feet
// on the floor; hands on the thighs while sitting, at the keyboard while working. The seat is
// measured on the real Kenney model fitted to its layout box, not taken from BALANCE.

afterEach(() => {
  vi.restoreAllMocks();
  AvatarView.clearCache();
});

async function loadLocalGltf(url: string): Promise<GLTF> {
  const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(data, '');
}

/** A seat in its own frame: origin at the socket on the floor, `forward` the way it faces. */
type SeatFrame = { origin: THREE.Vector3; forward: THREE.Vector3; right: THREE.Vector3 };
/** Cushion top height and its extent along `forward`: backrest face to front edge. */
type Cushion = { top: number; back: number; front: number };

function seatFrame(seatId: string): SeatFrame {
  const pose = seatPose(seatSocket(seatId)!);
  const forward = new THREE.Vector3(Math.sin(pose.heading), 0, Math.cos(pose.heading));
  return {
    origin: new THREE.Vector3(pose.x, 0, pose.z),
    forward,
    right: new THREE.Vector3(-forward.z, 0, forward.x),
  };
}

const local = (s: SeatFrame, p: THREE.Vector3) => {
  const d = p.clone().sub(s.origin);
  return { forward: d.dot(s.forward), y: p.y, side: d.dot(s.right) };
};

/** Ray casts on the fitted furniture model under and behind the seat socket. */
async function measureCushion(itemId: string, s: SeatFrame): Promise<Cushion> {
  const box = officeLayout.items.find((i) => i.id === itemId)!;
  const file = FURNITURE[box.type]!;
  const fitted = fitModel(
    (await loadLocalGltf(`/assets/furniture/${file}`)).scene,
    box,
    modelRotY(file, box.rotY),
  );
  fitted.updateMatrixWorld(true);
  fitted.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) for (const m of [mesh.material].flat()) m.side = THREE.DoubleSide;
  });
  const ray = new THREE.Raycaster();
  const at = (forward: number, y: number) =>
    s.origin.clone().addScaledVector(s.forward, forward).setY(y);
  const down = (forward: number) => {
    ray.set(at(forward, 1.2), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(fitted, true)[0]?.point.y ?? null;
  };
  const top = down(0)!;
  expect(top).toBeGreaterThan(0.2);
  let front = 0;
  for (let f = 0; f < 0.6; f += 0.01) {
    const y = down(f);
    if (y === null || Math.abs(y - top) > 0.01) break;
    front = f;
  }
  ray.set(at(0.6, top + 0.2), s.forward.clone().negate());
  const hit = ray.intersectObject(fitted, true)[0];
  expect(hit).toBeDefined();
  return { top, front, back: local(s, hit!.point).forward };
}

/** An avatar placed like the client places a seated employee: root on the socket. */
async function seatedView(avatarId: 'men_suit' | 'women_suit', seatId: string, a: Activity) {
  const view = await AvatarView.load(avatarId);
  const socket = seatSocket(seatId)!;
  const pose = seatPose(socket);
  const mesh = new THREE.Group();
  mesh.add(view.root);
  mesh.position.set(pose.x, 0, pose.z);
  mesh.rotation.y = pose.heading;
  view.setSeat(socket.kind);
  view.setActivity(a, true);
  for (let i = 0; i < 180; i++) view.update(1 / 60); // Sitting_Enter, then the seated loop.
  mesh.updateMatrixWorld(true);
  const at = (name: string) =>
    view.root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
  return { view, at };
}

const SEATS = [
  // [seat, furniture item, activity]: desk chairs facing +X and -X, both sofa seats.
  ['ws_1_seat', 'ws_1_chair', 'sitting'],
  ['ws_2_seat', 'ws_2_chair', 'sitting'],
  ['sofa_seat_1', 'sofa', 'resting'],
  ['sofa_seat_2', 'sofa', 'resting'],
] as const;

describe.each(['men_suit', 'women_suit'] as const)('seated pose on %s (T-1614)', (avatarId) => {
  it.each(SEATS)(
    '%s: hips on the cushion, back at the backrest, feet on the floor',
    async (seatId, itemId, a) => {
      vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(loadLocalGltf);
      const s = seatFrame(seatId);
      const cushion = await measureCushion(itemId, s);
      const { view, at } = await seatedView(avatarId, seatId, a);
      expect(view.seatBlend).toBe(1);
      for (const name of ['Hips', 'UpperLegL', 'UpperLegR']) {
        const p = local(s, at(name));
        // In front of the backrest face, behind the cushion's front edge, a buttock above the top.
        expect(p.forward, `${name} forward`).toBeGreaterThan(cushion.back + 0.03);
        expect(p.forward, `${name} forward`).toBeLessThan(cushion.front);
        expect(p.y, `${name} height`).toBeGreaterThan(cushion.top + 0.03);
        expect(p.y, `${name} height`).toBeLessThan(cushion.top + 0.16);
      }
      // The back is near the backrest: chest within 0.2 m of its face.
      expect(local(s, at('Chest')).forward - cushion.back).toBeLessThan(0.2);
      for (const name of ['FootL', 'FootR']) {
        expect(at(name).y, `${name} height`).toBeGreaterThan(0);
        expect(at(name).y, `${name} height`).toBeLessThan(0.06);
      }
      expect(view.hasFiniteBones()).toBe(true);
      view.dispose();
    },
  );

  it('rests the hands on the thighs while seated and not working', async () => {
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(loadLocalGltf);
    for (const [seatId, , a] of SEATS) {
      const { view, at } = await seatedView(avatarId, seatId, a);
      expect(view.handsRest).toBe(1);
      expect(view.typing).toBe(0);
      for (const side of ['L', 'R']) {
        const hip = at(`UpperLeg${side}`);
        const knee = at(`LowerLeg${side}`);
        const hand = at(`Hand${side}`);
        // Closest point on the thigh bone: the wrist is just above it, between hip and knee.
        const thigh = knee.clone().sub(hip);
        const t = hand.clone().sub(hip).dot(thigh) / thigh.lengthSq();
        expect(t).toBeGreaterThan(0.2);
        expect(t).toBeLessThan(0.8);
        const onThigh = hip.clone().addScaledVector(thigh, t);
        expect(hand.distanceTo(onThigh), `Hand${side} off the thigh`).toBeLessThan(0.12);
        expect(hand.y).toBeGreaterThan(onThigh.y);
      }
      view.dispose();
    }
  });

  it('keeps the typing pose with the hands at the keyboard while working', async () => {
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(loadLocalGltf);
    for (const ws of ['ws_1', 'ws_2']) {
      const deskItem = officeLayout.items.find((i) => i.id === `${ws}_desk`)!;
      const keyboard = deskItem.components!.find((c) => c.type === 'keyboard')!;
      const key = new THREE.Vector3(...keyboard.position);
      const deskTop = deskItem.position[1] + deskItem.size[1] / 2;
      const { view, at } = await seatedView(avatarId, `${ws}_seat`, 'working');
      expect(view.typing).toBe(1);
      expect(view.handsRest).toBe(0);
      for (const side of ['L', 'R']) {
        const hand = at(`Hand${side}`);
        expect(hand.distanceTo(key), `Hand${side} to keyboard`).toBeLessThan(0.2);
        expect(hand.y, `Hand${side} above the desk`).toBeGreaterThan(deskTop);
      }
      view.dispose();
    }
  });
});
