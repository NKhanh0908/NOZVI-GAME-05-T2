import { expect, it } from 'vitest';
import * as THREE from 'three';
import { officeLayout } from '@office/protocol';
import { FLOOR_TEXTURE_SIZE, floorTexture, floorTilePixels } from '../src/game/floorTexture';

const byte = (v: number) => Math.round(v * 255);

it('owner request 2026-11-18: the floor tile has grout on its edges and the tile colour inside', () => {
  const px = floorTilePixels('#E8E4DC', '#C8C4BC');
  const size = FLOOR_TEXTURE_SIZE;
  const at = (x: number, y: number) =>
    Array.from(px.slice((y * size + x) * 4, (y * size + x) * 4 + 3));
  const grout = new THREE.Color('#C8C4BC');
  expect(at(0, 40)).toEqual([byte(grout.r), byte(grout.g), byte(grout.b)]);
  const tile = new THREE.Color('#E8E4DC');
  const [r] = at(64, 64);
  expect(Math.abs(r! - byte(tile.r))).toBeLessThanOrEqual(byte(tile.r) * 0.04 + 1);
  // Deterministic speckle.
  expect(floorTilePixels('#E8E4DC', '#C8C4BC')).toEqual(px);
});

it('owner request 2026-11-18: one texture repeat per layout tile', () => {
  const { width, depth } = officeLayout.room;
  const t = floorTexture('#E8E4DC', '#C8C4BC', width, depth, officeLayout.floorTileSize);
  expect(officeLayout.floorTileSize).toBeCloseTo(0.6);
  expect(t.repeat.x).toBeCloseTo(width / 0.6);
  expect(t.repeat.y).toBeCloseTo(depth / 0.6);
  expect(t.wrapS).toBe(THREE.RepeatWrapping);
  t.dispose();
});
