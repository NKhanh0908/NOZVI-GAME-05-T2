import * as THREE from 'three';
import { BALANCE } from '@office/protocol';

/**
 * Procedural bone overlays drawn on top of the retargeted UAL clips (plan phase-4.1 §3.7,
 * owner option (a)). Each overlay reads the pose the mixer just wrote, aims a few bones in
 * world space and blends the result in by a weight, so a weight of 0 leaves the clip pose
 * untouched. Bone names are the GLTFLoader-sanitized Modular Suit names (`UpperArm.R` →
 * `UpperArmR`), shared by both presets.
 */
export type Arm = { upper: THREE.Bone; lower: THREE.Bone; hand: THREE.Bone; finger: THREE.Bone };
export type Rig = {
  left: Arm | null;
  right: Arm | null;
  chest: THREE.Bone | null;
  neck: THREE.Bone | null;
  head: THREE.Bone | null;
};

function arm(bones: THREE.Bone[], side: 'L' | 'R'): Arm | null {
  const find = (name: string) => bones.find((b) => b.name === name);
  const upper = find(`UpperArm${side}`);
  const lower = find(`LowerArm${side}`);
  const hand = find(`Hand${side}`);
  const finger = hand?.children.find((c): c is THREE.Bone => (c as THREE.Bone).isBone);
  return upper && lower && hand && finger ? { upper, lower, hand, finger } : null;
}

export function findRig(bones: THREE.Bone[]): Rig {
  const find = (name: string) => bones.find((b) => b.name === name) ?? null;
  return {
    left: arm(bones, 'L'),
    right: arm(bones, 'R'),
    chest: find('Chest'),
    neck: find('Neck'),
    head: find('Head'),
  };
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpParent = new THREE.Quaternion();
const tmpBase = new THREE.Quaternion();

/**
 * Turns `bone` so the segment from it to `end` points along the world `direction`, blended
 * from the current pose by `weight` (0 keeps the pose, 1 reaches the direction).
 */
export function aimBone(
  bone: THREE.Object3D,
  end: THREE.Object3D,
  direction: THREE.Vector3,
  weight: number,
): void {
  if (weight <= 0) return;
  const current = end.getWorldPosition(tmpA).sub(bone.getWorldPosition(tmpB)).normalize();
  tmpBase.copy(bone.quaternion);
  const world = bone.getWorldQuaternion(tmpQ);
  world.premultiply(new THREE.Quaternion().setFromUnitVectors(current, direction));
  bone.parent!.getWorldQuaternion(tmpParent).invert();
  bone.quaternion.copy(world.premultiply(tmpParent));
  if (weight < 1) bone.quaternion.copy(tmpBase.slerp(bone.quaternion, weight));
  bone.updateWorldMatrix(false, true);
}

/** Avatar-relative world axes: forward, up and the unit vector toward the avatar's right. */
export type Frame = { forward: THREE.Vector3; up: THREE.Vector3; right: THREE.Vector3 };

export function frameOf(root: THREE.Object3D, rig: Rig): Frame {
  root.updateWorldMatrix(true, true);
  const heading = root.getWorldQuaternion(new THREE.Quaternion());
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(heading);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(heading);
  // The right side is read from the skeleton, so the overlay does not depend on the rig's
  // handedness convention.
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(heading);
  if (rig.left && rig.right) {
    const across = rig.right.upper
      .getWorldPosition(new THREE.Vector3())
      .sub(rig.left.upper.getWorldPosition(new THREE.Vector3()));
    across.sub(up.clone().multiplyScalar(across.dot(up)));
    if (across.lengthSq() > 1e-8) right.copy(across.normalize());
  }
  return { forward, up, right };
}

/** Direction from forward / up / right components, normalized. */
export function dir(f: Frame, forward: number, up: number, right: number): THREE.Vector3 {
  return new THREE.Vector3()
    .addScaledVector(f.forward, forward)
    .addScaledVector(f.up, up)
    .addScaledVector(f.right, right)
    .normalize();
}

/**
 * REQ-AVATAR-002 typing while `working` (T-1219): both upper arms reach forward to the desk,
 * forearms point at the keyboard and the hands tap in alternation
 * (`BALANCE.avatar.typing`). `time` is the view's own clock in seconds.
 */
export function applyTyping(root: THREE.Object3D, rig: Rig, time: number, weight: number): void {
  if (weight <= 0) return;
  const f = frameOf(root, rig);
  const { tapHz, tapDepth, reach, elbowOut, handsIn } = BALANCE.avatar.typing;
  const sides = [
    [rig.right, 1, 0],
    [rig.left, -1, Math.PI],
  ] as const;
  for (const [a, side, phase] of sides) {
    if (!a) continue;
    const tap = Math.max(0, Math.sin(time * tapHz * 2 * Math.PI + phase)) * tapDepth;
    aimBone(a.upper, a.lower, dir(f, reach, -1, side * elbowOut), weight);
    aimBone(a.lower, a.hand, dir(f, 1, -0.12 - tap * 0.5, -side * handsIn), weight);
    aimBone(a.hand, a.finger, dir(f, 1, -0.35 - tap, -side * handsIn * 0.5), weight);
  }
}

/** Moves `weight` toward `target` at a rate that covers 0 to 1 in `seconds`. */
export function approach(weight: number, target: number, dt: number, seconds: number): number {
  const step = seconds > 0 ? dt / seconds : 1;
  return target > weight ? Math.min(target, weight + step) : Math.max(target, weight - step);
}
