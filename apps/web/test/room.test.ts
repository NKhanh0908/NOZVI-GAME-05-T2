import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { officeLayout } from '@office/protocol';
import { buildRoom } from '../src/game/room';

describe('buildRoom', () => {
  const room = buildRoom(officeLayout);
  it('creates one object per wall and item (a mesh, or the procedural AC group, T-1151)', () => {
    for (const box of [...officeLayout.walls, ...officeLayout.items]) {
      const object = room.getObjectByName(box.id);
      if (box.type === 'air_conditioner') expect(object).toBeInstanceOf(THREE.Group);
      else expect(object).toBeInstanceOf(THREE.Mesh);
    }
  });
  it('sizes meshes from world-axis extents without rotation', () => {
    const desk = officeLayout.items.find((i) => i.id === 'ws_1_desk')!;
    const mesh = room.getObjectByName('ws_1_desk') as THREE.Mesh;
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(desk.size[0]);
    expect(size.z).toBeCloseTo(desk.size[2]);
  });
  it('has a floor matching the room', () => {
    const floor = room.getObjectByName('floor') as THREE.Mesh;
    const size = new THREE.Box3().setFromObject(floor).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(12);
    expect(size.z).toBeCloseTo(9.6);
  });
});
