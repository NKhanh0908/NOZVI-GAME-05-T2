import * as THREE from 'three';
import type { WallClock } from '@office/protocol';

/**
 * T-1158: hand angles (radians, clockwise from 12 o'clock) for a local time. The hour hand
 * moves continuously with the minutes; the minute hand with the seconds.
 */
export function clockHandAngles(date: Date): { hour: number; minute: number } {
  const minutes = date.getMinutes() + date.getSeconds() / 60;
  const hours = (date.getHours() % 12) + minutes / 60;
  return { hour: (hours / 12) * 2 * Math.PI, minute: (minutes / 60) * 2 * Math.PI };
}

/**
 * Procedural wall clock (owner decision 2026-11-17: no clock model) on the inner face of a
 * north wall, facing +Z: rim + face, and two hands that `update` turns to the local time.
 * Four draw calls, no shadows.
 */
export class WallClockView {
  readonly group = new THREE.Group();
  private readonly hourHand: THREE.Object3D;
  private readonly minuteHand: THREE.Object3D;
  private lastMinute = -1;

  constructor(clock: WallClock) {
    const { radius, depth } = clock;
    this.group.name = clock.id;
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, depth, 32).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#2B2F33', roughness: 0.5 }),
    );
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.88, 32),
      new THREE.MeshStandardMaterial({ color: '#FAFAF7', roughness: 0.8 }),
    );
    face.position.z = depth / 2 + 0.001;
    const hand = (length: number, width: number, z: number) => {
      const pivot = new THREE.Group();
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, length, 0.004).translate(0, length / 2 - 0.01, 0),
        new THREE.MeshStandardMaterial({ color: '#1F2328' }),
      );
      pivot.add(mesh);
      pivot.position.z = depth / 2 + z;
      return pivot;
    };
    this.hourHand = hand(radius * 0.5, 0.018, 0.004);
    this.minuteHand = hand(radius * 0.78, 0.012, 0.008);
    this.group.add(rim, face, this.hourHand, this.minuteHand);
    this.group.position.set(...clock.position);
    this.group.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.update(new Date());
  }

  /** Turns the hands to `date` (cheap; skips work inside the same minute). */
  update(date: Date): void {
    const minute = date.getHours() * 60 + date.getMinutes();
    if (minute === this.lastMinute) return;
    this.lastMinute = minute;
    const { hour, minute: m } = clockHandAngles(date);
    // Facing +Z, clockwise as seen by the viewer is a negative rotation about +Z.
    this.hourHand.rotation.z = -hour;
    this.minuteHand.rotation.z = -m;
  }

  /** Angles currently drawn, for the dev hook (radians, clockwise from 12). */
  get angles(): { hour: number; minute: number } {
    return { hour: -this.hourHand.rotation.z, minute: -this.minuteHand.rotation.z };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
  }
}
