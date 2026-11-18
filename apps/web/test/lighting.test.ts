import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BALANCE, officeLayout } from '@office/protocol';
import { buildCeilingFixtures, ceilingFixturePositions } from '../src/game/lighting';

const F = BALANCE.rendering.ceilingFixtures;

describe('ceiling fixtures', () => {
  it('places a columns x rows grid centred under the ceiling, inside the room', () => {
    const room = officeLayout.room;
    const positions = ceilingFixturePositions(room);
    expect(positions).toHaveLength(F.columns * F.rows);
    expect(positions.reduce((a, p) => a + p[0], 0)).toBeCloseTo(0);
    expect(positions.reduce((a, p) => a + p[2], 0)).toBeCloseTo(0);
    for (const [x, y, z] of positions) {
      expect(y + F.thickness / 2).toBeCloseTo(room.height);
      expect(Math.abs(x) + F.panelSize / 2).toBeLessThanOrEqual(room.width / 2);
      expect(Math.abs(z) + F.panelSize / 2).toBeLessThanOrEqual(room.depth / 2);
    }
  });

  it('leaves out panels that would cross a wall', () => {
    const small = { width: 3, depth: 3, height: 2.5 };
    const positions = ceilingFixturePositions(small, { ...F, columns: 3, rows: 1 });
    expect(positions).toEqual([[0, 2.5 - F.thickness / 2, 0]]);
  });

  it('builds one emissive, non-shadow-casting InstancedMesh from the render config', () => {
    const mesh = buildCeilingFixtures(officeLayout.room);
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBe(F.columns * F.rows);
    expect(mesh.castShadow).toBe(false);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.emissiveIntensity).toBe(F.emissiveIntensity);
    expect(material.emissive.getHexString()).toBe(new THREE.Color(F.emissive).getHexString());
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    // Instance matrices are Float32.
    const expected = ceilingFixturePositions(officeLayout.room)[0] ?? [NaN, NaN, NaN];
    p.toArray().forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? NaN, 5));
  });
});
