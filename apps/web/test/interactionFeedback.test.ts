import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  BALANCE,
  SeatRegistry,
  officeDecor,
  officeLayout,
  type Activity,
  type Interactable,
} from '@office/protocol';
import { TargetHighlight } from '../src/game/interaction/highlight';
import { Openables, easeOpen } from '../src/game/interaction/openables';
import { swingDoors } from '../src/game/interaction/doorSwing';
import {
  InteractionFeedback,
  modelId,
  type LiftSource,
} from '../src/game/interaction/InteractionFeedback';
import { InteractionController } from '../src/game/interaction/InteractionController';
import { FurnitureLift } from '../src/game/assets/furnitureLift';
import {
  fitModel,
  furniturePlacements,
  instanceModel,
  type FurniturePlacement,
} from '../src/game/assets/loadFurniture';
import { deskProps } from '../src/game/assets/deskProps';
import { decorPlacements } from '../src/game/assets/decorPlacements';
import { promptParts } from '../src/ui/Prompt';

const target = (id: string) => officeLayout.interactables.find((i) => i.id === id)!;

function model(): THREE.Group {
  const root = new THREE.Group();
  const shared = new THREE.MeshStandardMaterial({ color: '#808080' });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), shared);
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), [
    shared,
    new THREE.MeshBasicMaterial(),
  ]);
  body.add(knob);
  root.add(body);
  return root;
}

describe('TargetHighlight (REQ-INT-001, T-1156)', () => {
  it('tints clones and restores the original materials on clear', () => {
    const root = model();
    const [body, knob] = [
      root.children[0] as THREE.Mesh,
      root.children[0]!.children[0] as THREE.Mesh,
    ];
    const bodyMaterial = body.material as THREE.MeshStandardMaterial;
    const knobMaterials = knob.material as THREE.Material[];
    const h = new TargetHighlight('#ff0000', 0.5);
    h.set(root);
    expect(h.current).toBe(root);
    expect(h.tintedMeshes).toBe(2);
    const tinted = body.material as THREE.MeshStandardMaterial;
    expect(tinted).not.toBe(bodyMaterial);
    expect(tinted.emissive.getHexString()).toBe('ff0000');
    expect(tinted.emissiveIntensity).toBe(0.5);
    // The shared material is cloned once and never changed in place.
    expect((knob.material as THREE.Material[])[0]).toBe(tinted);
    expect(bodyMaterial.emissive.getHexString()).toBe('000000');
    // A material without emissive (basic) is kept.
    expect((knob.material as THREE.Material[])[1]).toBe(knobMaterials[1]);
    const dispose = vi.spyOn(tinted, 'dispose');
    h.clear();
    expect(body.material).toBe(bodyMaterial);
    expect(knob.material).toBe(knobMaterials);
    expect(dispose).toHaveBeenCalledOnce();
    expect(h.current).toBeNull();
    expect(h.tintedMeshes).toBe(0);
  });

  it('restores the original materials on dispose and when the target changes', () => {
    const a = model();
    const b = model();
    const aBody = a.children[0] as THREE.Mesh;
    const bBody = b.children[0] as THREE.Mesh;
    const aMaterial = aBody.material;
    const bMaterial = bBody.material;
    const h = new TargetHighlight();
    h.set(a);
    h.set(a);
    expect(aBody.material).not.toBe(aMaterial);
    h.set(b);
    expect(aBody.material).toBe(aMaterial);
    expect(bBody.material).not.toBe(bMaterial);
    h.dispose();
    expect(bBody.material).toBe(bMaterial);
    expect(h.tintedMeshes).toBe(0);
  });
});

describe('Openables (REQ-INT-004/005, local only)', () => {
  const atCabinet = { x: 1.32, z: -0.36, heading: Math.PI };

  it('opens and closes on toggle over openSeconds, eased', () => {
    const o = new Openables();
    expect(o.toggle('storage_cabinet')).toBe(true);
    expect(o.isOpen('storage_cabinet')).toBe(true);
    o.update(BALANCE.interactionView.openSeconds / 2, atCabinet);
    expect(o.progress('storage_cabinet')).toBeCloseTo(0.5);
    o.update(1, atCabinet);
    expect(o.progress('storage_cabinet')).toBe(1);
    expect(o.toggle('storage_cabinet')).toBe(false);
    o.update(1, atCabinet);
    expect(o.progress('storage_cabinet')).toBe(0);
    expect(o.active()).toEqual([]);
    expect(easeOpen(0)).toBe(0);
    expect(easeOpen(0.5)).toBeCloseTo(0.5);
    expect(easeOpen(2)).toBe(1);
  });

  it('closes when the player walks out of range and ignores non-openables', () => {
    const o = new Openables();
    o.toggle('fridge');
    o.toggle('tv');
    expect(o.snapshot()).toEqual({ main_door: false, fridge: true, storage_cabinet: false });
    o.update(0.1, { x: 0.96, z: -3.3, heading: 0 });
    expect(o.isOpen('fridge')).toBe(true);
    o.update(0.1, { x: 0.96, z: -1.2, heading: 0 });
    expect(o.isOpen('fridge')).toBe(false);
    expect(o.kind('fridge')).toBe('fridge');
    expect(o.kind('main_door')).toBe('door');
    expect(o.kind('tv')).toBeUndefined();
  });
});

describe('door leaves of the Kenney models', () => {
  const load = (file: string) =>
    new Promise<THREE.Group>((resolve, reject) => {
      const bytes = readFileSync(new URL(`../public/assets/furniture/${file}`, import.meta.url));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf.scene), reject);
    });

  it.each([
    ['bookcaseClosedDoors.glb', 'storage_cabinet', 2],
    ['kitchenFridge.glb', 'fridge', 2],
    ['doorwayFront.glb', 'main_door', 1],
  ])('%s: %s swings %i leaves toward the room without shearing', async (file, id, leaves) => {
    const box = officeLayout.items.find((i) => i.id === id)!;
    const fitted = fitModel(await load(file), box, box.rotY ?? 0);
    const room = new THREE.Group();
    room.add(fitted);
    const closed = new THREE.Box3().setFromObject(fitted);
    expect(swingDoors(fitted, Math.PI / 2)).toBe(leaves);
    fitted.updateMatrixWorld(true);
    // Open leaves reach out of the front (+z, toward the room) of the closed model.
    expect(new THREE.Box3().setFromObject(fitted).max.z).toBeGreaterThan(closed.max.z + 0.1);
    fitted.traverse((node) => {
      if (node.userData.closedMatrix === undefined) return;
      const e = node.matrixWorld.elements;
      const x = new THREE.Vector3(e[0], e[1], e[2]);
      const z = new THREE.Vector3(e[8], e[9], e[10]);
      expect(Math.abs(x.dot(z))).toBeLessThan(1e-9);
    });
    swingDoors(fitted, 0);
    fitted.updateMatrixWorld(true);
    const back = new THREE.Box3().setFromObject(fitted);
    expect(back.max.z).toBeCloseTo(closed.max.z, 6);
    expect(back.min.x).toBeCloseTo(closed.min.x, 6);
  });
});

describe('FurnitureLift (instanced items, T-1148 / T-1156)', () => {
  const placements: FurniturePlacement[] = [0, 1, 2].map((i) => ({
    box: { id: `c${i}`, type: 'cabinet', position: [i * 2, 1, 0], size: [1, 2, 1] },
    file: 'x.glb',
    rotY: 0,
  }));

  it('lifts one instance into its own model and drops it back', () => {
    const room = new THREE.Group();
    const source = model();
    const meshes = instanceModel(source, placements)!;
    room.add(...meshes);
    const lift = new FurnitureLift(room, fitModel);
    lift.registerInstances(source, placements, meshes);
    const before = new THREE.Matrix4();
    meshes[0]!.getMatrixAt(1, before);
    const result = lift.lift('c1')!;
    expect(result.added).toHaveLength(2);
    expect(result.object.parent).toBe(room);
    const collapsed = new THREE.Matrix4();
    meshes[0]!.getMatrixAt(1, collapsed);
    expect(collapsed.determinant()).toBe(0);
    // The lifted copy sits exactly where the instance was drawn.
    result.object.updateMatrixWorld(true);
    expect((result.added[0] as THREE.Mesh).matrixWorld.equals(before)).toBe(true);
    expect(lift.lift('c1')!.added).toEqual([]);
    expect(lift.drop('c1')).toHaveLength(2);
    const restored = new THREE.Matrix4();
    meshes[0]!.getMatrixAt(1, restored);
    expect(restored.equals(before)).toBe(true);
    expect(result.object.parent).toBeNull();
    expect(lift.lift('missing')).toBeUndefined();
  });

  it('returns a single-model item as is', () => {
    const room = new THREE.Group();
    const object = fitModel(model(), placements[0]!.box, 0);
    const lift = new FurnitureLift(room, fitModel);
    lift.registerObject('c0', object);
    expect(lift.lift('c0')).toEqual({ object, added: [] });
    expect(lift.drop('c0')).toEqual([]);
  });
});

it('every interaction target has a placed model to highlight', () => {
  const ids = new Set(
    [
      ...furniturePlacements(officeLayout),
      ...deskProps(officeLayout).map((p) => p.placement),
      ...decorPlacements(officeDecor),
    ].map((p) => p.box.id),
  );
  for (const t of officeLayout.interactables.filter((i) => i.type !== 'computer')) {
    expect(ids.has(modelId(t)), t.id).toBe(true);
  }
});

describe('InteractionFeedback', () => {
  afterEach(() => vi.useRealTimers());

  function setup(focus: () => Interactable | null) {
    const room = new THREE.Group();
    const objects = new Map<string, THREE.Group>();
    const dropped: string[] = [];
    const furniture: LiftSource = {
      lift: (id) => {
        const known = objects.get(id);
        if (known) return { object: known, added: [] };
        const object = model();
        object.name = id;
        objects.set(id, object);
        room.add(object);
        return { object, added: [object.children[0] as THREE.Mesh] };
      },
      drop: (id) => {
        const object = objects.get(id);
        objects.delete(id);
        dropped.push(id);
        object?.removeFromParent();
        return object ? [object.children[0] as THREE.Mesh] : [];
      },
    };
    const occluders: THREE.Object3D[] = [];
    const releaseOccluders = vi.fn();
    const player = { x: 1.32, z: -0.36, heading: Math.PI };
    const f = new InteractionFeedback({
      focus,
      player: () => player,
      furniture: () => furniture,
      occluders,
      releaseOccluders,
    });
    return { f, occluders, releaseOccluders, dropped, player, objects };
  }

  it('highlights the focus, lifts it while needed and drops it afterwards', () => {
    let focus: Interactable | null = target('storage_cabinet');
    const { f, occluders, releaseOccluders, dropped, objects } = setup(() => focus);
    f.update(0.016);
    expect(f.snapshot()).toMatchObject({
      highlighted: 'storage_cabinet',
      tintedMeshes: 2,
      lifted: ['storage_cabinet'],
    });
    expect(occluders).toHaveLength(1);
    expect(releaseOccluders).toHaveBeenCalled();
    const body = objects.get('storage_cabinet')!.children[0] as THREE.Mesh;
    focus = null;
    f.update(0.016);
    expect(f.snapshot()).toMatchObject({ highlighted: null, tintedMeshes: 0, lifted: [] });
    expect(dropped).toEqual(['storage_cabinet']);
    expect(occluders).toEqual([]);
    expect((body.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('000000');
  });

  it('keeps an open cabinet lifted after focus leaves, until it has swung shut', () => {
    let focus: Interactable | null = target('storage_cabinet');
    const { f, dropped } = setup(() => focus);
    f.toggle(target('storage_cabinet'));
    f.update(1);
    expect(f.snapshot().open.storage_cabinet).toBe(true);
    focus = null;
    f.update(0.016);
    expect(f.snapshot().lifted).toEqual(['storage_cabinet']);
    f.toggle(target('storage_cabinet'));
    f.update(1);
    f.update(0.016);
    expect(f.snapshot().open.storage_cabinet).toBe(false);
    expect(dropped).toEqual(['storage_cabinet']);
  });

  it('swings the main door, then leaves after doorExitSeconds (once)', () => {
    vi.useFakeTimers();
    const { f } = setup(() => null);
    const leave = vi.fn();
    f.exitThroughDoor(target('main_door'), leave);
    f.exitThroughDoor(target('main_door'), leave);
    expect(f.exiting).toBe(true);
    expect(f.snapshot().open.main_door).toBe(true);
    vi.advanceTimersByTime(BALANCE.interactionView.doorExitSeconds * 1000 - 1);
    expect(leave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(leave).toHaveBeenCalledOnce();
  });

  it('dispose cancels a pending exit and drops lifted furniture', () => {
    vi.useFakeTimers();
    const { f, dropped } = setup(() => target('fridge'));
    f.update(0.016);
    const leave = vi.fn();
    f.exitThroughDoor(target('main_door'), leave);
    f.dispose();
    vi.runAllTimers();
    expect(leave).not.toHaveBeenCalled();
    expect(dropped).toEqual(['fridge']);
  });
});

describe('InteractionController.focusTarget (T-1156)', () => {
  const controller = (activity: Activity, state: { x: number; z: number; heading: number }) =>
    new InteractionController({ state, activity }, new SeatRegistry(), 'me', {
      onExit: vi.fn(),
      sendIntent: vi.fn(),
    });

  it('names the faced target only while it offers an action', () => {
    const fridge = { x: 0.96, z: -3.3, heading: Math.PI };
    expect(controller('idle', fridge).focusTarget()?.id).toBe('fridge');
    expect(controller('idle', { ...fridge, heading: 0 }).focusTarget()).toBeNull();
    expect(controller('idle', { x: 0.96, z: -1, heading: 0 }).focusTarget()).toBeNull();
    expect(controller('sitting', fridge).focusTarget()).toBeNull();
    expect(controller('brewing', fridge).focusTarget()).toBeNull();
  });
});

it('promptParts splits key and action for the keycap', () => {
  expect(promptParts('E — Open fridge · F — Sip')).toEqual([
    { key: 'E', action: 'Open fridge' },
    { key: 'F', action: 'Sip' },
  ]);
  expect(promptParts('Desk taken')).toEqual([{ text: 'Desk taken' }]);
});
