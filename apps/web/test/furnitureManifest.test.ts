import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COFFEE_MACHINE,
  DESK_SCREEN,
  FOOD,
  FOOD_DIR,
  FURNITURE,
  FURNITURE_PROPS,
} from '../src/game/assets/furnitureManifest';

// T-1147: every manifest entry must point to a real glTF 2.0 binary under public/assets, and every
// external resource it references (Food Kit textures) must exist next to it.
const assets = new URL('../public/assets/', import.meta.url);

interface GltfJson {
  asset: { version: string };
  meshes?: { primitives: unknown[] }[];
  buffers?: { uri?: string }[];
  images?: { uri?: string }[];
}

function readGlb(url: URL): GltfJson {
  const bytes = readFileSync(url);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true), 'magic glTF').toBe(0x46546c67);
  expect(view.getUint32(4, true), 'GLB container version').toBe(2);
  expect(view.getUint32(8, true), 'declared length').toBe(bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true), 'first chunk is JSON').toBe(0x4e4f534a);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as GltfJson;
}

const entries: [string, string][] = [
  ...[...new Set([...Object.values(FURNITURE), DESK_SCREEN, COFFEE_MACHINE])].map(
    (f): [string, string] => ['furniture', f],
  ),
  ...Object.values(FURNITURE_PROPS).map((f): [string, string] => ['furniture', f]),
  ...Object.values(FOOD).map((f): [string, string] => [FOOD_DIR, f]),
];

describe('furniture manifest', () => {
  it.each(entries)('%s/%s exists and is a glTF 2.0 binary with its resources', (dir, file) => {
    const url = new URL(`${dir}/${file}`, assets);
    expect(existsSync(url)).toBe(true);
    const gltf = readGlb(url);
    expect(gltf.asset.version).toBe('2.0');
    expect(gltf.meshes?.length ?? 0).toBeGreaterThan(0);
    const uris = [...(gltf.buffers ?? []), ...(gltf.images ?? [])]
      .map((r) => r.uri)
      .filter((u): u is string => u !== undefined && !u.startsWith('data:'));
    for (const uri of uris) expect(existsSync(new URL(uri, url)), uri).toBe(true);
  });

  it('keeps the Food Kit texture the food models reference', () => {
    expect(existsSync(new URL(`${FOOD_DIR}/Textures/colormap.png`, assets))).toBe(true);
  });
});
