import { expect, it } from 'vitest';
import * as THREE from 'three';
import { officeLayout } from '@office/protocol';
import { buildRoom } from '../src/game/room';
import {
  airConditioner,
  buildShellDetails,
  ceilingGeometry,
  doorHeaderGeometry,
  skirtingGeometry,
  windowGeometry,
} from '../src/game/roomDetails';

const bounds = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

it('T-1151: window frames, glass, skirting, ceiling panels and sign are one merged mesh each', () => {
  const details = buildShellDetails(officeLayout);
  expect(details.map((d) => d.name).sort()).toEqual([
    'shell:ceiling-panels',
    'shell:door-headers',
    'shell:sign',
    'shell:skirting',
    'shell:window-frames',
    'shell:window-glass',
  ]);
  for (const d of details) {
    expect((d as THREE.Mesh).isMesh).toBe(true);
    expect(d.castShadow).toBe(false);
  }
});

it('T-1151: details stay inside the room on the inner wall faces', () => {
  const { width, depth, height } = officeLayout.room;
  const parts = [
    ...skirtingGeometry(officeLayout),
    ...windowGeometry(officeLayout).frame,
    ...windowGeometry(officeLayout).glass,
    ...ceilingGeometry(officeLayout),
  ];
  for (const g of parts) {
    const b = bounds(g);
    expect(b.min.x).toBeGreaterThanOrEqual(-width / 2 - 1e-6);
    expect(b.max.x).toBeLessThanOrEqual(width / 2 + 1e-6);
    expect(b.min.z).toBeGreaterThanOrEqual(-depth / 2 - 1e-6);
    expect(b.max.z).toBeLessThanOrEqual(depth / 2 + 1e-6);
    expect(b.max.y).toBeLessThanOrEqual(height + 1e-6);
  }
  // One skirting run per wall segment.
  expect(skirtingGeometry(officeLayout)).toHaveLength(officeLayout.walls.length);
  // The south window glass sits in front of the south wall's inner face (z = 4.70).
  const glass = bounds(windowGeometry(officeLayout).glass[0]!);
  expect(glass.max.z).toBeLessThan(4.7);
  expect(glass.max.z).toBeGreaterThan(4.69);
});

it('T-1151: the air conditioner fills its layout box and faces into the room', () => {
  const item = officeLayout.items.find((i) => i.type === 'air_conditioner')!;
  const ac = airConditioner(item);
  ac.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(ac);
  const size = b.getSize(new THREE.Vector3());
  expect(size.x).toBeCloseTo(item.size[0], 1);
  expect(size.z).toBeCloseTo(item.size[2], 1);
  // Front (+Z local) points toward the room centre (east wall: -X).
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(ac.quaternion);
  expect(front.x).toBeLessThan(-0.99);
});

it('T-1151: buildRoom has no palette box for the air conditioner and keeps the door boxes for the model swap', () => {
  const room = buildRoom(officeLayout);
  const ac = room.getObjectByName('air_conditioner')!;
  expect((ac as THREE.Mesh).isMesh).toBeFalsy();
  expect(room.getObjectByName('main_door')).toBeDefined();
  expect(room.getObjectByName('east_utility_door')).toBeDefined();
});

it('T-1151: wall pieces close the gap between each door top and the ceiling', () => {
  const headers = doorHeaderGeometry(officeLayout);
  expect(headers).toHaveLength(2);
  for (const g of headers) {
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeCloseTo(officeLayout.room.height);
  }
});
