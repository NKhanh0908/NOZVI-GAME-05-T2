import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import { BALANCE, type OfficeLayout } from '@office/protocol';
import { renderQuality, type RenderQuality } from './renderQuality';

const R = BALANCE.rendering;

/**
 * Configures colour output, tone mapping, image-based fill, the window sun and the emissive
 * ceiling panels. The sun's orthographic shadow camera is fitted tightly around `bounds`
 * (the room) in light space. `ready` resolves once the image-based fill is in place (see
 * `setupEnvironment`).
 */
export function setupLighting(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  bounds: THREE.Box3,
  room: OfficeLayout['room'],
  quality: RenderQuality = renderQuality(import.meta.env),
): { ready: Promise<void>; dispose: () => void } {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping =
    R.toneMapping === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
  renderer.toneMappingExposure = R.exposure;
  // r187 removed PCFSoftShadowMap; PCFShadowMap now does soft Vogel-disk filtering via shadow.radius.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  scene.background = new THREE.Color(R.background);
  const environment = setupEnvironment(renderer, scene, quality);

  const h = R.hemisphere;
  scene.add(new THREE.HemisphereLight(h.sky, h.ground, h.intensity));

  const sun = new THREE.DirectionalLight(R.sun.color, R.sun.intensity);
  sun.position.set(...R.sun.position);
  sun.target.position.set(...R.sun.target);
  sun.castShadow = true;
  const s = R.shadow;
  sun.shadow.mapSize.set(s.mapSize, s.mapSize);
  sun.shadow.bias = s.bias;
  sun.shadow.normalBias = s.normalBias;
  sun.shadow.radius = s.radius;
  sun.shadow.intensity = s.intensity;
  fitShadowCamera(sun, bounds, s.margin);
  scene.add(sun, sun.target);

  const fixtures = buildCeilingFixtures(room);
  scene.add(fixtures);

  return {
    ready: environment.ready,
    dispose: () => {
      environment.dispose();
      sun.shadow.dispose();
      fixtures.removeFromParent();
      fixtures.geometry.dispose();
      (fixtures.material as THREE.Material).dispose();
    },
  };
}

/** Image-based fill: a texture to use as `scene.environment` or a light probe to add. */
export type EnvironmentDeps = {
  /** `high`: PMREM of RoomEnvironment; `setupEnvironment` disposes the returned texture. */
  pmrem: (renderer: THREE.WebGLRenderer) => THREE.Texture;
  /** `e2e`: spherical-harmonics light probe baked from RoomEnvironment. */
  probe: (renderer: THREE.WebGLRenderer) => Promise<THREE.LightProbe>;
};

function roomEnvironmentPmrem(renderer: THREE.WebGLRenderer): THREE.Texture {
  const generator = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const target = generator.fromScene(roomEnv, R.reflections.blurSigma);
  roomEnv.dispose();
  generator.dispose();
  return target.texture;
}

function roomEnvironmentProbe(renderer: THREE.WebGLRenderer): Promise<THREE.LightProbe> {
  const cubeTarget = new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType });
  const roomEnv = new RoomEnvironment();
  new THREE.CubeCamera(0.1, 100, cubeTarget).update(renderer, roomEnv);
  roomEnv.dispose();
  return LightProbeGenerator.fromCubeRenderTarget(renderer, cubeTarget).finally(() =>
    cubeTarget.dispose(),
  );
}

const defaultEnvironmentDeps: EnvironmentDeps = {
  pmrem: roomEnvironmentPmrem,
  probe: roomEnvironmentProbe,
};

/**
 * Image-based fill from THREE's RoomEnvironment at `BALANCE.rendering.environmentIntensity`.
 * `high` (T-1149): `scene.environment` is a PMREM of it, which gives the diffuse fill and soft
 * reflections on glass, metal and screens (it replaces the probe, so the fill is not doubled).
 * `e2e`: a spherical-harmonics light probe and no `scene.environment`, since a PMREM
 * environment costs ~70 ms per frame under software WebGL (SwiftShader) while the probe is
 * nearly free. `dispose` clears `scene.environment` and releases the PMREM texture, or
 * removes the probe.
 */
export function setupEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  quality: RenderQuality,
  deps: EnvironmentDeps = defaultEnvironmentDeps,
): { ready: Promise<void>; dispose: () => void } {
  if (quality === 'high') {
    const texture = deps.pmrem(renderer);
    scene.environment = texture;
    scene.environmentIntensity = R.environmentIntensity;
    return {
      ready: Promise.resolve(),
      dispose: () => {
        if (scene.environment === texture) scene.environment = null;
        texture.dispose();
      },
    };
  }
  let disposed = false;
  let added: THREE.LightProbe | undefined;
  const ready = deps
    .probe(renderer)
    .then((probe) => {
      if (disposed) return;
      probe.intensity = R.environmentIntensity;
      scene.add(probe);
      added = probe;
    })
    .catch((e: unknown) => console.warn('Environment light probe unavailable', e));
  return {
    ready,
    dispose: () => {
      disposed = true;
      added?.removeFromParent();
    },
  };
}

type FixtureConfig = {
  columns: number;
  rows: number;
  spacing: readonly [number, number];
  panelSize: number;
  thickness: number;
};

/**
 * Centres of the ceiling panels (T-1150): a `columns` x `rows` grid centred on the room,
 * hung flush under the ceiling. Panels that would cross a wall are left out.
 */
export function ceilingFixturePositions(
  room: OfficeLayout['room'],
  f: FixtureConfig = R.ceilingFixtures,
): [number, number, number][] {
  const y = room.height - f.thickness / 2;
  const half = f.panelSize / 2;
  const out: [number, number, number][] = [];
  for (let r = 0; r < f.rows; r++) {
    const z = (r - (f.rows - 1) / 2) * f.spacing[1];
    if (Math.abs(z) + half > room.depth / 2) continue;
    for (let c = 0; c < f.columns; c++) {
      const x = (c - (f.columns - 1) / 2) * f.spacing[0];
      if (Math.abs(x) + half > room.width / 2) continue;
      out.push([x, y, z]);
    }
  }
  return out;
}

/**
 * The ceiling panels as one `InstancedMesh` (one draw call). Emissive only: no light
 * source and no shadow casting (plan §3.1 render budget).
 */
export function buildCeilingFixtures(room: OfficeLayout['room']): THREE.InstancedMesh {
  const f = R.ceilingFixtures;
  const positions = ceilingFixturePositions(room, f);
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(f.panelSize, f.thickness, f.panelSize),
    new THREE.MeshStandardMaterial({
      color: f.color,
      emissive: f.emissive,
      emissiveIntensity: f.emissiveIntensity,
      roughness: 1,
    }),
    positions.length,
  );
  mesh.name = 'ceiling_fixtures';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const m = new THREE.Matrix4();
  positions.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(...p)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Fits the light's orthographic shadow frustum to the box corners expressed in light space. */
export function fitShadowCamera(light: THREE.DirectionalLight, box: THREE.Box3, margin: number) {
  const cam = light.shadow.camera;
  cam.position.copy(light.position);
  cam.lookAt(light.target.position);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse;
  const ls = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    );
    ls.expandByPoint(p.applyMatrix4(inv));
  }
  cam.left = ls.min.x - margin;
  cam.right = ls.max.x + margin;
  cam.bottom = ls.min.y - margin;
  cam.top = ls.max.y + margin;
  // Camera looks down -Z in its own space.
  cam.near = Math.max(0.05, -ls.max.z - margin);
  cam.far = -ls.min.z + margin;
  cam.updateProjectionMatrix();
}
