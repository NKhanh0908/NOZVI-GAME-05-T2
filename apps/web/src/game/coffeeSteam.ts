import * as THREE from 'three';
import { BALANCE, type Vec3 } from '@office/protocol';

/** A soft round puff: white with alpha falling off from the centre (no canvas needed). */
function puffTexture(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const i = (y * size + x) * 4;
      data.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - d) ** 2)], i);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

/**
 * REQ-INT-003 (T-1154): steam rising from the coffee machine while anyone brews. One
 * `Points` draw call while visible and none while hidden. Puffs loop from the machine top
 * to `BALANCE.coffeeView.steam.height` above it with a slight sway.
 */
export class CoffeeSteam {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly phases: number[];
  private time = 0;

  constructor(machine: Vec3) {
    const { puffs, size, aboveMachine } = BALANCE.coffeeView.steam;
    this.positions = new Float32Array(puffs * 3);
    this.phases = Array.from({ length: puffs }, (_, i) => i / puffs);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({
      size,
      map: puffTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.name = 'coffee-steam';
    this.points.position.set(machine[0], machine[1] + aboveMachine, machine[2]);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.layout();
  }

  get visible(): boolean {
    return this.points.visible;
  }

  /** Shows and animates the steam while `active`; hides it otherwise. */
  update(dt: number, active: boolean): void {
    this.points.visible = active;
    if (!active) return;
    this.time += dt;
    this.layout();
  }

  private layout(): void {
    const { riseSpeed, height } = BALANCE.coffeeView.steam;
    const cycle = height / riseSpeed;
    this.phases.forEach((phase, i) => {
      const t = (phase + this.time / cycle) % 1;
      const sway = 0.03 * t;
      this.positions[i * 3] = Math.sin(i * 2.4 + this.time * 1.7) * sway;
      this.positions[i * 3 + 1] = t * height;
      this.positions[i * 3 + 2] = Math.cos(i * 1.3 + this.time * 1.3) * sway;
    });
    this.points.geometry.getAttribute('position').needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    const material = this.points.material as THREE.PointsMaterial;
    material.map?.dispose();
    material.dispose();
  }
}
