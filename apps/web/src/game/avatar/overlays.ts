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
export type Leg = { upper: THREE.Bone; lower: THREE.Bone; foot: THREE.Bone };
export type Rig = {
  left: Arm | null;
  right: Arm | null;
  /** Legs by side (T-1614): seated feet planting and hands on the thighs. */
  legs: { left: Leg | null; right: Leg | null };
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

function leg(bones: THREE.Bone[], side: 'L' | 'R'): Leg | null {
  const find = (name: string) => bones.find((b) => b.name === name);
  const upper = find(`UpperLeg${side}`);
  const lower = find(`LowerLeg${side}`);
  const foot = find(`Foot${side}`);
  return upper && lower && foot ? { upper, lower, foot } : null;
}

export function findRig(bones: THREE.Bone[]): Rig {
  const find = (name: string) => bones.find((b) => b.name === name) ?? null;
  return {
    left: arm(bones, 'L'),
    right: arm(bones, 'R'),
    legs: { left: leg(bones, 'L'), right: leg(bones, 'R') },
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
  // Repeated products drift off unit length, which shows up as a small rotation in angleTo.
  bone.quaternion.normalize();
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
 * REQ-AVATAR-002 typing while `working` (T-1219): the wrists go to the keyboard and the
 * hands tap in alternation (`BALANCE.avatar.typing`). Since T-1614 the wrists reach a fixed
 * spot in the seat frame (`wrist`: forward of and above the seat socket, the root), so the
 * hands stay on the keyboard whatever the rig's seated shoulder height; elbows down and out.
 * `time` is the view's own clock in seconds.
 */
export function applyTyping(root: THREE.Object3D, rig: Rig, time: number, weight: number): void {
  if (weight <= 0) return;
  const f = frameOf(root, rig);
  const { tapHz, tapDepth, wrist, elbowOut, handsIn } = BALANCE.avatar.typing;
  const base = root.getWorldPosition(new THREE.Vector3());
  const sides = [
    [rig.right, 1, 0],
    [rig.left, -1, Math.PI],
  ] as const;
  for (const [a, side, phase] of sides) {
    if (!a) continue;
    const tap = Math.max(0, Math.sin(time * tapHz * 2 * Math.PI + phase)) * tapDepth;
    const target = base
      .clone()
      .addScaledVector(f.forward, wrist.forward)
      .addScaledVector(f.up, wrist.height + tap * 0.04)
      .addScaledVector(f.right, side * wrist.side);
    reachTwoBone(a.upper, a.lower, a.hand, target, dir(f, -0.2, -1, side * elbowOut), weight);
    aimBone(a.hand, a.finger, dir(f, 1, -0.35 - tap, -side * handsIn * 0.5), weight);
  }
}

/**
 * REQ-INT-003 make-coffee motion while `brewing` (T-1611): both upper arms reach forward and
 * down to the machine on the counter, the left hand holds the cup under the spout and the
 * right hand presses the machine's button periodically (`BALANCE.avatar.brew`). `time` is the
 * view's own clock in seconds.
 */
export function applyBrew(root: THREE.Object3D, rig: Rig, time: number, weight: number): void {
  if (weight <= 0) return;
  const f = frameOf(root, rig);
  const { pressHz, pressDepth, reach, elbowOut, handsIn } = BALANCE.avatar.brew;
  const press = Math.max(0, Math.sin(time * pressHz * 2 * Math.PI)) ** 2 * pressDepth;
  const left = rig.left;
  if (left) {
    aimBone(left.upper, left.lower, dir(f, reach, -1, -elbowOut), weight);
    aimBone(left.lower, left.hand, dir(f, 1, -0.05, handsIn), weight);
    aimBone(left.hand, left.finger, dir(f, 1, -0.1, handsIn * 0.5), weight);
  }
  const right = rig.right;
  if (right) {
    aimBone(right.upper, right.lower, dir(f, reach, -1 + press * 0.3, elbowOut), weight);
    aimBone(right.lower, right.hand, dir(f, 1, 0.3 - press, -handsIn), weight);
    aimBone(right.hand, right.finger, dir(f, 1, -0.2 - press * 1.5, -handsIn * 0.5), weight);
  }
}

/**
 * REQ-INT-003 sip while `drinking` (T-1154): the right hand comes up in front of the mouth
 * with the cup or glass it holds, standing or seated.
 */
export function applySip(root: THREE.Object3D, rig: Rig, weight: number): void {
  const a = rig.right;
  if (weight <= 0 || !a) return;
  const f = frameOf(root, rig);
  aimBone(a.upper, a.lower, dir(f, 0.55, -0.6, 0.3), weight);
  aimBone(a.lower, a.hand, dir(f, 0.2, 1, -0.55), weight);
  aimBone(a.hand, a.finger, dir(f, 0.6, 0.6, -0.2), weight);
}

const MAX_EXTENSION = 0.97;

/**
 * Two-bone reach: turns `upper` and `lower` so `end` gets to the world `target` (clamped to
 * the chain's length), the middle joint bending toward the world direction `pole`. Blended
 * from the current pose by `weight` like `aimBone`.
 */
export function reachTwoBone(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  weight: number,
): void {
  if (weight <= 0) return;
  const a = upper.getWorldPosition(new THREE.Vector3());
  const l1 = lower.getWorldPosition(new THREE.Vector3()).distanceTo(a);
  const l2 = end.getWorldPosition(new THREE.Vector3()).distanceTo(lower.getWorldPosition(tmpA));
  const axis = target.clone().sub(a);
  // A fully straight chain is singular (the bend flips with tiny target moves), so the
  // reach stops at `MAX_EXTENSION` of the chain's length.
  const d = THREE.MathUtils.clamp(
    axis.length(),
    Math.abs(l1 - l2) + 1e-4,
    (l1 + l2) * MAX_EXTENSION,
  );
  axis.normalize();
  const bend = pole.clone().addScaledVector(axis, -pole.dot(axis));
  if (bend.lengthSq() < 1e-8) return;
  bend.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const joint = a
    .clone()
    .addScaledVector(axis, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
  aimBone(upper, lower, joint.sub(a).normalize(), weight);
  const reached = a.addScaledVector(axis, d);
  aimBone(lower, end, reached.sub(lower.getWorldPosition(tmpB)).normalize(), weight);
}

/**
 * T-1614: plants a seated avatar's feet. Each foot keeps where the clip puts it across the
 * floor but is moved to `footY` (the rig's rest foot height, world y) and keeps its world
 * orientation; the knee bends forward as needed. Run after the seat offset moved the model.
 */
export function applySeatedLegs(
  root: THREE.Object3D,
  rig: Rig,
  footY: number,
  weight: number,
): void {
  if (weight <= 0) return;
  const f = frameOf(root, rig);
  for (const l of [rig.legs.left, rig.legs.right]) {
    if (!l) continue;
    const keep = l.foot.getWorldQuaternion(new THREE.Quaternion());
    const target = l.foot.getWorldPosition(new THREE.Vector3());
    target.y = footY;
    reachTwoBone(l.upper, l.lower, l.foot, target, dir(f, 1, 0.5, 0), weight);
    l.foot.parent!.getWorldQuaternion(tmpParent).invert();
    const local = tmpParent.multiply(keep);
    l.foot.quaternion.slerp(local, weight);
    l.foot.updateWorldMatrix(false, true);
  }
}

/**
 * T-1614: seated and not working, the hands rest on the thighs: each wrist goes
 * `BALANCE.avatar.sit.thighAlong` of the way from hip to knee on its own side,
 * `thighLift` above the thigh bone, elbows back and out; fingers follow the thigh.
 */
export function applyRestHands(root: THREE.Object3D, rig: Rig, weight: number): void {
  if (weight <= 0) return;
  const f = frameOf(root, rig);
  const { thighAlong, thighLift } = BALANCE.avatar.sit;
  const sides = [
    [rig.right, rig.legs.right, 1],
    [rig.left, rig.legs.left, -1],
  ] as const;
  for (const [a, l, side] of sides) {
    if (!a || !l) continue;
    const hip = l.upper.getWorldPosition(new THREE.Vector3());
    const knee = l.lower.getWorldPosition(new THREE.Vector3());
    const target = hip.clone().lerp(knee, thighAlong).addScaledVector(f.up, thighLift);
    reachTwoBone(a.upper, a.lower, a.hand, target, dir(f, -1, -0.3, side * 0.8), weight);
    const thigh = knee.sub(hip).normalize().addScaledVector(f.up, -0.3);
    aimBone(a.hand, a.finger, thigh.normalize(), weight);
  }
}

/** Rotates `bone` by `angle` (rad) about the world `axis`, on top of its current pose. */
export function turnBone(bone: THREE.Object3D | null, axis: THREE.Vector3, angle: number): void {
  if (!bone || angle === 0) return;
  const world = bone.getWorldQuaternion(tmpQ);
  world.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  bone.parent!.getWorldQuaternion(tmpParent).invert();
  bone.quaternion.copy(world.premultiply(tmpParent));
  bone.updateWorldMatrix(false, true);
}

/** World axis for leaning or nodding: a positive angle bends the bone forward. */
const leanAxis = (f: Frame) => new THREE.Vector3().crossVectors(f.up, f.forward).normalize();
const wave = (time: number, hz: number, phase = 0) => Math.sin(time * hz * 2 * Math.PI + phase);

/** Emotes drawn as overlays (plan §3.7); `wave` keeps the Phase 2 arm override in AvatarView. */
export type OverlayEmote = 'think' | 'laugh' | 'stretch';

/** `think`: right hand to the chin, head tilted down (REQ-AVATAR-004, T-1222). */
function applyThink(root: THREE.Object3D, rig: Rig, time: number, weight: number): void {
  const f = frameOf(root, rig);
  const { headNod } = BALANCE.avatar.emote.think;
  const a = rig.right;
  if (a) {
    aimBone(a.upper, a.lower, dir(f, 0.6, -0.55, 0.25), weight);
    aimBone(a.lower, a.hand, dir(f, 0.15, 1, -0.75), weight);
    aimBone(a.hand, a.finger, dir(f, 0.35, 1, -0.2), weight);
  }
  turnBone(rig.head, leanAxis(f), (headNod + 0.05 * wave(time, 0.4)) * weight);
}

/** `laugh`: chest and head shake, leaning back (REQ-AVATAR-004, T-1222). */
function applyLaugh(root: THREE.Object3D, rig: Rig, time: number, weight: number): void {
  const f = frameOf(root, rig);
  const { hz, chest, head } = BALANCE.avatar.emote.laugh;
  const lean = leanAxis(f);
  turnBone(rig.chest, lean, (-chest + chest * wave(time, hz)) * weight);
  turnBone(rig.head, lean, (-head * 0.5 + head * wave(time, hz, 0.6)) * weight);
  turnBone(rig.head, f.forward, head * 0.4 * wave(time, hz / 2) * weight);
}

/** `stretch`: both arms raised overhead, chest leaning back and swaying (T-1222). */
function applyStretch(root: THREE.Object3D, rig: Rig, time: number, weight: number): void {
  const f = frameOf(root, rig);
  const { swayHz, sway, lean } = BALANCE.avatar.emote.stretch;
  turnBone(rig.chest, leanAxis(f), -lean * weight);
  turnBone(rig.chest, f.forward, sway * wave(time, swayHz) * weight);
  const sides = [
    [rig.right, 1],
    [rig.left, -1],
  ] as const;
  for (const [a, side] of sides) {
    if (!a) continue;
    aimBone(a.upper, a.lower, dir(f, 0.05, 1, side * 0.3), weight);
    aimBone(a.lower, a.hand, dir(f, 0, 1, -side * 0.15), weight);
    aimBone(a.hand, a.finger, dir(f, 0, 1, 0), weight);
  }
}

export const EMOTE_OVERLAYS: Record<
  OverlayEmote,
  (root: THREE.Object3D, rig: Rig, time: number, weight: number) => void
> = { think: applyThink, laugh: applyLaugh, stretch: applyStretch };

/** Moves `weight` toward `target` at a rate that covers 0 to 1 in `seconds`. */
export function approach(weight: number, target: number, dt: number, seconds: number): number {
  const step = seconds > 0 ? dt / seconds : 1;
  return target > weight ? Math.min(target, weight + step) : Math.max(target, weight - step);
}
