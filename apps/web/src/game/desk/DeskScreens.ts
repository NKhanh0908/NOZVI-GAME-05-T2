import * as THREE from 'three';
import { BALANCE, officeLayout, type OfficeLayout } from '@office/protocol';
import type { OccupancyRoom } from '../../net';
import type { DeskProp } from '../assets/deskProps';
import { DESK_SCREEN, FURNITURE_PROPS } from '../assets/furnitureManifest';
import { fitModel } from '../assets/loadFurniture';
import { deskBySeat, deskScreenStates, lampLit, type ScreenState } from './screenState';
import { ScreenTextures, type CanvasFactory } from './screenTextures';

const CFG = BALANCE.deskScreen;
const STATES: readonly ScreenState[] = ['off', 'locked', 'desktop'];

type Vec3 = [number, number, number];
/** A model's bounds and one part of it (model space, metres), measured from the Kenney GLB. */
type Part = { min: Vec3; max: Vec3; center: Vec3; tiltX?: number };

/**
 * `computerScreen.glb`: the display panel (material `metal`) faces +Z, tilted back so its
 * normal is (0, 0.14, 0.99); it spans x 0.007..0.386 and y 0.056..0.287.
 */
const SCREEN: Part & { size: [number, number] } = {
  min: [0, 0, -0.104],
  max: [0.393, 0.294, 0],
  center: [0.1965, 0.1715, -0.052],
  tiltX: -Math.asin(0.14),
  size: [0.379, 0.233],
};

/** Lamp shades (material `lamp`): a square box and a tapered hexagonal shade. */
const SHADES: Record<string, Part & { geometry: () => THREE.BufferGeometry }> = {
  [FURNITURE_PROPS.lampSquareTable]: {
    min: [0, 0, -0.12],
    max: [0.12, 0.29, 0],
    center: [0.06, 0.215, -0.06],
    geometry: () => new THREE.BoxGeometry(0.12, 0.15, 0.12),
  },
  [FURNITURE_PROPS.lampRoundTable]: {
    min: [-0.016, 0, -0.148],
    max: [0.136, 0.314, 0.028],
    center: [0.06, 0.225, -0.06],
    // Three's cylinder puts a vertex at +Z, so its flat sides face ±X like the shade's.
    geometry: () => new THREE.CylinderGeometry(0.0624, 0.0878, 0.178, 6),
  },
};

/**
 * The world matrix of `part` once its model is fitted to `prop`'s layout box exactly like
 * `loadFurniture` fits the real model (same rotation and per-axis scale), so overlays line up
 * with the instanced props.
 */
export function partMatrix(prop: DeskProp, part: Part): THREE.Matrix4 {
  const source = new THREE.Group();
  const size = part.max.map((v, i) => v - part.min[i]!) as Vec3;
  const bounds = new THREE.Mesh(new THREE.BoxGeometry(...size));
  bounds.position.set(...(part.max.map((v, i) => (v + part.min[i]!) / 2) as Vec3));
  const target = new THREE.Object3D();
  target.name = 'part';
  target.position.set(...part.center);
  target.rotation.x = part.tiltX ?? 0;
  source.add(bounds, target);
  const fitted = fitModel(source, prop.placement.box, prop.placement.rotY);
  fitted.updateMatrixWorld(true);
  bounds.geometry.dispose();
  return fitted.getObjectByName('part')!.matrixWorld.clone();
}

type DeskEntry = { screen: THREE.Matrix4; lamp?: { file: string; matrix: THREE.Matrix4 } };

/**
 * REQ-INT-002 (T-1155, plan §3.3): the monitor and desk lamp of every desk follow its screen
 * state. One quad per desk sits on the monitor's display panel and is drawn by one
 * `InstancedMesh` per state (dark, shared lock texture, shared desktop texture); lamp shades
 * of desks showing the desktop get an emissive shell (one `InstancedMesh` per lamp model).
 * Meshes with no instance are hidden, so an office where nobody works adds one draw call.
 */
export class DeskScreens {
  readonly group = new THREE.Group();
  readonly textures: ScreenTextures;
  private readonly desks = new Map<string, DeskEntry>();
  private readonly screens: Record<ScreenState, THREE.InstancedMesh>;
  private readonly lamps = new Map<string, THREE.InstancedMesh>();
  private readonly plane = new THREE.PlaneGeometry(1, 1);
  private readonly materials: THREE.Material[];
  private states = new Map<string, ScreenState>();
  private readonly seats: Map<string, string>;

  /** `props`: the desk props whose models loaded; computers and lamps are used. */
  constructor(
    props: readonly DeskProp[],
    createCanvas?: CanvasFactory,
    layout: OfficeLayout = officeLayout,
  ) {
    this.seats = deskBySeat(layout);
    this.group.name = 'deskScreens';
    this.textures = new ScreenTextures(createCanvas);
    const lampMaterial = new THREE.MeshStandardMaterial({
      color: CFG.lamp.color,
      emissive: CFG.lamp.emissive,
      emissiveIntensity: CFG.lamp.emissiveIntensity,
    });
    const screenMaterials: Record<ScreenState, THREE.MeshBasicMaterial> = {
      off: new THREE.MeshBasicMaterial({ color: CFG.offColor }),
      locked: new THREE.MeshBasicMaterial({ map: this.textures.locked }),
      desktop: new THREE.MeshBasicMaterial({ map: this.textures.desktop }),
    };
    this.materials = [lampMaterial, ...Object.values(screenMaterials)];
    const lift = new THREE.Matrix4().makeTranslation(0, 0, CFG.surfaceOffset);
    const fit = new THREE.Matrix4().makeScale(SCREEN.size[0], SCREEN.size[1], 1);
    for (const prop of props) {
      if (prop.type !== 'computer' || prop.placement.file !== DESK_SCREEN) continue;
      // Lift along the panel normal before the world-axis fit scale, then size the quad.
      const panel = partMatrix(prop, SCREEN);
      const m = new THREE.Matrix4().multiplyMatrices(panel, lift).multiply(fit);
      this.desks.set(prop.deskId, { screen: m });
    }
    for (const prop of props) {
      const shade = SHADES[prop.placement.file];
      const desk = this.desks.get(prop.deskId);
      if (prop.type !== 'desk_lamp' || !shade || !desk) continue;
      const grow = new THREE.Matrix4().makeScale(
        CFG.lamp.shadeGrow,
        CFG.lamp.shadeGrow,
        CFG.lamp.shadeGrow,
      );
      desk.lamp = { file: prop.placement.file, matrix: partMatrix(prop, shade).multiply(grow) };
      if (!this.lamps.has(prop.placement.file)) {
        this.lamps.set(prop.placement.file, this.instanced(shade.geometry(), lampMaterial));
      }
    }
    this.screens = {
      off: this.instanced(this.plane, screenMaterials.off),
      locked: this.instanced(this.plane, screenMaterials.locked),
      desktop: this.instanced(this.plane, screenMaterials.desktop),
    };
    this.apply(new Map());
  }

  private instanced(geometry: THREE.BufferGeometry, material: THREE.Material) {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, this.desks.size));
    // Few, small and spread over the room: culling them would cost more than it saves.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    return mesh;
  }

  /** Desks with a monitor overlay, in layout order. */
  get deskIds(): string[] {
    return [...this.desks.keys()];
  }

  /** Puts every desk's quad and lamp in the mesh for its state; skipped when unchanged. */
  apply(states: ReadonlyMap<string, ScreenState>): void {
    const next = new Map<string, ScreenState>();
    for (const id of this.desks.keys()) next.set(id, states.get(id) ?? 'off');
    if (this.states.size > 0 && [...next].every(([id, s]) => this.states.get(id) === s)) return;
    this.states = next;
    const counts = new Map<THREE.InstancedMesh, number>();
    const put = (mesh: THREE.InstancedMesh, matrix: THREE.Matrix4) => {
      const i = counts.get(mesh) ?? 0;
      mesh.setMatrixAt(i, matrix);
      counts.set(mesh, i + 1);
    };
    for (const [id, desk] of this.desks) {
      const state = next.get(id)!;
      put(this.screens[state], desk.screen);
      if (desk.lamp && lampLit(state)) put(this.lamps.get(desk.lamp.file)!, desk.lamp.matrix);
    }
    for (const mesh of [...STATES.map((s) => this.screens[s]), ...this.lamps.values()]) {
      mesh.count = counts.get(mesh) ?? 0;
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Per frame: screens follow the replicated seats and activities of `room`, then redraw. */
  follow(room: OccupancyRoom, nowMs: number): void {
    this.apply(deskScreenStates(room, this.seats));
    this.update(nowMs);
  }

  /** Redraws the shared desktop texture when due (at most once per second). */
  update(nowMs: number): void {
    this.textures.update(nowMs, [...this.states.values()].includes('desktop'));
  }

  /** Dev hook / tests: what one desk shows, and whether that is actually drawn. */
  info(deskId: string) {
    const state = this.states.get(deskId);
    if (state === undefined) return null;
    const desk = this.desks.get(deskId)!;
    const lamp = desk.lamp ? this.lamps.get(desk.lamp.file) : undefined;
    return {
      state,
      lampLit: lampLit(state) && lamp !== undefined && lamp.visible,
      screenDrawn: this.screens[state].visible,
      texture: state === 'off' ? null : this.textures[state].uuid,
      redraws: this.textures.redraws,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of [...Object.values(this.screens), ...this.lamps.values()]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.textures.dispose();
  }
}
