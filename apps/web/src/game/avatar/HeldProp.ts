import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BALANCE, type Activity, type EmoteId, type Item, type Vec3 } from '@office/protocol';
import { FOOD, FOOD_DIR } from '../assets/furnitureManifest';

/**
 * REQ-INT-003 (T-1154): the cup or glass an avatar shows. Presentation only: the server
 * replicates `item` / `sips` and the activity; where the prop sits is decided here.
 */
export type PropKind = 'cup' | 'glass';
/**
 * `hand`: follows the right hand bone; `rest`: stands on the desk or coffee table;
 * `hidden`: stowed while the hands are busy (T-1610), still loaded so it comes back at once.
 */
export type PropPlace = 'hand' | 'rest' | 'hidden';
export type PropState = { kind: PropKind; place: PropPlace };
/** Returns a new, sized instance of a prop (origin at the bottom centre). */
export type PropLoader = (kind: PropKind) => Promise<THREE.Object3D>;

/**
 * Which prop an employee shows: the coffee cup whenever it holds one, a glass during a
 * drink with an empty hand (the water dispenser), nothing otherwise.
 */
export function propFor(item: Item, activity: Activity): PropKind | null {
  if (item === 'coffee') return 'cup';
  return activity === 'drinking' ? 'glass' : null;
}

/**
 * Where the prop goes: on the rest spot while seated (desk or coffee table), back in the
 * hand during a seated sip and whenever the employee stands or walks.
 */
export function propRest(seated: boolean, activity: Activity, rest: Vec3 | null): Vec3 | null {
  return seated && activity !== 'drinking' ? rest : null;
}

/**
 * T-1610 (owner decision 2026-11-19): the prop shows in the hand only while the hands are
 * free: standing idle, walking and during the sip itself. Wave, every emote (and its fade-out,
 * `emoting`), brewing and working stow it; it comes back when that ends. Seated, the cup
 * stands on its rest spot instead (`propRest`), which wins over stowing.
 */
export function propInHand(activity: Activity, emote: EmoteId | '', emoting = false): boolean {
  if (activity === 'drinking') return true;
  if (emote !== '' || emoting) return false;
  return activity === 'idle' || activity === 'walking';
}

const SIZE: Record<PropKind, { height: number; maxWidth: number }> = {
  cup: { height: BALANCE.coffeeView.cupHeight, maxWidth: BALANCE.coffeeView.cupMaxWidth },
  glass: { height: BALANCE.coffeeView.glassHeight, maxWidth: BALANCE.coffeeView.glassMaxWidth },
};
const FILES: Record<PropKind, string> = { cup: FOOD.coffeeCup, glass: FOOD.glass };

/**
 * Wraps `source` so its bounding box stands on the origin, centred, scaled uniformly to
 * `height` or to `maxWidth` across its widest side, whichever is smaller.
 */
export function normalizeProp(source: THREE.Object3D, kind: PropKind): THREE.Group {
  const { height, maxWidth } = SIZE[kind];
  const bounds = new THREE.Box3().setFromObject(source);
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const width = Math.max(size.x, size.z);
  const scale = Math.min(
    size.y > 1e-6 ? height / size.y : 1,
    width > 1e-6 ? maxWidth / width : Number.POSITIVE_INFINITY,
  );
  source.position.sub(new THREE.Vector3(centre.x, bounds.min.y, centre.z));
  const inner = new THREE.Group();
  inner.add(source);
  inner.scale.setScalar(scale);
  const wrapper = new THREE.Group();
  wrapper.name = `prop:${kind}`;
  /** Drawn height (m): the hand grips the prop at half of it (T-1610). */
  wrapper.userData.height = size.y * scale;
  wrapper.add(inner);
  wrapper.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return wrapper;
}

const loader = new GLTFLoader();
const templates = new Map<PropKind, Promise<THREE.Group>>();

/**
 * Loads each prop GLB once (Kenney Food Kit, `FOOD` in the manifest); every prop after that
 * is a clone sharing geometry and material. A failed load is not cached.
 */
export const loadProp: PropLoader = async (kind) => {
  let template = templates.get(kind);
  if (!template) {
    template = loader
      .loadAsync(`/assets/${FOOD_DIR}/${FILES[kind]}`)
      .then((gltf) => normalizeProp(gltf.scene, kind));
    templates.set(kind, template);
    template.catch(() => {
      if (templates.get(kind) === template) templates.delete(kind);
    });
  }
  return (await template).clone(true);
};

const tmpGrip = new THREE.Vector3();
const tmpAlong = new THREE.Vector3();
const tmpCurl = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpRootQ = new THREE.Quaternion();
const tmpHandQ = new THREE.Quaternion();

/**
 * T-1610: the world point the hand grips a prop at, in the palm. It lies
 * `BALANCE.coffeeView.grip.along` of the way from the hand bone (the wrist) to the finger bone
 * (the knuckles) and `grip.palm` metres toward the palm side. The palm side is the way the
 * fingers curl: from the finger bone to its own child bone, without the part along the hand.
 * Read from the posed skeleton, so it holds for both suit rigs and every pose.
 */
export function gripPoint(
  hand: THREE.Object3D,
  finger: THREE.Object3D,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const { along, palm } = BALANCE.coffeeView.grip;
  const start = hand.getWorldPosition(out);
  const knuckle = finger.getWorldPosition(tmpAlong);
  const tip = finger.children[0];
  if (tip) {
    tip.getWorldPosition(tmpCurl).sub(knuckle);
    const axis = tmpUp.copy(knuckle).sub(start);
    if (axis.lengthSq() > 1e-12) {
      axis.normalize();
      tmpCurl.addScaledVector(axis, -tmpCurl.dot(axis));
    }
  } else tmpCurl.set(0, 0, 0);
  if (tmpCurl.lengthSq() > 1e-12) tmpCurl.normalize().multiplyScalar(palm);
  return start.lerp(knuckle, along).add(tmpCurl);
}

/**
 * One avatar's held prop. `set` says what to show and where; `update` (once per frame, after
 * the bones are posed) keeps it upright in the hand or on its rest spot. Clearing removes
 * the prop from the scene graph; its geometry and material belong to the shared template.
 */
export class HeldProp {
  private wanted: PropKind | null = null;
  private rest: THREE.Vector3 | null = null;
  private object: THREE.Object3D | null = null;
  private objectKind: PropKind | null = null;
  /** Bumped on every change of the wanted kind, so a stale load is dropped. */
  private request = 0;
  private disposed = false;
  private hidden = false;

  /**
   * `finger` is the hand's first finger bone; with it the prop sits in the palm
   * (`gripPoint`), without it at the hand bone.
   */
  constructor(
    private readonly root: THREE.Object3D,
    private readonly hand: THREE.Object3D | null,
    private readonly load: PropLoader = loadProp,
    private readonly finger: THREE.Object3D | null = null,
  ) {}

  /**
   * Shows `kind` (null clears) in the hand, or on `rest` (world position) when given;
   * `hidden` stows it (kept loaded, not drawn) until a later `set` shows it again.
   */
  set(kind: PropKind | null, rest: Vec3 | null, hidden = false): void {
    if (this.disposed) return;
    if (rest) (this.rest ??= new THREE.Vector3()).set(...rest);
    else this.rest = null;
    this.hidden = hidden && !rest;
    if (this.object) this.object.visible = !this.hidden;
    if (kind === this.wanted) {
      this.attach();
      return;
    }
    this.wanted = kind;
    this.request++;
    this.drop();
    if (!kind) return;
    const request = this.request;
    this.load(kind)
      .then((object) => {
        if (this.disposed || request !== this.request) return;
        this.object = object;
        this.objectKind = kind;
        object.visible = !this.hidden;
        this.attach();
        this.update();
      })
      .catch((error: unknown) => console.warn(`Prop ${kind} failed to load.`, error));
  }

  /** What is drawn now (null while nothing is attached or the model is still loading). */
  get state(): PropState | null {
    if (!this.object || !this.objectKind) return null;
    if (this.hidden) return { kind: this.objectKind, place: 'hidden' };
    return { kind: this.objectKind, place: this.object.parent === this.root ? 'rest' : 'hand' };
  }

  /** The drawn prop object, for tests. */
  get drawn(): THREE.Object3D | null {
    return this.object;
  }

  update(): void {
    const object = this.object;
    if (!object || this.hidden) return;
    this.root.updateWorldMatrix(true, false);
    const rootScale = this.root.getWorldScale(tmpScale).x;
    this.root.getWorldQuaternion(tmpRootQ);
    if (this.rest || !this.hand) {
      // On the rest spot, or carried in front of an avatar without a hand bone (capsule).
      if (this.rest) object.position.copy(this.root.worldToLocal(tmpGrip.copy(this.rest)));
      else object.position.set(0, 1, 0.3);
      object.quaternion.identity();
      object.scale.setScalar(1);
      return;
    }
    // Hand: centred on the grip point in the palm, upright and facing the avatar's heading.
    const hand = this.hand;
    hand.updateWorldMatrix(true, false);
    if (this.finger) gripPoint(hand, this.finger, tmpGrip);
    else hand.getWorldPosition(tmpGrip);
    const height = Number(object.userData.height) || 0;
    tmpGrip.addScaledVector(tmpUp.set(0, 1, 0).applyQuaternion(tmpRootQ), -height / 2);
    object.position.copy(hand.worldToLocal(tmpGrip));
    object.quaternion.copy(hand.getWorldQuaternion(tmpHandQ).invert().multiply(tmpRootQ));
    object.scale.setScalar(rootScale / hand.getWorldScale(tmpScale).x);
  }

  dispose(): void {
    this.disposed = true;
    this.request++;
    this.wanted = null;
    this.drop();
  }

  private attach(): void {
    const object = this.object;
    if (!object) return;
    const parent = this.rest || !this.hand ? this.root : this.hand;
    if (object.parent !== parent) parent.add(object);
  }

  private drop(): void {
    this.object?.removeFromParent();
    this.object = null;
    this.objectKind = null;
  }
}
