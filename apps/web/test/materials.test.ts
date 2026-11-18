import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BALANCE, officeLayout } from '@office/protocol';
import {
  KENNEY_MATERIALS,
  MATERIAL_CLASSES,
  applyMaterialClass,
  applyMaterialTable,
  materialClassOf,
  materialSpec,
} from '../src/game/materials';

const M = BALANCE.rendering.materials;

/** Material names in every GLB of a public/assets folder, read from the glTF JSON chunk. */
function glbMaterialNames(folder: string): string[] {
  const dir = new URL(`../public/assets/${folder}/`, import.meta.url);
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
    const bytes = readFileSync(new URL(file, dir));
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      materials?: { name: string }[];
    };
    for (const m of json.materials ?? []) names.add(m.name);
  }
  return [...names];
}

describe('material table', () => {
  it('has wood, metal, fabric, glass, plastic/screen and a default class', () => {
    expect([...MATERIAL_CLASSES].sort()).toEqual(
      ['default', 'fabric', 'glass', 'metal', 'plastic', 'wood'].sort(),
    );
  });

  it('maps each class to its roughness and metalness', () => {
    for (const cls of MATERIAL_CLASSES) {
      const spec = materialSpec(cls);
      expect(spec.roughness, cls).toBe(M[cls].roughness);
      expect(spec.metalness, cls).toBe(M[cls].metalness);
      expect(spec.roughness).toBeGreaterThanOrEqual(0);
      expect(spec.roughness).toBeLessThanOrEqual(1);
    }
    // Reflective classes are smoother than wood and fabric.
    expect(M.glass.roughness).toBeLessThan(M.wood.roughness);
    expect(M.plastic.roughness).toBeLessThan(M.wood.roughness);
    expect(M.metal.metalness).toBeGreaterThan(0);
    expect(M.fabric.roughness).toBeGreaterThan(M.wood.roughness);
  });

  it('takes walnut wood and white metal from the layout palette (REQ-ROOM-001)', () => {
    const palette = officeLayout.palette;
    expect(materialSpec('wood').color?.getHex()).toBe(
      new THREE.Color(palette.deskSurfaces).getHex(),
    );
    expect(materialSpec('metal').color?.getHex()).toBe(new THREE.Color(palette.deskFrame).getHex());
    for (const cls of ['fabric', 'glass', 'plastic', 'default'] as const) {
      expect(materialSpec(cls).color, cls).toBeUndefined();
    }
  });
});

describe('Kenney material names', () => {
  it('maps every material name in the furniture and food GLBs to a class', () => {
    const names = [...glbMaterialNames('furniture'), ...glbMaterialNames('food')];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(materialClassOf(name), name).toBeDefined();
  });

  it('maps the real names to the expected class', () => {
    expect(
      Object.fromEntries(
        [...glbMaterialNames('furniture'), ...glbMaterialNames('food')]
          .sort()
          .map((n) => [n, materialClassOf(n)]),
      ),
    ).toEqual({
      _defaultMat: 'default',
      carpet: 'fabric',
      carpetBlue: 'fabric',
      carpetDarker: 'fabric',
      carpetWhite: 'fabric',
      colormap: 'default',
      fur: 'fabric',
      glass: 'glass',
      lamp: 'default',
      metal: 'metal',
      metalDark: 'plastic',
      metalLight: 'metal',
      metalMedium: 'metal',
      plant: 'default',
      wood: 'wood',
      woodDark: 'wood',
    });
  });

  it('leaves unknown and inherited names unmapped', () => {
    expect(materialClassOf('floor')).toBeUndefined();
    expect(materialClassOf('')).toBeUndefined();
    expect(materialClassOf('toString')).toBeUndefined();
  });
});

describe('applying the table', () => {
  const named = (name: string, color = 0x123456) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0.5 });
    m.name = name;
    return m;
  };

  it('sets roughness, metalness and the palette colour, keeping shade variants darker', () => {
    const wood = named('wood');
    const woodDark = named('woodDark');
    expect(applyMaterialClass(wood)).toBe(true);
    expect(applyMaterialClass(woodDark)).toBe(true);
    expect(wood.roughness).toBe(M.wood.roughness);
    expect(wood.metalness).toBe(M.wood.metalness);
    expect(wood.color.getHex()).toBe(new THREE.Color(officeLayout.palette.deskSurfaces).getHex());
    expect(woodDark.color.r).toBeCloseTo(wood.color.r * KENNEY_MATERIALS.woodDark!.shade!);
    expect(wood.userData.materialClass).toBe('wood');
  });

  it('keeps the Kenney colour for classes without a palette colour, and is idempotent', () => {
    const glass = named('glass', 0xabcdef);
    applyMaterialClass(glass);
    applyMaterialClass(glass);
    expect(glass.color.getHex()).toBe(0xabcdef);
    expect(glass.roughness).toBe(M.glass.roughness);
    expect(glass.metalness).toBe(M.glass.metalness);
  });

  it('changes only Kenney materials under the root, once each', () => {
    const root = new THREE.Group();
    const metal = named('metal');
    const room = named('walls');
    const basic = new THREE.MeshBasicMaterial();
    basic.name = 'wood';
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(), metal),
      new THREE.Mesh(new THREE.BoxGeometry(), [metal, room]),
      new THREE.Mesh(new THREE.BoxGeometry(), basic),
    );
    expect(applyMaterialTable(root)).toBe(1);
    expect(metal.metalness).toBe(M.metal.metalness);
    expect(room.roughness).toBe(1);
    expect(room.metalness).toBe(0.5);
    expect(room.color.getHex()).toBe(0x123456);
  });
});
