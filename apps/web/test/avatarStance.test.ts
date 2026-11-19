import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { AvatarView, CLIP_FOR } from '../src/game/avatar/AvatarView';
import { findSkinnedMesh, retargetClipFromRestPose } from '../src/game/avatar/retarget';
import { isFingerBone } from '../src/game/avatar/stance';

// FEAT-143: office stance, open hands and formal walk on both Quaternius suit rigs.

async function loadLocalGltf(url: string): Promise<GLTF> {
  const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(data, '');
}

afterEach(() => {
  vi.restoreAllMocks();
  AvatarView.clearCache();
});

type Pose = {
  spread: number;
  /** Head pitch against the rest pose (rad, negative = looking down). */
  pitch: number;
  /** Mean angle of the left / right finger bones from their rest rotation (rad). */
  curl: { left: number; right: number };
};

/** Bind-pose head rotation and finger rotations, read before the mixer first runs. */
function restOf(view: AvatarView) {
  const bones = bonesOf(view);
  view.root.updateWorldMatrix(true, true);
  const head = bones.find((b) => b.name === 'Head')!.getWorldQuaternion(new THREE.Quaternion());
  const fingers = new Map(
    bones.filter((b) => isFingerBone(b.name)).map((b) => [b.name, b.quaternion.clone()]),
  );
  return { head, fingers };
}

function bonesOf(view: AvatarView): THREE.Bone[] {
  return findSkinnedMesh(view.root)!.skeleton.bones;
}

function poseOf(bones: THREE.Bone[], root: THREE.Object3D, rest: ReturnType<typeof restOf>): Pose {
  root.updateWorldMatrix(true, true);
  const bone = (n: string) => bones.find((b) => b.name === n)!;
  const at = (n: string) => bone(n).getWorldPosition(new THREE.Vector3());
  const turn = bone('Head')
    .getWorldQuaternion(new THREE.Quaternion())
    .multiply(rest.head.clone().invert());
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
  const curl = (side: 'L' | 'R') => {
    const list = [...rest.fingers].filter(([n]) => n.endsWith(side));
    const sum = list.reduce((s, [n, q]) => s + bone(n).quaternion.angleTo(q), 0);
    return sum / list.length;
  };
  return {
    spread: Math.abs(at('FootL').x - at('FootR').x),
    pitch: Math.asin(forward.y),
    curl: { left: curl('L'), right: curl('R') },
  };
}

/** The raw retargeted UAL clip on the bare rig (the look before FEAT-143). */
async function rawPose(avatarId: 'men_suit' | 'women_suit', clipName: string, t: number) {
  const [gltf, ual] = await Promise.all([
    loadLocalGltf(`/assets/avatars/${avatarId}.glb`),
    loadLocalGltf('/assets/anim/ual.glb'),
  ]);
  const mesh = findSkinnedMesh(gltf.scene)!;
  mesh.skeleton.pose();
  gltf.scene.updateMatrixWorld(true);
  const bones = mesh.skeleton.bones;
  const head = bones.find((b) => b.name === 'Head')!.getWorldQuaternion(new THREE.Quaternion());
  const fingers = new Map(
    bones.filter((b) => isFingerBone(b.name)).map((b) => [b.name, b.quaternion.clone()]),
  );
  const source = ual.animations.find((c) => c.name === clipName)!;
  const clip = retargetClipFromRestPose(
    mesh,
    findSkinnedMesh(ual.scene)!,
    source,
    avatarId === 'women_suit',
  );
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(clip).play();
  mixer.setTime(t);
  return poseOf(bones, gltf.scene, { head, fingers });
}

async function viewPose(
  avatarId: 'men_suit' | 'women_suit',
  setup: (v: AvatarView) => void,
  seconds = 2,
) {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(loadLocalGltf);
  const view = await AvatarView.load(avatarId, {
    loadProp: () => Promise.resolve(new THREE.Group()),
  });
  const rest = restOf(view);
  setup(view);
  for (let i = 0; i < seconds * 30; i++) view.update(1 / 30);
  return { view, rest, pose: poseOf(bonesOf(view), view.root, rest) };
}

it('walks with the formal UAL walk', () => {
  expect(CLIP_FOR.walking.clip).toBe('Walk_Formal_Loop');
});

describe.each(['men_suit', 'women_suit'] as const)('%s office stance', (avatarId) => {
  it('stands with open hands, a narrower stance and a level head', async () => {
    const before = await rawPose(avatarId, 'Idle_Loop', 2);
    const { view, pose } = await viewPose(avatarId, (v) => v.setActivity('idle'));
    expect(view.hasFiniteBones()).toBe(true);
    expect(view.stanceBlend.body).toBe(1);
    // Before: UAL fists (about 1.2-1.3 rad per finger bone); now a light curl.
    expect(before.curl.left).toBeGreaterThan(1);
    expect(pose.curl.left).toBeLessThan(before.curl.left * 0.35);
    expect(pose.curl.right).toBeLessThan(before.curl.right * 0.35);
    // Before: feet about twice the rest spread apart (combat stance).
    expect(pose.spread).toBeLessThan(before.spread * 0.7);
    // Before: the head pitched about 0.24 rad down.
    expect(before.pitch).toBeLessThan(-0.15);
    expect(pose.pitch).toBeGreaterThan(-0.03);
  });

  it('walks with open hands and a level head', async () => {
    const before = await rawPose(avatarId, 'Walk_Loop', 0.6);
    const { view, pose } = await viewPose(avatarId, (v) => v.setActivity('walking'), 2.6);
    expect(view.hasFiniteBones()).toBe(true);
    expect(view.stanceBlend).toMatchObject({ body: 0, head: 1 });
    expect(pose.curl.left).toBeLessThan(before.curl.left * 0.35);
    expect(pose.curl.right).toBeLessThan(before.curl.right * 0.35);
    expect(before.pitch).toBeLessThan(-0.15);
    expect(pose.pitch).toBeGreaterThan(-0.03);
  });

  it('closes the right hand around a held cup and opens it again', async () => {
    const { view, rest, pose } = await viewPose(avatarId, (v) => {
      v.setHeld('coffee', null);
      v.setActivity('idle');
    });
    expect(view.hasFiniteBones()).toBe(true);
    expect(view.stanceBlend.grip).toBe(1);
    expect(pose.curl.right).toBeGreaterThan(pose.curl.left * 2);
    // The cup is gone: the constant finger track is not rewritten by the mixer, so this
    // checks that the grip does not stick.
    view.setHeld('', null);
    for (let i = 0; i < 30; i++) view.update(1 / 30);
    const open = poseOf(bonesOf(view), view.root, rest);
    expect(view.stanceBlend.grip).toBe(0);
    expect(Math.abs(open.curl.right - open.curl.left)).toBeLessThan(1e-3);
  });

  it('leaves the seated pose and the dance emote to their clips', async () => {
    const seated = await viewPose(avatarId, (v) => v.setActivity('sitting', true));
    expect(seated.view.stanceBlend).toMatchObject({ body: 0, head: 0, grip: 0 });
    const dance = await viewPose(avatarId, (v) => {
      v.setActivity('idle');
      v.setEmote('dance');
    });
    expect(dance.view.stanceBlend).toMatchObject({ body: 0, head: 0 });
    expect(dance.view.hasFiniteBones()).toBe(true);
  });
});
