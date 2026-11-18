import * as THREE from 'three';
import { BALANCE, officeLayout } from '@office/protocol';

/**
 * Material table (T-1149): one entry per material class with roughness, metalness and, where
 * the layout palette defines one, a colour. Values live in `BALANCE.rendering.materials`;
 * colours stay in `officeLayout.palette` (one source of truth) and are looked up here.
 */
export type MaterialClass = keyof typeof BALANCE.rendering.materials;

export const MATERIAL_CLASSES = Object.keys(BALANCE.rendering.materials) as MaterialClass[];

export type MaterialSpec = { roughness: number; metalness: number; color?: THREE.Color };

/** The resolved table entry of one class; `color` is a new linear-space colour each call. */
export function materialSpec(
  cls: MaterialClass,
  palette: Record<string, string> = officeLayout.palette,
): MaterialSpec {
  const entry: { roughness: number; metalness: number; palette?: string } =
    BALANCE.rendering.materials[cls];
  const hex = entry.palette ? palette[entry.palette] : undefined;
  return {
    roughness: entry.roughness,
    metalness: entry.metalness,
    ...(hex ? { color: new THREE.Color(hex) } : {}),
  };
}

/**
 * Material names used by the Kenney Furniture Kit and Food Kit GLBs under
 * `public/assets/furniture` and `public/assets/food` (read from the files, T-1149). `shade`
 * keeps a variant's Kenney brightness relative to its base material (woodDark is 0.76 x wood,
 * metalMedium about 0.5 x metal) once the class colour replaces the base colour.
 * `metalDark` is only used for electronics housings and screens (keyboard, mouse, monitor,
 * laptop, television, fridge and microwave panels), so it is plastic, not metal.
 */
export const KENNEY_MATERIALS: Readonly<Record<string, { cls: MaterialClass; shade?: number }>> = {
  wood: { cls: 'wood' },
  woodDark: { cls: 'wood', shade: 0.76 },
  metal: { cls: 'metal' },
  metalLight: { cls: 'metal', shade: 1.2 },
  metalMedium: { cls: 'metal', shade: 0.5 },
  metalDark: { cls: 'plastic' },
  carpet: { cls: 'fabric' },
  carpetBlue: { cls: 'fabric' },
  carpetDarker: { cls: 'fabric' },
  carpetWhite: { cls: 'fabric' },
  fur: { cls: 'fabric' },
  glass: { cls: 'glass' },
  lamp: { cls: 'default' },
  plant: { cls: 'default' },
  /** Food Kit texture atlas. */
  colormap: { cls: 'default' },
  _defaultMat: { cls: 'default' },
};

/** Class of a Kenney material name; undefined for names that are not Kenney materials. */
export function materialClassOf(name: string): MaterialClass | undefined {
  return Object.hasOwn(KENNEY_MATERIALS, name) ? KENNEY_MATERIALS[name]!.cls : undefined;
}

/**
 * Applies the table to one material. Returns false (and changes nothing) unless it is a
 * MeshStandardMaterial with a known Kenney name. Absolute values, so applying twice to the
 * cached GLB materials (shared by later games) gives the same result.
 */
export function applyMaterialClass(
  material: THREE.Material,
  palette: Record<string, string> = officeLayout.palette,
): boolean {
  if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return false;
  const kenney = Object.hasOwn(KENNEY_MATERIALS, material.name)
    ? KENNEY_MATERIALS[material.name]
    : undefined;
  if (!kenney) return false;
  const m = material as THREE.MeshStandardMaterial;
  const spec = materialSpec(kenney.cls, palette);
  m.roughness = spec.roughness;
  m.metalness = spec.metalness;
  if (spec.color) {
    const shade = kenney.shade ?? 1;
    m.color.setRGB(
      Math.min(1, spec.color.r * shade),
      Math.min(1, spec.color.g * shade),
      Math.min(1, spec.color.b * shade),
    );
  }
  m.userData.materialClass = kenney.cls;
  m.needsUpdate = true;
  return true;
}

/**
 * Applies the material table to every Kenney material under `root` (the loaded furniture,
 * props and decor). Procedural room materials have no Kenney name and are left alone.
 * Returns the number of distinct materials changed.
 */
export function applyMaterialTable(
  root: THREE.Object3D,
  palette: Record<string, string> = officeLayout.palette,
): number {
  const seen = new Set<THREE.Material>();
  let changed = 0;
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material as
      THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (applyMaterialClass(m, palette)) changed++;
    }
  });
  return changed;
}
