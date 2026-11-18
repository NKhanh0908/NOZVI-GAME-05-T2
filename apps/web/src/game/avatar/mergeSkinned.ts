import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * T-1161: merges every skinned mesh under `root` into one skinned mesh with one material, so
 * an avatar costs one draw call per pass instead of one per material primitive (10 for the
 * Quaternius suits). Each part's base colour is baked into a vertex colour (multiplied with
 * any existing vertex colour), so the look is unchanged as long as the parts differ only in
 * colour. Returns null and leaves `root` untouched when that does not hold: parts on different
 * skeletons or bind matrices, textured parts, or parts with different roughness / metalness.
 *
 * Positions stay in bind space: with the default attached bind mode a skinned mesh's own
 * transform cancels out, so parts under differently transformed nodes merge as they are.
 */
export function mergeSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh | null {
  const parts: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh);
  });
  if (parts.length < 2) return null;
  const first = parts[0]!;
  const bones = first.skeleton.bones;
  const base = materialOf(first);
  if (!base) return null;
  for (const part of parts) {
    const m = materialOf(part);
    if (
      !m ||
      m.map ||
      m.roughness !== base.roughness ||
      m.metalness !== base.metalness ||
      part.bindMode !== first.bindMode ||
      !part.bindMatrix.equals(first.bindMatrix) ||
      part.skeleton.bones.length !== bones.length ||
      part.skeleton.bones.some((b, i) => b !== bones[i])
    )
      return null;
  }

  const geometries = parts.map((part) => withBakedColor(part.geometry, materialOf(part)!.color));
  const geometry = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  if (!geometry) return null;

  const material = base.clone();
  material.name = 'avatar';
  material.color.set(0xffffff);
  material.vertexColors = true;
  const merged = new THREE.SkinnedMesh(geometry, material);
  merged.name = 'avatar';
  merged.castShadow = parts.some((p) => p.castShadow);
  merged.receiveShadow = parts.some((p) => p.receiveShadow);
  merged.frustumCulled = parts.every((p) => p.frustumCulled);
  merged.bind(first.skeleton, first.bindMatrix);
  (first.parent ?? root).add(merged);
  for (const part of parts) {
    part.removeFromParent();
    part.geometry.dispose();
    materialOf(part)?.dispose();
  }
  return merged;
}

function materialOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial | null {
  const m = mesh.material;
  return !Array.isArray(m) && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? (m as THREE.MeshStandardMaterial)
    : null;
}

/** A non-indexed copy with the same attribute set for every part and colour baked in. */
function withBakedColor(source: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const g = source.index ? source.toNonIndexed() : source.clone();
  const count = g.getAttribute('position').count;
  const old = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r * (old ? old.getX(i) : 1);
    colors[i * 3 + 1] = color.g * (old ? old.getY(i) : 1);
    colors[i * 3 + 2] = color.b * (old ? old.getZ(i) : 1);
  }
  const skinIndex = g.getAttribute('skinIndex');
  const skinWeight = g.getAttribute('skinWeight');
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setAttribute('normal', g.getAttribute('normal'));
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(vec4(skinIndex, count), 4));
  out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(vec4(skinWeight, count), 4));
  g.dispose();
  return out;
}

/** The attribute's four components per vertex, denormalized when stored normalized. */
function vec4(
  a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  count: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(a.getX(i), a.getY(i), a.getZ(i), a.getW(i));
  return out;
}
