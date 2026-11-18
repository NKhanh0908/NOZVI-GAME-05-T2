import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { LayoutBox } from '@office/protocol';
import {
  castsShadow,
  fitModel,
  instanceModel,
  type FurniturePlacement,
} from '../src/game/assets/loadFurniture';
import { OccluderHider } from '../src/game/occluderHider';

/** Two-part model like the Kenney desk (body + drawer, separate materials). */
function twoPartModel(): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshStandardMaterial());
  const drawer = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 1),
    new THREE.MeshStandardMaterial(),
  );
  drawer.position.set(0.4, 0.3, -0.2);
  body.add(drawer);
  root.add(body);
  return root;
}

const box = (
  id: string,
  x: number,
  size: [number, number, number] = [0.6, 0.75, 1.2],
): LayoutBox => ({ id, type: 'desk', position: [x, size[1] / 2, 2], size });

const placements = (rotations: number[]): FurniturePlacement[] =>
  rotations.map((rotY, i) => ({ box: box(`ws_${i + 1}_desk`, i * 1.5), file: 'desk.glb', rotY }));

const meshesOf = (root: THREE.Object3D): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  return meshes;
};

it('draws repeated models as one InstancedMesh per part that shares the cached geometry', () => {
  const source = twoPartModel();
  const parts = meshesOf(source);
  const meshes = instanceModel(source, placements([90, 270, 90, 270, 90, 270, 90, 270]))!;
  expect(meshes).toHaveLength(2);
  meshes.forEach((mesh, k) => {
    expect(mesh.isInstancedMesh).toBe(true);
    expect(mesh.count).toBe(8);
    expect(mesh.geometry).toBe(parts[k]!.geometry);
    expect(mesh.material).toBe(parts[k]!.material);
    expect(mesh.userData.occluder).toBe(true);
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
  });
  expect(meshes[0]!.userData.instanceIds).toHaveLength(8);
});

it('places every instance exactly where fitModel puts the per-item copy', () => {
  const source = twoPartModel();
  const list = placements([90, 270, 0, 180]);
  const meshes = instanceModel(source, list)!;
  list.forEach((p, i) => {
    const fitted = fitModel(source, p.box, p.rotY);
    fitted.updateMatrixWorld(true);
    const expected = meshesOf(fitted).map((m) => m.matrixWorld);
    meshes.forEach((mesh, k) => {
      const actual = new THREE.Matrix4();
      mesh.getMatrixAt(i, actual);
      actual.elements.forEach((v, j) => expect(v).toBeCloseTo(expected[k]!.elements[j]!, 6));
    });
  });
});

it('keeps per-item meshes when an instance matrix would shear (instanced normals are inexact)', () => {
  expect(instanceModel(twoPartModel(), placements([37, 90]))).toBeUndefined();
});

it('lets only furniture of at least 0.05 m³ cast shadows', () => {
  expect(castsShadow(box('plant', 0, [0.35, 0.9, 0.35]))).toBe(true);
  expect(castsShadow(box('keyboard', 0, [0.45, 0.03, 0.15]))).toBe(false);
  const small = placements([0, 0]).map((p) => ({
    ...p,
    box: box(p.box.id, 0, [0.45, 0.03, 0.15]),
  }));
  for (const mesh of instanceModel(twoPartModel(), small)!) expect(mesh.castShadow).toBe(false);
  const fitted = fitModel(twoPartModel(), box('mouse', 0, [0.06, 0.03, 0.1]), 0);
  for (const mesh of meshesOf(fitted)) expect(mesh.castShadow).toBe(false);
});

it('releases instance buffers on dispose', () => {
  const [mesh] = instanceModel(twoPartModel(), placements([0, 90]))!;
  const disposed = vi.fn();
  mesh!.addEventListener('dispose', disposed);
  mesh!.dispose();
  expect(disposed).toHaveBeenCalledTimes(1);
});

it('hides one camera-occluding instance per frame and restores it', () => {
  const [mesh] = instanceModel(twoPartModel(), placements([0, 90]))!;
  const plain = new THREE.Mesh(new THREE.BoxGeometry());
  const before = new THREE.Matrix4();
  mesh!.getMatrixAt(1, before);
  const hider = new OccluderHider();
  hider.hide({ object: mesh!, instanceId: 1, distance: 1, point: new THREE.Vector3() });
  hider.hide({ object: mesh!, instanceId: 1, distance: 2, point: new THREE.Vector3() });
  hider.hide({ object: plain, distance: 1, point: new THREE.Vector3() });
  const hidden = new THREE.Matrix4();
  mesh!.getMatrixAt(1, hidden);
  // Zero scale and translation: every vertex of the instance collapses to the origin.
  expect(hidden.elements.slice(0, 15).every((v) => v === 0)).toBe(true);
  const other = new THREE.Matrix4();
  mesh!.getMatrixAt(0, other);
  expect(other.determinant()).not.toBe(0);
  expect(plain.visible).toBe(false);
  hider.restore();
  const after = new THREE.Matrix4();
  mesh!.getMatrixAt(1, after);
  expect(after.equals(before)).toBe(true);
  expect(plain.visible).toBe(true);
});
