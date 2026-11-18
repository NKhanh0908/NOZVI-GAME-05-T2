import * as THREE from 'three';

/**
 * Owner request 2026-11-18 (floor and wall detail, T-1149): one floor tile as a small RGBA
 * `DataTexture` (tile colour with a soft speckle, grout along two edges), repeated once per
 * `tileSize` across the floor. Built in code, so there is no image asset and it also works in
 * Node tests. The layout's `shell.floor.tileSize` (0.6 m) and palette `floor` / `grout` drive it.
 */
export const FLOOR_TEXTURE_SIZE = 128;
/** Grout width as a fraction of the tile (about 6 mm on a 0.6 m tile). */
const GROUT_FRACTION = 0.012;

/** Deterministic 0..1 hash so the speckle is the same on every load. */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function floorTilePixels(
  tile: string,
  grout: string,
  size = FLOOR_TEXTURE_SIZE,
): Uint8Array {
  const a = new THREE.Color(tile);
  const g = new THREE.Color(grout);
  const groutPx = Math.max(1, Math.round(size * GROUT_FRACTION));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const isGrout = x < groutPx || y < groutPx;
      // ±3 % brightness speckle on the tile face; grout stays flat.
      const k = isGrout ? 1 : 0.97 + 0.06 * hash(x, y);
      const c = isGrout ? g : a;
      data[i] = Math.min(255, Math.round(c.r * 255 * k));
      data[i + 1] = Math.min(255, Math.round(c.g * 255 * k));
      data[i + 2] = Math.min(255, Math.round(c.b * 255 * k));
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Repeating floor texture for a `width` x `depth` floor of `tileSize` tiles. */
export function floorTexture(
  tile: string,
  grout: string,
  width: number,
  depth: number,
  tileSize: number,
): THREE.DataTexture {
  const size = FLOOR_TEXTURE_SIZE;
  const texture = new THREE.DataTexture(floorTilePixels(tile, grout, size), size, size);
  // The palette colours are sRGB hex values; the bytes above are taken from linear THREE.Color
  // components, so mark them linear to keep the floor the same tone as before.
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / tileSize, depth / tileSize);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
