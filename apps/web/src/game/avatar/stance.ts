import * as THREE from 'three';
import { BALANCE } from '@office/protocol';
import { aimBone, dir, frameOf, reachTwoBone, type Rig } from './overlays';

/**
 * FEAT-143: an office stance over the UAL clips. UAL `Idle_Loop` is a combat ready stance
 * (feet wide and staggered, knees bent, arms out) and every retargeted clip tilts the head
 * about 13 degrees down; the owner found both odd on real hardware. The stance overlay
 * narrows the feet, lifts the hips, lowers the arms to the sides and levels the head
 * (`BALANCE.avatar.stance`), blended in by weights like the other overlays.
 *
 * Finger handling (also FEAT-143): the standing and walking clips keep the UAL fists, so
 * their finger tracks are replaced by one relaxed pose (`relaxFingers`), and the right hand
 * closes around a held cup again through `applyGrip`.
 */

const FINGER = /^(Index|Middle|Ring|Pinky|Thumb)\d[LR]$/;
export const isFingerBone = (name: string) => FINGER.test(name);

/**
 * Replaces each finger track of `clip` with a constant pose `curl` of the way from the rest
 * pose (open hand) to the clip's first frame (the UAL fist). Returns a new clip.
 */
export function relaxFingers(
  clip: THREE.AnimationClip,
  bones: THREE.Bone[],
  curl: number,
): THREE.AnimationClip {
  const rest = new Map(bones.map((b) => [b.name, b.quaternion]));
  const tracks = clip.tracks.map((track) => {
    const [name, property] = track.name.split('.');
    const base = name ? rest.get(name) : undefined;
    if (property !== 'quaternion' || !name || !isFingerBone(name) || !base) return track;
    const first = new THREE.Quaternion().fromArray(track.values, 0);
    const pose = base.clone().slerp(first, curl).normalize();
    return new THREE.QuaternionKeyframeTrack(track.name, [0], pose.toArray());
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** The first-frame local rotation of each finger bone in `clip` (the UAL fist). */
export function fingerPose(clip: THREE.AnimationClip): Map<string, THREE.Quaternion> {
  const pose = new Map<string, THREE.Quaternion>();
  for (const track of clip.tracks) {
    const [name, property] = track.name.split('.');
    if (property === 'quaternion' && name && isFingerBone(name))
      pose.set(name, new THREE.Quaternion().fromArray(track.values, 0));
  }
  return pose;
}

/** Closes the right hand's fingers toward `fist` by `weight` (holding a cup). */
export function applyGrip(
  fingers: { bone: THREE.Bone; fist: THREE.Quaternion }[],
  weight: number,
): void {
  if (weight <= 0) return;
  for (const { bone, fist } of fingers) {
    bone.quaternion.slerp(fist, weight).normalize();
    bone.updateWorldMatrix(false, true);
  }
}

/** Rest-pose measurements the stance returns to, taken on a view in its bind pose. */
export type StanceRest = {
  hips: THREE.Bone | null;
  /** Rest hip height above the root (m). */
  hipHeight: number;
  /** Rest distance between the feet across the body (m). */
  footSpread: number;
  /** Root-relative world rotations: head and feet in the rest pose (level, toes forward). */
  head: THREE.Quaternion;
  feet: [THREE.Quaternion, THREE.Quaternion];
  shoulders: { bone: THREE.Bone; rest: THREE.Quaternion }[];
};

const relative = (root: THREE.Object3D, bone: THREE.Object3D | null) => {
  const inverseRoot = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  return bone
    ? inverseRoot.multiply(bone.getWorldQuaternion(new THREE.Quaternion()))
    : new THREE.Quaternion();
};

export function measureStance(root: THREE.Object3D, rig: Rig, bones: THREE.Bone[]): StanceRest {
  root.updateWorldMatrix(true, true);
  const f = frameOf(root, rig);
  const base = root.getWorldPosition(new THREE.Vector3());
  const hips = bones.find((b) => b.name === 'Hips') ?? null;
  const at = (o: THREE.Object3D | undefined) =>
    o ? o.getWorldPosition(new THREE.Vector3()) : base.clone();
  const left = at(rig.legs.left?.foot);
  const right = at(rig.legs.right?.foot);
  return {
    hips,
    hipHeight: at(hips ?? undefined)
      .sub(base)
      .dot(f.up),
    footSpread: Math.abs(right.sub(left).dot(f.right)),
    head: relative(root, rig.head),
    feet: [
      relative(root, rig.legs.left?.foot ?? null),
      relative(root, rig.legs.right?.foot ?? null),
    ],
    shoulders: bones
      .filter((b) => b.name === 'ShoulderL' || b.name === 'ShoulderR')
      .map((bone) => ({ bone, rest: bone.quaternion.clone() })),
  };
}

const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Quaternion();

/** Turns `bone` toward the root-relative world rotation `target` by `weight`. */
function toRelative(
  root: THREE.Object3D,
  bone: THREE.Object3D,
  target: THREE.Quaternion,
  weight: number,
): void {
  const world = root.getWorldQuaternion(tmpQ).multiply(target);
  const local = bone.parent!.getWorldQuaternion(tmpP).invert().multiply(world);
  bone.quaternion.slerp(local, weight).normalize();
  bone.updateWorldMatrix(false, true);
}

/** `hold`: the right hand holds a cup, so its forearm comes forward (`holdBend`). */
export type StanceWeights = { body: number; head: number; hold: number };

/**
 * Applies the office stance: `body` (standing still) narrows and squares the feet, lifts the
 * hips and lowers the arms; `head` (standing or walking) levels the head, which looks around
 * slowly while standing. `time` (s) is the playing clip's own time, so the sway restarts
 * with the clip and loops with it.
 */
export function applyStance(
  root: THREE.Object3D,
  rig: Rig,
  rest: StanceRest,
  time: number,
  w: StanceWeights,
): void {
  const s = BALANCE.avatar.stance;
  if (w.body > 0) {
    const f = frameOf(root, rig);
    const base = root.getWorldPosition(new THREE.Vector3());
    // Hips up toward the rest height, so the narrower legs straighten instead of bending.
    // The clips key the hip position every frame (retarget.ts), so this does not accumulate;
    // thighs parented beside the hips move with them, as in the retarget.
    const hips = rest.hips;
    if (hips) {
      const drop = rest.hipHeight - hips.getWorldPosition(new THREE.Vector3()).sub(base).dot(f.up);
      if (drop > 0) {
        const lift = f.up.clone().multiplyScalar(drop * s.hipLift * w.body);
        const moved = [hips, rig.legs.left?.upper, rig.legs.right?.upper].filter(
          (b): b is THREE.Bone => !!b && (b === hips || b.parent === hips.parent),
        );
        for (const b of moved) {
          const p = b.getWorldPosition(new THREE.Vector3()).add(lift);
          b.position.copy(b.parent!.worldToLocal(p));
          b.updateWorldMatrix(false, true);
        }
      }
    }
    for (const { bone, rest: q } of rest.shoulders) {
      bone.quaternion.slerp(q, w.body).normalize();
      bone.updateWorldMatrix(false, true);
    }
    const legs = [rig.legs.left, rig.legs.right];
    const feet = legs.map((l) => l?.foot.getWorldPosition(new THREE.Vector3()) ?? null);
    const mid = feet[0] && feet[1] ? feet[0].clone().add(feet[1]).multiplyScalar(0.5) : null;
    const midForward = mid ? mid.clone().sub(base).dot(f.forward) : 0;
    const halfWidth = (rest.footSpread * s.footSpread) / 2;
    legs.forEach((l, i) => {
      const foot = feet[i];
      if (!l || !foot) return;
      const side = i === 0 ? -1 : 1;
      const local = foot.clone().sub(base);
      const forward = midForward + (local.dot(f.forward) - midForward) * s.stagger;
      const across = local.dot(f.right);
      const target = base
        .clone()
        .addScaledVector(f.up, local.dot(f.up))
        .addScaledVector(f.forward, forward)
        .addScaledVector(f.right, side * Math.min(Math.abs(across), halfWidth));
      reachTwoBone(l.upper, l.lower, l.foot, target, dir(f, 1, 0, 0), w.body);
      toRelative(root, l.foot, rest.feet[i]!, w.body);
    });
    const sway = s.armSway * Math.sin(time * s.swayHz * 2 * Math.PI);
    const arms = [
      [rig.right, 1],
      [rig.left, -1],
    ] as const;
    for (const [a, side] of arms) {
      if (!a) continue;
      aimBone(a.upper, a.lower, dir(f, sway * side, -1, side * s.armOut), w.body);
      const bend = side === 1 ? s.elbowBend + (s.holdBend - s.elbowBend) * w.hold : s.elbowBend;
      aimBone(a.lower, a.hand, dir(f, bend, -1, side * s.armOut * 0.3), w.body);
      aimBone(a.hand, a.finger, dir(f, bend * 0.5, -1, -side * 0.05), w.body);
    }
  }
  if (w.head > 0 && rig.head) {
    const look = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      s.lookAround * w.body * Math.sin(time * s.lookHz * 2 * Math.PI),
    );
    toRelative(root, rig.head, look.multiply(rest.head), w.head);
  }
}
