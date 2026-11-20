import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { officeLayout } from '@office/protocol';
import { TvScreen, tvPose, TV_CSS_PX_PER_M } from '../../src/tv/TvScreen';
import { TvCssLayer, type CssRenderer } from '../../src/tv/TvCssLayer';

/** Minimal DOM stand-in: enough for CSS3DObject and the layer in a node test run. */
class FakeElement {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  ownerDocument = fakeDoc;
  setAttribute() {}
  set cssText(v: string) {
    this.style.cssText = v;
  }
  insertBefore(child: FakeElement) {
    child.parentNode = this;
    this.children.unshift(child);
    return child;
  }
  removeChild(child: FakeElement) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
}
const fakeDoc = {
  defaultView: { Element: FakeElement },
  createElement: () => new FakeElement(),
};

function layer(screen = new TvScreen()) {
  const dom = new FakeElement();
  const renderer: CssRenderer = {
    domElement: dom as unknown as HTMLElement,
    setSize: vi.fn(),
    render: vi.fn(),
  };
  const l = new TvCssLayer(screen, fakeDoc as unknown as Document, () => renderer);
  return { l, dom, renderer };
}

describe('TvScreen (REQ-TV-001)', () => {
  it('sits in front of the layout tv screen on the west wall, facing into the room', () => {
    const tv = officeLayout.items.find((i) => i.id === 'tv')!;
    const screen = tv.components!.find((c) => c.type === 'tv_screen')!;
    const pose = tvPose();
    expect(pose.width).toBe(screen.size[2]);
    expect(pose.height).toBe(screen.size[1]);
    expect(pose.rotY).toBe(90);
    expect(pose.position[1]).toBe(screen.position[1]);
    expect(pose.position[2]).toBeCloseTo(screen.position[2], 9);
    // In front of the body (larger x), within 3 cm of its face.
    const face = screen.position[0] + screen.size[0] / 2;
    expect(pose.position[0]).toBeGreaterThan(face);
    expect(pose.position[0] - face).toBeLessThan(0.03);

    const tvScreen = new TvScreen();
    tvScreen.group.updateMatrixWorld(true);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(tvScreen.group.quaternion);
    expect(normal.x).toBeCloseTo(1, 9);
  });

  // The televisionModern model is stretched to the tv box; its display face spans x
  // [-0.334, 0.334] of [-0.342, 0.342] and y [0.078, 0.446] of [0, 0.455]. A smaller video
  // left the model's light metal face showing beside the picture (owner screenshot).
  it('covers the display face of the TV model and stays inside it', () => {
    const tv = officeLayout.items.find((i) => i.id === 'tv')!;
    const [, boxH, boxW] = tv.size;
    const bottom = tv.position[1] - boxH / 2;
    const face = {
      width: (boxW * 0.668) / 0.684,
      low: bottom + (boxH * 0.078) / 0.455,
      high: bottom + (boxH * 0.446) / 0.455,
    };
    const pose = tvPose();
    expect(pose.width).toBeLessThanOrEqual(face.width);
    expect(pose.width).toBeGreaterThan(face.width - 0.03);
    expect(pose.position[1] - pose.height / 2).toBeGreaterThanOrEqual(face.low);
    expect(pose.position[1] + pose.height / 2).toBeLessThanOrEqual(face.high);
    expect(pose.height).toBeGreaterThan(face.high - face.low - 0.03);
    expect(pose.position[2]).toBeCloseTo(tv.position[2], 9);
  });

  it('occluder writes depth and clears colour (no blending, alpha 0)', () => {
    const m = new TvScreen().occluder.material as THREE.MeshBasicMaterial;
    expect(m.blending).toBe(THREE.NoBlending);
    expect(m.opacity).toBe(0);
    expect(m.depthWrite).toBe(true);
    expect(m.colorWrite).toBe(true);
  });

  it('dispose detaches the group and disposes geometries and materials', () => {
    const scene = new THREE.Scene();
    const tv = new TvScreen();
    scene.add(tv.group);
    const spies = [tv.bezel, tv.occluder].flatMap((m) => [
      vi.spyOn(m.geometry, 'dispose'),
      vi.spyOn(m.material as THREE.Material, 'dispose'),
    ]);
    tv.dispose();
    expect(tv.group.parent).toBeNull();
    for (const s of spies) expect(s).toHaveBeenCalledOnce();
  });
});

describe('TvCssLayer (REQ-TV-001)', () => {
  it('lays out the screen element at the TV pose with pointer-events none', () => {
    const { l } = layer();
    const pose = tvPose();
    expect(l.object.position.toArray()).toEqual(pose.position);
    expect(l.object.scale.x).toBe(1 / TV_CSS_PX_PER_M);
    expect(l.container.style.pointerEvents).toBe('none');
    expect(l.container.style.cssText).toContain(`width:${pose.width * TV_CSS_PX_PER_M}px`);
  });

  it('mounts under the canvas, resizes and renders with the given camera', () => {
    const { l, dom, renderer } = layer();
    const host = new FakeElement();
    const canvas = new FakeElement();
    host.insertBefore(canvas);
    l.mount(host as unknown as HTMLElement);
    expect(host.firstChild).toBe(dom);
    expect(dom.style.pointerEvents).toBe('none');
    expect(dom.style.zIndex).toBe('0');
    l.setSize(800, 600);
    expect(renderer.setSize).toHaveBeenCalledWith(800, 600);
    const camera = new THREE.PerspectiveCamera();
    l.render(camera);
    expect(renderer.render).toHaveBeenCalledWith(l.cssScene, camera);
  });

  it('dispose removes the CSS3D DOM and the screen element', () => {
    const { l, dom } = layer();
    const host = new FakeElement();
    l.mount(host as unknown as HTMLElement);
    const container = l.container as unknown as FakeElement;
    const holder = new FakeElement();
    holder.insertBefore(container);
    l.dispose();
    expect(host.children).not.toContain(dom);
    expect(container.parentNode).toBeNull();
    expect(l.cssScene.children).toHaveLength(0);
  });
});
