import * as THREE from 'three';
import { officeLayout, type OfficeLayout, type Vec3 } from '@office/protocol';

/** CSS pixels per metre of screen; the iframe is laid out at this size and scaled down. */
export const TV_CSS_PX_PER_M = 1000;
/** The screen plane sits this far in front of the TV body so it never z-fights the model. */
const FRONT_OFFSET = 0.012;
const BEZEL_DEPTH = 0.02;
const BEZEL_MARGIN = 0.03;

export type TvPose = {
  /** Screen centre in world space (m). */
  position: Vec3;
  /** Screen width and height (m). */
  width: number;
  height: number;
  /** Facing as a yaw in degrees (layout convention). */
  rotY: number;
};

/** Where the screen goes: the layout `tv_screen` component, on the front face of the TV. */
export function tvPose(layout: OfficeLayout = officeLayout): TvPose {
  const tv = layout.items.find((i) => i.id === 'tv');
  const screen = tv?.components?.find((c) => c.type === 'tv_screen');
  if (!tv || !screen) throw new Error('layout has no tv screen');
  const [depth, height, width] = screen.size;
  const rotY = screen.rotY ?? 0;
  const yaw = (rotY * Math.PI) / 180;
  // Local +Z is the facing direction; rotY 90 turns it to +X (into the room from the west wall).
  const out = depth / 2 + FRONT_OFFSET;
  const [x, y, z] = screen.position;
  return {
    position: [x + Math.sin(yaw) * out, y, z + Math.cos(yaw) * out],
    width,
    height,
    rotY,
  };
}

/**
 * REQ-TV-001: the WebGL half of the wall TV. A dark bezel frames the screen, and an
 * occluder plane over the screen writes depth and clears colour to transparent, so the
 * CSS3D iframe under the canvas shows through exactly there while nearer meshes (people,
 * furniture) still cover it.
 */
export class TvScreen {
  readonly group = new THREE.Group();
  readonly pose: TvPose;
  readonly occluder: THREE.Mesh;
  readonly bezel: THREE.Mesh;

  constructor(layout: OfficeLayout = officeLayout) {
    this.pose = tvPose(layout);
    const { position, width, height, rotY } = this.pose;
    this.group.name = 'tv_screen_group';
    this.group.position.set(...position);
    this.group.rotation.y = (rotY * Math.PI) / 180;

    this.bezel = new THREE.Mesh(
      new THREE.BoxGeometry(width + BEZEL_MARGIN * 2, height + BEZEL_MARGIN * 2, BEZEL_DEPTH),
      new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.4, metalness: 0.2 }),
    );
    this.bezel.name = 'tv_bezel';
    this.bezel.position.z = -BEZEL_DEPTH / 2 - 0.001;
    this.bezel.receiveShadow = true;

    this.occluder = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        opacity: 0,
        transparent: false,
        blending: THREE.NoBlending,
        side: THREE.FrontSide,
      }),
    );
    this.occluder.name = 'tv_occluder';
    this.group.add(this.bezel, this.occluder);
  }

  /** Corners and centre in world space, for visibility checks. */
  worldPoints(): THREE.Vector3[] {
    this.group.updateMatrixWorld(true);
    const { width: w, height: h } = this.pose;
    return [
      [0, 0],
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [-w / 2, h / 2],
      [w / 2, h / 2],
    ].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(this.group.matrixWorld));
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of [this.bezel, this.occluder]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
