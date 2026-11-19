import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BALANCE } from '@office/protocol';
import { AvatarView } from '../src/game/avatar/AvatarView';
import { creasedNormals, softenAvatar } from '../src/game/avatar/look';

// FEAT-143: load-time smooth shading and a softer face on both Quaternius suit rigs.

async function loadLocalGltf(url: string): Promise<GLTF> {
  const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(data, '');
}

afterEach(() => {
  vi.restoreAllMocks();
  AvatarView.clearCache();
});

const meshes = (root: THREE.Object3D) => {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
};
const triangles = (g: THREE.BufferGeometry) =>
  (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/** Share of triangle corners whose normal is tilted off the triangle's own normal. */
function smoothShare(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const index = g.index;
  const at = (i: number) => (index ? index.getX(i) : i);
  const count = index ? index.count : p.count;
  const [a, b, c, normal] = [0, 0, 0, 0].map(() => new THREE.Vector3());
  let tilted = 0;
  for (let t = 0; t < count; t += 3) {
    a!.fromBufferAttribute(p, at(t));
    b!.fromBufferAttribute(p, at(t + 1));
    c!.fromBufferAttribute(p, at(t + 2));
    const face = c!.sub(b!).cross(a!.sub(b!)).normalize();
    for (let k = 0; k < 3; k++) {
      normal!.fromBufferAttribute(n, at(t + k));
      if (normal!.angleTo(face) > 0.05) tilted++;
    }
  }
  return tilted / count;
}

/** World-space height of each side's piece of a face decal (rest pose). */
function decalHeight(mesh: THREE.Mesh): number {
  mesh.updateWorldMatrix(true, false);
  const p = mesh.geometry.getAttribute('position');
  const ys = Array.from({ length: p.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld),
  ).filter((v) => v.x < 0);
  return Math.max(...ys.map((v) => v.y)) - Math.min(...ys.map((v) => v.y));
}

it('creased normals keep a cube hard and round a sphere', () => {
  const cube = creasedNormals(new THREE.BoxGeometry(0.01, 0.01, 0.01), 1.2);
  expect(smoothShare(cube)).toBe(0);
  const sphere = new THREE.SphereGeometry(0.01, 12, 8).toNonIndexed();
  sphere.computeVertexNormals(); // Flat: one normal per triangle.
  expect(smoothShare(sphere)).toBe(0);
  const round = creasedNormals(sphere, 1.2);
  expect(smoothShare(round)).toBeGreaterThan(0.9);
  expect(triangles(round)).toBe(triangles(sphere));
});

describe.each(['men_suit', 'women_suit'] as const)('%s look', (avatarId) => {
  it('smooths the merged avatar without changing triangles or draw calls', async () => {
    const raw = await loadLocalGltf(`/assets/avatars/${avatarId}.glb`);
    const rawTriangles = meshes(raw.scene).reduce((s, m) => s + triangles(m.geometry), 0);
    // The exported normals are mostly flat (per corner, over all parts).
    const rawShare =
      meshes(raw.scene).reduce((s, m) => s + smoothShare(m.geometry) * triangles(m.geometry), 0) /
      rawTriangles;

    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(loadLocalGltf);
    const view = await AvatarView.load(avatarId);
    const parts = meshes(view.root);
    expect(parts).toHaveLength(1); // One draw call per pass (T-1161).
    const merged = parts[0]!;
    expect(triangles(merged.geometry)).toBe(rawTriangles);
    const share = smoothShare(merged.geometry);
    expect(share).toBeGreaterThan(rawShare + 0.2);
    const material = merged.material as THREE.MeshStandardMaterial;
    expect(material.roughness).toBeGreaterThanOrEqual(BALANCE.avatar.look.roughness);
  });

  it('smooths head and body parts and softens brows and eyes', async () => {
    const raw = await loadLocalGltf(`/assets/avatars/${avatarId}.glb`);
    const soft = await loadLocalGltf(`/assets/avatars/${avatarId}.glb`);
    softenAvatar(soft.scene);
    const byName = (root: THREE.Object3D, name: string) =>
      meshes(root).find((m) => m.name === name)!;
    const look = BALANCE.avatar.look;
    for (const name of ['Suit_Head_1', 'Suit_Body_1', 'Suit_Legs']) {
      const before = byName(raw.scene, name);
      const after = byName(soft.scene, name);
      expect(triangles(after.geometry), name).toBe(triangles(before.geometry));
      expect(smoothShare(after.geometry), name).toBeGreaterThan(0.5);
    }
    // Suit_Head_3 is the brows, Suit_Head_4 the eyes, in both assets.
    const brows = [byName(raw.scene, 'Suit_Head_3'), byName(soft.scene, 'Suit_Head_3')];
    const eyes = [byName(raw.scene, 'Suit_Head_4'), byName(soft.scene, 'Suit_Head_4')];
    expect(decalHeight(brows[1]!)).toBeCloseTo(decalHeight(brows[0]!) * look.browFlatten, 6);
    expect(decalHeight(eyes[1]!)).toBeCloseTo(decalHeight(eyes[0]!) * look.eyeOpen, 6);
    const skin = (byName(raw.scene, 'Suit_Head_1').material as THREE.MeshStandardMaterial).color;
    const color = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).color;
    const expected = color(brows[0]!).clone().lerp(skin, look.browFade);
    expect(color(brows[1]!).getHex()).toBe(expected.getHex());
    expect(triangles(brows[1]!.geometry)).toBe(triangles(brows[0]!.geometry));
  });
});
