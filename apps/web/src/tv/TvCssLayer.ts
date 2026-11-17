import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { TV_CSS_PX_PER_M, type TvScreen } from './TvScreen';

/** The parts of `CSS3DRenderer` the layer uses (a test double can stand in). */
export type CssRenderer = {
  domElement: HTMLElement;
  setSize(width: number, height: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
};

/**
 * REQ-TV-001: the DOM half of the wall TV. A `CSS3DRenderer` layer sits under the WebGL
 * canvas, uses the same camera and holds one `CSS3DObject` at the screen pose. The
 * container keeps `pointer-events: none`, so orbiting and clicks reach the canvas; the
 * player iframe (P4.6) goes inside `container`.
 */
export class TvCssLayer {
  readonly cssScene = new THREE.Scene();
  readonly container: HTMLDivElement;
  readonly object: CSS3DObject;
  readonly renderer: CssRenderer;

  constructor(
    screen: TvScreen,
    doc: Document = document,
    createRenderer: () => CssRenderer = () => new CSS3DRenderer(),
  ) {
    const { width, height, position, rotY } = screen.pose;
    this.container = doc.createElement('div');
    this.container.dataset.testid = 'tv-screen';
    this.container.style.cssText = [
      `width:${Math.round(width * TV_CSS_PX_PER_M)}px`,
      `height:${Math.round(height * TV_CSS_PX_PER_M)}px`,
      'background:#050506',
      'overflow:hidden',
      'pointer-events:none',
    ].join(';');
    this.object = new CSS3DObject(this.container);
    // CSS3DObject sets pointer-events:auto; the screen must not take clicks outside TV mode.
    this.container.style.pointerEvents = 'none';
    this.object.position.set(...position);
    this.object.rotation.y = (rotY * Math.PI) / 180;
    this.object.scale.setScalar(1 / TV_CSS_PX_PER_M);
    this.cssScene.add(this.object);

    this.renderer = createRenderer();
    const el = this.renderer.domElement;
    el.dataset.testid = 'tv-css-layer';
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.zIndex = '0';
    el.style.pointerEvents = 'none';
  }

  /** Puts the layer under the WebGL canvas in `host`. */
  mount(host: HTMLElement): void {
    host.insertBefore(this.renderer.domElement, host.firstChild);
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height);
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.cssScene, camera);
  }

  dispose(): void {
    this.cssScene.remove(this.object);
    this.container.remove();
    this.renderer.domElement.remove();
  }
}
