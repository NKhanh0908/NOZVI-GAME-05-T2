import * as THREE from 'three';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Hides camera occluders for one frame. A plain mesh is hidden with `visible`; one instance
 * of an `InstancedMesh` (instanced furniture, T-1148) collapses to a zero-scale matrix and
 * gets its matrix back on `restore`. Restore before raycasting: a collapsed instance cannot
 * be hit.
 */
export class OccluderHider {
  private readonly objects = new Set<THREE.Object3D>();
  private readonly instances = new Map<THREE.InstancedMesh, Map<number, THREE.Matrix4>>();

  hide(hit: THREE.Intersection): void {
    const mesh = hit.object as THREE.InstancedMesh;
    if (mesh.isInstancedMesh && hit.instanceId !== undefined) {
      let saved = this.instances.get(mesh);
      if (!saved) this.instances.set(mesh, (saved = new Map()));
      if (saved.has(hit.instanceId)) return;
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(hit.instanceId, matrix);
      saved.set(hit.instanceId, matrix);
      mesh.setMatrixAt(hit.instanceId, ZERO);
      mesh.instanceMatrix.needsUpdate = true;
      return;
    }
    hit.object.visible = false;
    this.objects.add(hit.object);
  }

  restore(): void {
    for (const object of this.objects) object.visible = true;
    this.objects.clear();
    for (const [mesh, saved] of this.instances) {
      for (const [index, matrix] of saved) mesh.setMatrixAt(index, matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.instances.clear();
  }
}
