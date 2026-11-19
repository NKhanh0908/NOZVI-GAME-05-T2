import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
  BALANCE,
  isSeated,
  type Activity,
  type AvatarId,
  type EmoteId,
  type Item,
  type Vec3,
} from '@office/protocol';
import { HeldProp, propFor, propRest, type PropLoader, type PropState } from './HeldProp';
import { mergeSkinnedMeshes } from './mergeSkinned';
import { findSkinnedMesh, retargetClipFromRestPose } from './retarget';
import {
  EMOTE_OVERLAYS,
  applySip,
  applyTyping,
  approach,
  dir,
  findRig,
  frameOf,
  type OverlayEmote,
  type Rig,
} from './overlays';

export const CLIP_FOR: Record<Activity, { clip: string; loop: boolean }> = {
  idle: { clip: 'Idle_Loop', loop: true },
  walking: { clip: 'Walk_Loop', loop: true },
  sitting: { clip: 'Sitting_Idle_Loop', loop: true },
  working: { clip: 'Sitting_Idle_Loop', loop: true }, // Typing overlay on top (T-1219).
  resting: { clip: 'Sitting_Idle_Loop', loop: true },
  drinking: { clip: 'Interact', loop: false },
  waving: { clip: 'Idle_Loop', loop: true }, // Arm is overridden procedurally.
  brewing: { clip: 'Idle_Loop', loop: true }, // Steam at the machine shows the brew (T-1154).
};

/**
 * What plays each emote (REQ-AVATAR-004, plan §3.7): a UAL clip, the Phase 2 wave arm
 * override, or a procedural overlay from `overlays.ts`. Emotes are a layer over the activity.
 */
export const EMOTE_SOURCE: Record<EmoteId, { clip: string } | { overlay: 'wave' | OverlayEmote }> =
  {
    wave: { overlay: 'wave' },
    dance: { clip: 'Dance_Loop' },
    think: { overlay: 'think' },
    laugh: { overlay: 'laugh' },
    stretch: { overlay: 'stretch' },
  };
const emoteClip = (e: EmoteId | '') => {
  const source = e ? EMOTE_SOURCE[e] : null;
  return source && 'clip' in source ? source.clip : null;
};
const emoteOverlay = (e: EmoteId | ''): OverlayEmote | null => {
  const source = e ? EMOTE_SOURCE[e] : null;
  return source && 'overlay' in source && source.overlay !== 'wave' ? source.overlay : null;
};

const loader = new GLTFLoader();
let ualPromise: Promise<{ mesh: THREE.SkinnedMesh; clips: THREE.AnimationClip[] }> | null = null;
function loadUal() {
  ualPromise ??= loader.loadAsync('/assets/anim/ual.glb').then((g) => {
    const mesh = findSkinnedMesh(g.scene);
    if (!mesh) throw new Error('UAL skinned mesh missing');
    return { mesh, clips: g.animations };
  });
  return ualPromise;
}

type Template = { scene: THREE.Object3D; clips: THREE.AnimationClip[] };
const templates = new Map<AvatarId, Promise<Template>>();

async function loadTemplate(avatarId: AvatarId): Promise<Template> {
  const [gltf, ual] = await Promise.all([
    loader.loadAsync(`/assets/avatars/${avatarId}.glb`),
    loadUal(),
  ]);
  const target = findSkinnedMesh(gltf.scene);
  if (!target) throw new Error(`No skinned mesh in ${avatarId}`);
  target.skeleton.pose();
  const names = new Set(
    Object.values(CLIP_FOR)
      .map((c) => c.clip)
      .concat('Sitting_Enter', 'Sitting_Exit')
      .concat(Object.values(EMOTE_SOURCE).flatMap((e) => ('clip' in e ? [e.clip] : []))),
  );
  const clips = ual.clips
    .filter((c) => names.has(c.name))
    .map((c) => retargetClipFromRestPose(target, ual.mesh, c, avatarId === 'women_suit'));
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    // The exported skin bounds do not follow animated bones (also disabled in the PoC).
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
  });
  // T-1161: one skinned mesh per avatar (1 draw call per pass instead of 10); the parts share
  // one skeleton and differ only in colour. Unmergeable assets stay as they are.
  mergeSkinnedMeshes(gltf.scene);
  return { scene: gltf.scene, clips };
}

export class AvatarView {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private activity: Activity = 'idle';
  /** On a seat: the seated pose plays, also during a seated sip (`drinking` on the seat). */
  private seated = false;
  private waveTime = 0;
  /** The view's own clock (s) for procedural overlays. */
  private clock = 0;
  /** Blend weight of the typing overlay, 0 to 1 (T-1219). */
  private typingWeight = 0;
  private readonly rig: Rig;
  /** The replicated emote shown over the activity ('' = none; T-1222). */
  private emote: EmoteId | '' = '';
  /** The overlay emote being shown or faded out, and its blend weight. */
  private overlay: OverlayEmote | null = null;
  private overlayWeight = 0;
  /** Blend weight of the sip overlay while `drinking`, 0 to 1 (T-1154). */
  private sipWeight = 0;
  /** REQ-INT-003 (T-1154): the replicated held item and the cup's rest spot when seated. */
  private item: Item = '';
  private restSpot: Vec3 | null = null;
  private readonly prop: HeldProp;

  private constructor(
    model: THREE.Object3D,
    private readonly bones: THREE.Bone[],
    clips: THREE.AnimationClip[],
    private readonly materials: THREE.Material[] = [],
    loadProp?: PropLoader,
  ) {
    this.root.add(model);
    this.rig = findRig(bones);
    this.prop = new HeldProp(this.root, this.rig.right?.hand ?? null, loadProp);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.play('idle');
  }

  /**
   * Loads, prepares and retargets each avatar GLB once per `avatarId`; every view after that is
   * a skeleton-aware clone sharing geometry, textures and clips. Materials are cloned per view
   * because players fade their own materials. A failed load is not cached, so a later call
   * retries.
   */
  static async load(
    avatarId: AvatarId,
    options: { loadProp?: PropLoader } = {},
  ): Promise<AvatarView> {
    let template = templates.get(avatarId);
    if (!template) {
      template = loadTemplate(avatarId);
      templates.set(avatarId, template);
      template.catch(() => {
        if (templates.get(avatarId) === template) templates.delete(avatarId);
      });
    }
    const { scene, clips } = await template;
    const model = cloneSkinned(scene);
    const materials: THREE.Material[] = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const own = (m: THREE.Material) => {
        const copy = m.clone();
        materials.push(copy);
        return copy;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    });
    const target = findSkinnedMesh(model)!;
    return new AvatarView(model, target.skeleton.bones, clips, materials, options.loadProp);
  }

  /** Test hook: forgets cached templates so the next load parses the GLB again. */
  static clearCache(): void {
    templates.clear();
  }

  /**
   * `seated` is whether the employee is on a seat; it differs from the activity only during
   * a seated sip (`drinking` on the seat, T-1154), which keeps the seated pose.
   */
  setActivity(a: Activity, seated: boolean = isSeated(a)): void {
    if (a === this.activity && seated === this.seated) return;
    const wasSeated = this.seated;
    this.activity = a;
    this.seated = seated;
    if (a === 'waving') this.waveTime = BALANCE.activity.waveSeconds;
    if (seated && !wasSeated) this.playOnce('Sitting_Enter', a);
    else if (!seated && wasSeated) this.playOnce('Sitting_Exit', a);
    else this.play(a);
  }

  /**
   * REQ-AVATAR-004 (T-1222): shows the replicated emote over the activity. A clip emote
   * replaces the activity clip until it ends; overlays blend in and out over the cross-fade.
   */
  setEmote(e: EmoteId | ''): void {
    if (e === this.emote) return;
    const previousClip = emoteClip(this.emote);
    this.emote = e;
    const clip = emoteClip(e);
    if (clip) this.fadeTo(clip, true);
    else if (previousClip) this.play(this.activity);
    const overlay = emoteOverlay(e);
    if (overlay) this.overlay = overlay;
  }

  /** The emote currently shown ('' = none). */
  get shownEmote(): EmoteId | '' {
    return this.emote;
  }

  /**
   * REQ-INT-003 (T-1154): shows the held coffee (`item`) and, while seated, the world spot
   * of the desk or coffee table the cup stands on. The prop follows in `update`.
   */
  setHeld(item: Item, restSpot: Vec3 | null): void {
    this.item = item;
    this.restSpot = restSpot;
  }

  /** The prop drawn now (null when none or still loading). */
  get heldProp(): PropState | null {
    return this.prop.state;
  }

  private play(a: Activity): void {
    const spec = this.seated && !isSeated(a) ? CLIP_FOR.sitting : CLIP_FOR[a];
    this.fadeTo(spec.clip, spec.loop);
  }

  private playOnce(clip: string, then: Activity): void {
    const action = this.fadeTo(clip, false);
    if (!action) return this.play(then);
    const onDone = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return;
      this.mixer.removeEventListener('finished', onDone);
      if (this.activity === then) this.play(then);
    };
    this.mixer.addEventListener('finished', onDone);
  }

  private fadeTo(clip: string, loop: boolean): THREE.AnimationAction | null {
    const next = this.actions.get(clip);
    if (!next) return null;
    // Same looping clip (sitting ↔ working, waving ↔ idle): keep its phase, no restart pop.
    if (next === this.current && loop && next.loop === THREE.LoopRepeat) return next;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.play();
    if (this.current && this.current !== next)
      this.current.crossFadeTo(next, BALANCE.activity.crossFadeSeconds, false);
    this.current = next;
    return next;
  }

  /** Typing overlay weight (0 to 1); e2e reads it through the remote list. */
  get typing(): number {
    return this.typingWeight;
  }

  update(dt: number): void {
    this.mixer.update(dt);
    this.clock += dt;
    // REQ-AVATAR-002 (T-1219): typing blends in and out over the activity cross-fade.
    // An emote takes the arms over from typing while it runs (T-1222).
    const fade = BALANCE.activity.crossFadeSeconds;
    const typing = this.activity === 'working' && this.emote === '' ? 1 : 0;
    this.typingWeight = approach(this.typingWeight, typing, dt, fade);
    applyTyping(this.root, this.rig, this.clock, this.typingWeight);
    if (this.overlay) {
      const target = emoteOverlay(this.emote) === this.overlay ? 1 : 0;
      this.overlayWeight = approach(this.overlayWeight, target, dt, fade);
      EMOTE_OVERLAYS[this.overlay](this.root, this.rig, this.clock, this.overlayWeight);
      if (this.overlayWeight === 0) this.overlay = null;
    }
    // REQ-INT-003 (T-1154): the sip lifts the right hand to the mouth, standing or seated.
    this.sipWeight = approach(this.sipWeight, this.activity === 'drinking' ? 1 : 0, dt, fade);
    applySip(this.root, this.rig, this.sipWeight);
    const legacyWave = this.activity === 'waving' && this.waveTime > 0;
    if (legacyWave) this.waveTime -= dt;
    if (legacyWave || this.emote === 'wave') {
      // GLTFLoader sanitizes the exported UpperArm.R / LowerArm.R names by removing dots.
      const arm = this.bones.find((b) => b.name === 'UpperArmR');
      const fore = this.bones.find((b) => b.name === 'LowerArmR');
      const hand = fore?.children.find((b) => b.name === 'HandR');
      const t = performance.now() / 1000;
      if (arm && fore && hand) {
        // The avatar's right comes from the skeleton (`frameOf`): the old local +X pointed to
        // the character's left, so the right arm crossed over the head.
        const f = frameOf(this.root, this.rig);
        const raised = dir(f, 0, 0.6, 0.8);
        this.pointBone(arm, fore, raised);
        this.pointBone(fore, hand, dir(f, 0, 1, 0.1));
        const forward = f.forward.clone();
        const inverseParent = fore.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
        forward.applyQuaternion(inverseParent);
        fore.quaternion.premultiply(
          new THREE.Quaternion().setFromAxisAngle(forward, Math.sin(t * 10) * 0.4),
        );
        fore.updateWorldMatrix(false, true);
      }
    }
    this.updateProp();
  }

  private updateProp(): void {
    const kind = propFor(this.item, this.activity);
    this.prop.set(kind, kind ? propRest(this.seated, this.activity, this.restSpot) : null);
    this.prop.update();
  }

  private pointBone(bone: THREE.Bone, end: THREE.Object3D, direction: THREE.Vector3): void {
    const current = end
      .getWorldPosition(new THREE.Vector3())
      .sub(bone.getWorldPosition(new THREE.Vector3()))
      .normalize();
    const worldRotation = bone.getWorldQuaternion(new THREE.Quaternion());
    worldRotation.premultiply(new THREE.Quaternion().setFromUnitVectors(current, direction));
    const inverseParent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(worldRotation.premultiply(inverseParent));
    bone.updateWorldMatrix(false, true);
  }

  /**
   * Stops animation, detaches the model and frees this view's own materials. Geometry and
   * textures belong to the shared per-avatar template and stay alive for later clones.
   */
  dispose(): void {
    this.prop.dispose();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
  }

  hasFiniteBones(): boolean {
    return this.bones.every((b) =>
      [...b.position.toArray(), ...b.quaternion.toArray()].every(Number.isFinite),
    );
  }
}
