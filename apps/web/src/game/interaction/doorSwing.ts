import * as THREE from 'three';

/**
 * Door leaves in the Kenney models used by openables (T-1156) and the swing direction that
 * opens each one toward the model's front (+z): a leaf whose geometry runs +x from its hinge
 * turns by a negative angle, one that runs -x by a positive angle. Node origins are on the
 * hinge edge (`bookcaseClosedDoors`: doorLeft / doorRight; `kitchenFridge`: doorFridge /
 * doorFreezer; `doorwayFront`: door).
 */
export const DOOR_LEAVES: Readonly<Record<string, number>> = {
  doorLeft: -1,
  doorRight: 1,
  doorFridge: -1,
  doorFreezer: -1,
  door: -1,
};

const world = new THREE.Matrix4();
const rotation = new THREE.Matrix4();
const toHinge = new THREE.Matrix4();
const fromHinge = new THREE.Matrix4();
const hinge = new THREE.Vector3();
const parentInverse = new THREE.Matrix4();

/**
 * Turns every door leaf under `root` by `angle` radians (0 = closed) about a vertical axis
 * through its hinge. Fitted furniture is scaled per axis, so the leaf is turned in world
 * space and its local matrix is solved from that: the leaf keeps its fitted size instead of
 * shearing. Returns the number of leaves found.
 */
export function swingDoors(root: THREE.Object3D, angle: number): number {
  root.updateMatrixWorld(true);
  let leaves = 0;
  root.traverse((node) => {
    const sign = DOOR_LEAVES[node.name];
    if (sign === undefined || !node.parent) return;
    leaves++;
    let closed = node.userData.closedMatrix as THREE.Matrix4 | undefined;
    if (!closed) {
      node.updateMatrix();
      closed = node.matrix.clone();
      node.userData.closedMatrix = closed;
      node.matrixAutoUpdate = false;
    }
    world.multiplyMatrices(node.parent.matrixWorld, closed);
    hinge.setFromMatrixPosition(world);
    toHinge.makeTranslation(hinge.x, hinge.y, hinge.z);
    fromHinge.makeTranslation(-hinge.x, -hinge.y, -hinge.z);
    rotation.makeRotationY(sign * angle);
    world.premultiply(fromHinge).premultiply(rotation).premultiply(toHinge);
    parentInverse.copy(node.parent.matrixWorld).invert();
    node.matrix.multiplyMatrices(parentInverse, world);
    node.matrixWorldNeedsUpdate = true;
  });
  return leaves;
}
