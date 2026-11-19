import * as THREE from 'three';
import { BALANCE } from '@office/protocol';

/**
 * FEAT-143 (owner option A, code only): load-time look fixes for the Quaternius suit
 * avatars, run on the template before its parts are merged (`mergeSkinned.ts`). The
 * triangles and the draw calls stay the same; only normals, a few face vertices and colours
 * change (`BALANCE.avatar.look`).
 *
 * - Shading: the exported flat normals show every facet of the face and suit; each part
 *   gets smoothed normals, keeping edges sharper than `creaseAngle` hard.
 * - Face: the brows are wide dark bars sloping toward the nose and the eyes thin slits, which
 *   reads as a frown. The brows are flattened toward their own centre (`browFlatten`, also
 *   less slant), lifted `browLift` m and blended `browFade` toward the skin colour; the eyes
 *   open `eyeOpen` times taller.
 *
 * The face decals are found by material name; the women's asset calls its brows
 * `Hair_Brown` and its eyes `Brown`.
 */
const BROWS = new Set(['Eyebrows', 'Hair_Brown']);
const EYES = new Set(['Eye', 'Brown']);
const SKIN = 'Skin';

const materialOf = (mesh: THREE.Mesh) =>
  Array.isArray(mesh.material) ? null : (mesh.material as THREE.MeshStandardMaterial);

export function softenAvatar(root: THREE.Object3D): void {
  const parts: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh);
  });
  root.updateMatrixWorld(true);
  const look = BALANCE.avatar.look;
  const skin = parts.map(materialOf).find((m) => m?.name === SKIN)?.color;
  for (const part of parts) {
    const material = materialOf(part);
    const name = material?.name ?? '';
    if (BROWS.has(name)) {
      reshape(part, look.browFlatten, look.browLift);
      if (material && skin) material.color.lerp(skin, look.browFade);
    } else if (EYES.has(name)) {
      reshape(part, look.eyeOpen, 0);
    } else {
      const smooth = creasedNormals(part.geometry, look.creaseAngle);
      part.geometry.dispose();
      part.geometry = smooth;
    }
  }
}

/** Raises the avatar material's roughness to at least `BALANCE.avatar.look.roughness`. */
export function softenMaterial(material: THREE.Material): void {
  const m = material as THREE.MeshStandardMaterial;
  if (m.isMeshStandardMaterial) m.roughness = Math.max(m.roughness, BALANCE.avatar.look.roughness);
}

/**
 * Scales a face decal's vertices vertically by `scale` about the centre of each side's piece
 * (left and right of the face's midline) and moves them up by `lift` m, in the rest pose's
 * world frame. The geometry is replaced by a moved copy.
 */
function reshape(mesh: THREE.Mesh, scale: number, lift: number): void {
  if (scale === 1 && lift === 0) return;
  const geometry = mesh.geometry.clone();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const toWorld = mesh.matrixWorld;
  const toLocal = toWorld.clone().invert();
  const midline = new THREE.Vector3().setFromMatrixPosition(toWorld).x;
  const points = Array.from({ length: position.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(toWorld),
  );
  const centre = (left: boolean) => {
    const side = points.filter((p) => p.x < midline === left);
    return side.reduce((s, p) => s + p.y, 0) / Math.max(1, side.length);
  };
  const centres = { left: centre(true), right: centre(false) };
  points.forEach((p, i) => {
    const c = p.x < midline ? centres.left : centres.right;
    p.y = c + (p.y - c) * scale + lift;
    p.applyMatrix4(toLocal);
    position.setXYZ(i, p.x, p.y, p.z);
  });
  position.needsUpdate = true;
  mesh.geometry.dispose();
  mesh.geometry = geometry;
}

/**
 * A non-indexed copy of `source` (same triangles, same attributes) whose normals average
 * the area-weighted normals of the triangles around each corner that lie within
 * `creaseAngle` of the corner's own triangle. Like three's `toCreasedNormals`, but corners
 * are matched relative to the mesh size: the suit GLBs are in hundredths of a metre, below
 * that helper's fixed 0.01 grid.
 */
export function creasedNormals(
  source: THREE.BufferGeometry,
  creaseAngle: number,
): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const position = geometry.getAttribute('position');
  const count = position.count;
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3()).length() || 1;
  const grid = 1e5 / size;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const faces = count / 3;
  const area = new Float64Array(faces * 3);
  const unit = new Float64Array(faces * 3);
  for (let f = 0; f < faces; f++) {
    a.fromBufferAttribute(position, 3 * f);
    b.fromBufferAttribute(position, 3 * f + 1);
    c.fromBufferAttribute(position, 3 * f + 2);
    const n = c.sub(b).cross(a.sub(b));
    area.set([n.x, n.y, n.z], 3 * f);
    n.normalize();
    unit.set([n.x, n.y, n.z], 3 * f);
  }
  const corners = new Map<string, number[]>();
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)]
      .map((v) => Math.round(v * grid))
      .join(',');
    keys.push(key);
    const list = corners.get(key);
    if (list) list.push(i);
    else corners.set(key, [i]);
  }
  const limit = Math.cos(creaseAngle);
  const normals = new Float32Array(count * 3);
  const sum = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const own = Math.floor(i / 3);
    sum.set(0, 0, 0);
    for (const j of corners.get(keys[i]!)!) {
      const f = Math.floor(j / 3);
      const dot =
        unit[3 * f]! * unit[3 * own]! +
        unit[3 * f + 1]! * unit[3 * own + 1]! +
        unit[3 * f + 2]! * unit[3 * own + 2]!;
      if (dot >= limit) sum.add(c.set(area[3 * f]!, area[3 * f + 1]!, area[3 * f + 2]!));
    }
    if (sum.lengthSq() === 0) sum.set(unit[3 * own]!, unit[3 * own + 1]!, unit[3 * own + 2]!);
    sum.normalize().toArray(normals, 3 * i);
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}
