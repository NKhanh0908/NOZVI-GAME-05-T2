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
import {
  HeldProp,
  propFor,
  propInHand,
  propRest,
  type PropLoader,
  type PropState,
} from './HeldProp';
import { mergeSkinnedMeshes } from './mergeSkinned';
import { findSkinnedMesh, retargetClipFromRestPose } from './retarget';
import type { SeatKind } from '../interaction/seats';
import {
  EMOTE_OVERLAYS,
  applyBrew,
  applyRestHands,
  applySeatedLegs,
  applySip,
  applyTyping,
  approach,
  dir,
  findRig,
  frameOf,
  type OverlayEmote,
  type Rig,
} from './overlays';
import {
  applyGrip,
  applyStance,
  fingerPose,
  isFingerBone,
  measureStance,
  relaxFingers,
  type StanceRest,
} from './stance';

export const CLIP_FOR: Record<Activity, { clip: string; loop: boolean }> = {
  idle: { clip: 'Idle_Loop', loop: true },
  walking: { clip: 'Walk_Formal_Loop', loop: true }, // FEAT-143: office walk.
  sitting: { clip: 'Sitting_Idle_Loop', loop: true },
  working: { clip: 'Sitting_Idle_Loop', loop: true }, // Typing overlay on top (T-1219).
  resting: { clip: 'Sitting_Idle_Loop', loop: true },
  drinking: { clip: 'Interact', loop: false },
  waving: { clip: 'Idle_Loop', loop: true }, // Arm is overridden procedurally.
  brewing: { clip: 'Idle_Loop', loop: true }, // Make-coffee overlay on top (T-1611).
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
/**
 * FEAT-143: clips whose UAL fists are replaced by relaxed open hands (`relaxFingers`); the
 * office stance overlay (`stance.ts`) runs over the standing ones.
 */
const RELAXED_CLIPS = new Set([CLIP_FOR.idle.clip, CLIP_FOR.walking.clip]);
/** Standing still (not seated): the stance overlay lowers the arms and narrows the feet. */
const STANDING: ReadonlySet<Activity> = new Set(['idle', 'waving', 'brewing', 'drinking']);

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

/**
 * T-1614: where the seated clip puts the hip joints (midpoint of the thigh bones) in the
 * model frame (+Z forward, y up, at the start of `Sitting_Idle_Loop`) and the rest-pose
 * foot height. The seat offset moves the first onto `BALANCE.avatar.sit`.
 */
export type SitMeasure = { hipForward: number; hipHeight: number; footY: number };
type Template = {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  sit: SitMeasure;
  /** FEAT-143: the UAL fist (first frame of the idle clip), per finger bone, for the cup grip. */
  fist: Map<string, THREE.Quaternion>;
};

const SEATED_CLIP = 'Sitting_Idle_Loop';

/** Samples the seated clip on the template once; leaves the skeleton in its rest pose. */
function measureSit(
  scene: THREE.Object3D,
  mesh: THREE.SkinnedMesh,
  clips: THREE.AnimationClip[],
): SitMeasure {
  const bone = (name: string) => mesh.skeleton.bones.find((b) => b.name === name);
  const at = (name: string) =>
    bone(name)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  scene.updateMatrixWorld(true);
  const footY = Math.min(at('FootL').y, at('FootR').y);
  const clip = clips.find((c) => c.name === SEATED_CLIP);
  const mixer = new THREE.AnimationMixer(scene);
  if (clip) mixer.clipAction(clip).play();
  mixer.update(0);
  scene.updateMatrixWorld(true);
  const hip = at('UpperLegL').add(at('UpperLegR')).multiplyScalar(0.5);
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  mesh.skeleton.pose();
  scene.updateMatrixWorld(true);
  return { hipForward: hip.z, hipHeight: hip.y, footY };
}
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
  const retargeted = ual.clips
    .filter((c) => names.has(c.name))
    .map((c) => retargetClipFromRestPose(target, ual.mesh, c, avatarId === 'women_suit'));
  const idle = retargeted.find((c) => c.name === CLIP_FOR.idle.clip);
  const fist = idle ? fingerPose(idle) : new Map<string, THREE.Quaternion>();
  const { curl } = BALANCE.avatar.hands;
  const clips = retargeted.map((c) =>
    RELAXED_CLIPS.has(c.name) ? relaxFingers(c, target.skeleton.bones, curl) : c,
  );
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    // The exported skin bounds do not follow animated bones (also disabled in the PoC).
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
  });
  // T-1161: one skinned mesh per avatar (1 draw call per pass instead of 10); the parts share
  // one skeleton and differ only in colour. Unmergeable assets stay as they are.
  mergeSkinnedMeshes(gltf.scene);
  return { scene: gltf.scene, clips, sit: measureSit(gltf.scene, target, clips), fist };
}

/**
 * Local position and rotation of each bone, saved after the mixer and put back before it.
 * Saving also renormalizes the rotations: a single-key track (the relaxed fingers) hands
 * its float32 values to the bone unchanged, slightly off unit length.
 */
class ClipPose {
  private readonly saved: { p: THREE.Vector3; q: THREE.Quaternion }[];
  private valid = false;
  constructor(private readonly bones: THREE.Bone[]) {
    this.saved = bones.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }));
  }
  save(): void {
    this.bones.forEach((b, i) => {
      this.saved[i]!.p.copy(b.position);
      this.saved[i]!.q.copy(b.quaternion.normalize());
    });
    this.valid = true;
  }
  restore(): void {
    if (!this.valid) return;
    this.bones.forEach((b, i) => {
      b.position.copy(this.saved[i]!.p);
      b.quaternion.copy(this.saved[i]!.q);
    });
  }
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
  /** Blend weight of the make-coffee overlay while `brewing`, 0 to 1 (T-1611). */
  private brewWeight = 0;
  /** REQ-INT-003 (T-1154): the replicated held item and the cup's rest spot when seated. */
  private item: Item = '';
  private restSpot: Vec3 | null = null;
  private readonly prop: HeldProp;
  /** T-1614: the seat's furniture, which sets the seated hip target. */
  private seatKind: SeatKind = 'desk';
  /** Blend weight of the seat offset and planted feet, 0 to 1 (T-1614). */
  private sitWeight = 0;
  /** Blend weight of the hands resting on the thighs, 0 to 1 (T-1614). */
  private restWeight = 0;
  /** FEAT-143: rest pose the office stance returns to, and its blend weights (0 to 1). */
  private readonly stance: StanceRest;
  private stanceWeight = 0;
  private headWeight = 0;
  /** FEAT-143: right-hand finger bones and their fist pose; `gripWeight` closes them. */
  private readonly grip: { bone: THREE.Bone; fist: THREE.Quaternion }[];
  private gripWeight = 0;
  /** The pose the mixer left, before the overlays (FEAT-143). */
  private readonly clipPose: ClipPose;

  private constructor(
    private readonly model: THREE.Object3D,
    private readonly bones: THREE.Bone[],
    clips: THREE.AnimationClip[],
    private readonly materials: THREE.Material[] = [],
    loadProp?: PropLoader,
    private readonly sit: SitMeasure | null = null,
    fist: Map<string, THREE.Quaternion> = new Map(),
  ) {
    this.root.add(model);
    this.rig = findRig(bones);
    this.clipPose = new ClipPose(bones);
    // Measured before the mixer first runs, while the clone is still in its bind pose.
    this.stance = measureStance(this.root, this.rig, bones);
    this.grip = bones.flatMap((bone) => {
      const pose = fist.get(bone.name);
      return pose && isFingerBone(bone.name) && bone.name.endsWith('R')
        ? [{ bone, fist: pose }]
        : [];
    });
    this.prop = new HeldProp(
      this.root,
      this.rig.right?.hand ?? null,
      loadProp,
      this.rig.right?.finger ?? null,
    );
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
    const { scene, clips, sit, fist } = await template;
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
    return new AvatarView(
      model,
      target.skeleton.bones,
      clips,
      materials,
      options.loadProp,
      sit,
      fist,
    );
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
   * T-1614: the kind of seat the employee is on (desk chair or sofa); with `seated` it moves
   * the model so the hips rest on that seat's cushion. Kept while standing.
   */
  setSeat(kind: SeatKind | null): void {
    if (kind) this.seatKind = kind;
  }

  /** Seat offset weight (0 to 1, T-1614); tests read it. */
  get seatBlend(): number {
    return this.sitWeight;
  }

  /** Hands-on-thighs weight (0 to 1, T-1614); tests read it. */
  get handsRest(): number {
    return this.restWeight;
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

  /** Make-coffee overlay weight (0 to 1, T-1611); e2e reads it through the dev hooks. */
  get brew(): number {
    return this.brewWeight;
  }

  update(dt: number): void {
    // The mixer writes a bone only when its clip value changed since the last frame (constant
    // finger tracks, held keys), so last frame's overlays would stay on those bones. Put back
    // the clip pose first, so every overlay below starts from the clip each frame (FEAT-143).
    this.clipPose.restore();
    this.mixer.update(dt);
    this.clipPose.save();
    this.clock += dt;
    const fade = BALANCE.activity.crossFadeSeconds;
    this.placeOnSeat(dt);
    // FEAT-143: office stance while standing; the head stays level standing and walking.
    // A clip emote (dance) plays as it is.
    const free = !this.seated && emoteClip(this.emote) === null;
    const standing = free && STANDING.has(this.activity) ? 1 : 0;
    const level = free && (standing === 1 || this.activity === 'walking') ? 1 : 0;
    this.stanceWeight = approach(this.stanceWeight, standing, dt, fade);
    this.headWeight = approach(this.headWeight, level, dt, fade);
    // The right hand closes around a cup it holds (open, relaxed fingers otherwise).
    const holding = propFor(this.item, this.activity) !== null && this.propHeld() ? 1 : 0;
    this.gripWeight = approach(this.gripWeight, holding, dt, fade);
    applyStance(this.root, this.rig, this.stance, this.current?.time ?? 0, {
      body: this.stanceWeight,
      head: this.headWeight,
      hold: this.gripWeight,
    });
    applyGrip(this.grip, this.gripWeight * BALANCE.avatar.hands.grip);
    // T-1614: seated and not working, the hands rest on the thighs; typing, emotes and the
    // sip below take the arms over.
    const resting = this.seated && this.activity !== 'working' && this.emote === '' ? 1 : 0;
    this.restWeight = approach(this.restWeight, resting, dt, fade);
    applyRestHands(this.root, this.rig, this.restWeight);
    // REQ-AVATAR-002 (T-1219): typing blends in and out over the activity cross-fade.
    // An emote takes the arms over from typing while it runs (T-1222).
    const typing = this.activity === 'working' && this.emote === '' ? 1 : 0;
    this.typingWeight = approach(this.typingWeight, typing, dt, fade);
    applyTyping(this.root, this.rig, this.clock, this.typingWeight);
    if (this.overlay) {
      const target = emoteOverlay(this.emote) === this.overlay ? 1 : 0;
      this.overlayWeight = approach(this.overlayWeight, target, dt, fade);
      EMOTE_OVERLAYS[this.overlay](this.root, this.rig, this.clock, this.overlayWeight);
      if (this.overlayWeight === 0) this.overlay = null;
    }
    // REQ-INT-003 (T-1611): making coffee at the machine; an emote takes the arms over.
    const brewing = this.activity === 'brewing' && this.emote === '' ? 1 : 0;
    this.brewWeight = approach(this.brewWeight, brewing, dt, fade);
    applyBrew(this.root, this.rig, this.clock, this.brewWeight);
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

  /**
   * T-1614: the UAL seated clip puts the hips about 0.24 m behind and 0.33 m below the
   * standing root, which on the seat socket (the chair's centre) is on the backrest. Move
   * the model so the hip joints land on `BALANCE.avatar.sit[seatKind]` and plant the feet.
   */
  private placeOnSeat(dt: number): void {
    const { blendSeconds } = BALANCE.avatar.sit;
    this.sitWeight = approach(this.sitWeight, this.seated ? 1 : 0, dt, blendSeconds);
    const sit = this.sit;
    if (!sit) return;
    const target = BALANCE.avatar.sit[this.seatKind];
    const w = this.sitWeight;
    this.model.position.set(
      0,
      (target.height - sit.hipHeight) * w,
      (target.forward - sit.hipForward) * w,
    );
    this.model.updateWorldMatrix(false, true);
    const floor = this.root.getWorldPosition(new THREE.Vector3()).y + sit.footY;
    applySeatedLegs(this.root, this.rig, floor, w);
  }

  /** Whether a prop would be in the hand now (not on its rest spot, not stowed). */
  private propHeld(): boolean {
    return (
      propRest(this.seated, this.activity, this.restSpot) === null &&
      propInHand(this.activity, this.emote, this.overlay !== null)
    );
  }

  /** FEAT-143 blend weights (0 to 1); tests read them. */
  get stanceBlend(): { body: number; head: number; grip: number } {
    return { body: this.stanceWeight, head: this.headWeight, grip: this.gripWeight };
  }

  private updateProp(): void {
    const kind = propFor(this.item, this.activity);
    const rest = kind ? propRest(this.seated, this.activity, this.restSpot) : null;
    // T-1610: stowed while the hands are busy (wave, emotes and their fade-out, brewing,
    // working); back in the hand after.
    this.prop.set(kind, rest, !propInHand(this.activity, this.emote, this.overlay !== null));
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
