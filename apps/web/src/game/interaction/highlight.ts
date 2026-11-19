import * as THREE from 'three';
import { BALANCE } from '@office/protocol';

type Tinted = { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] };

const hasEmissive = (m: THREE.Material): m is THREE.Material & { emissive: THREE.Color } =>
  (m as { emissive?: unknown }).emissive instanceof THREE.Color;

/**
 * REQ-INT-001 (T-1156): tints the current interaction target. Every mesh under the target
 * gets a clone of its material with an emissive tint; `clear` and `dispose` put the original
 * materials back and free the clones. Furniture materials are shared with every copy of a
 * model (and with instanced parts), so they are never changed in place.
 */
export class TargetHighlight {
  private target: THREE.Object3D | null = null;
  private tinted: Tinted[] = [];
  private readonly clones = new Map<THREE.Material, THREE.Material>();
  private readonly color: THREE.Color;

  constructor(
    color: string = BALANCE.interactionView.highlight.color,
    private readonly intensity: number = BALANCE.interactionView.highlight.intensity,
  ) {
    this.color = new THREE.Color(color);
  }

  /** The highlighted object, or null. */
  get current(): THREE.Object3D | null {
    return this.target;
  }

  /** Number of meshes drawn with a tinted material. */
  get tintedMeshes(): number {
    return this.tinted.length;
  }

  /** Highlights `target` (null clears); highlighting the current target again does nothing. */
  set(target: THREE.Object3D | null): void {
    if (target === this.target) return;
    this.clear();
    if (!target) return;
    this.target = target;
    target.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const original = mesh.material;
      this.tinted.push({ mesh, original });
      mesh.material = Array.isArray(original)
        ? original.map((m) => this.tint(m))
        : this.tint(original);
    });
  }

  clear(): void {
    for (const { mesh, original } of this.tinted) mesh.material = original;
    this.tinted = [];
    for (const clone of this.clones.values()) clone.dispose();
    this.clones.clear();
    this.target = null;
  }

  dispose(): void {
    this.clear();
  }

  private tint(material: THREE.Material): THREE.Material {
    if (!hasEmissive(material)) return material;
    let clone = this.clones.get(material);
    if (!clone) {
      clone = material.clone();
      (clone as THREE.MeshStandardMaterial).emissive.copy(this.color);
      (clone as THREE.MeshStandardMaterial).emissiveIntensity = this.intensity;
      this.clones.set(material, clone);
    }
    return clone;
  }
}
