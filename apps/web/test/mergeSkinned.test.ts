import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeSkinnedMeshes } from '../src/game/avatar/mergeSkinned';
import { AvatarView } from '../src/game/avatar/AvatarView';

afterEach(() => {
  vi.restoreAllMocks();
  AvatarView.clearCache();
});

async function loadLocalGltf(url: string): Promise<GLTF> {
  const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(data, '');
}

const meshesOf = (root: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh));
  return out;
};

it.each(['men_suit', 'women_suit'] as const)(
  'T-1161: merges the %s parts into one skinned mesh with baked colours',
  async (avatarId) => {
    const gltf = await loadLocalGltf(`/assets/avatars/${avatarId}.glb`);
    const parts = meshesOf(gltf.scene) as THREE.SkinnedMesh[];
    expect(parts.length).toBeGreaterThan(1);
    const vertices = parts.reduce(
      (n, p) => n + (p.geometry.index ?? p.geometry.getAttribute('position')).count,
      0,
    );
    const firstColor = (parts[0]!.material as THREE.MeshStandardMaterial).color.clone();
    const bones = parts[0]!.skeleton.bones;

    const merged = mergeSkinnedMeshes(gltf.scene)!;
    expect(merged).not.toBeNull();
    expect(meshesOf(gltf.scene)).toEqual([merged]);
    expect(merged.isSkinnedMesh).toBe(true);
    expect(merged.skeleton.bones).toEqual(bones);
    expect(merged.geometry.getAttribute('position').count).toBe(vertices);
    const material = merged.material as THREE.MeshStandardMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.color.getHex()).toBe(0xffffff);
    const color = merged.geometry.getAttribute('color');
    expect(color.getX(0)).toBeCloseTo(firstColor.r);
    expect(color.getY(0)).toBeCloseTo(firstColor.g);
    expect(color.getZ(0)).toBeCloseTo(firstColor.b);
    // Skin weights stay normalized after the merge.
    const w = merged.geometry.getAttribute('skinWeight');
    for (let i = 0; i < w.count; i += 97)
      expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 3);
  },
);

it('T-1161: leaves parts that differ in more than colour untouched', () => {
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  const part = (roughness: number) => {
    const g = new THREE.BoxGeometry();
    const n = g.getAttribute('position').count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    g.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(
        Array.from({ length: n * 4 }, (_, i) => (i % 4 ? 0 : 1)),
        4,
      ),
    );
    const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ roughness }));
    m.bind(skeleton);
    return m;
  };
  const root = new THREE.Group();
  root.add(bone, part(0.5), part(0.9));
  expect(mergeSkinnedMeshes(root)).toBeNull();
  expect(meshesOf(root)).toHaveLength(2);
});

it('T-1161: an avatar view is one mesh and still animates with finite bones', async () => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(loadLocalGltf);
  const view = await AvatarView.load('men_suit');
  expect(meshesOf(view.root)).toHaveLength(1);
  view.setActivity('walking');
  view.update(0.5);
  expect(view.hasFiniteBones()).toBe(true);
  view.dispose();
});
