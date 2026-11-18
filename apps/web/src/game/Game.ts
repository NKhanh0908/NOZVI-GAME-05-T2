import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  BALANCE,
  MSG,
  officeLayout,
  type AvatarId,
  type EmoteId,
  type IntentMessage,
} from '@office/protocol';
import { CameraRig } from './camera';
import { fadeOpacity } from './cameraMath';
import { KeyboardInput } from './input';
import { Player } from './player';
import { setupLighting } from './lighting';
import { buildRoom } from './room';
import { renderQuality, type RenderQuality } from './renderQuality';
import { loadFurniture } from './assets/loadFurniture';
import { AvatarView } from './avatar/AvatarView';
import { InteractionController, type Prompt } from './interaction/InteractionController';
import { Nameplate } from './hud/Nameplate';
import { handleAction } from './interaction/extras';
import { activityLabel } from './hud/activityLabel';
import { RemoteAvatars } from './remote/RemoteAvatars';
import { EntranceBoard } from './hud/EntranceBoard';
import { EmployeeRoster } from '../ui/employeeRoster';
import { bindPrediction, employeeSource, roomOccupancy, type OfficeRoomHandle } from '../net';
import { TvScreen } from '../tv/TvScreen';
import { TvCssLayer } from '../tv/TvCssLayer';
import { FakeTvPlayer, type TvPlayer } from '../tv/player';
import { tvPlayerKind, YouTubeTvPlayer } from '../tv/youtubePlayer';
import { FakeVideoProvider, YouTubeProvider, type VideoProvider } from '../tv/provider';
import { TvBinding } from '../tv/TvBinding';
import { TvMode } from '../tv/TvMode';
import { TvErrorScreen } from '../tv/TvErrorScreen';

const IDLE_INPUT = { forward: 0, right: 0, run: false } as const;

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(BALANCE.camera.fovDeg, 1, 0.05, 50);
  /** alpha: the TV occluder clears to transparent so the CSS3D layer below shows through. */
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly labelRenderer = new CSS2DRenderer();
  /** T-1146: `e2e` in Playwright builds; later Phase 4.1 effects check it. */
  readonly renderQuality: RenderQuality = renderQuality(import.meta.env);
  /** REQ-TV-001: WebGL bezel and occluder, plus the CSS3D layer holding the screen element. */
  readonly tvScreen = new TvScreen(officeLayout);
  readonly tvLayer = new TvCssLayer(this.tvScreen);
  /** P4.6: the video player inside the TV screen; e2e builds use the fake one. */
  readonly tvPlayer: TvPlayer =
    tvPlayerKind(import.meta.env) === 'fake'
      ? new FakeTvPlayer(this.tvLayer.container)
      : new YouTubeTvPlayer(this.tvLayer.container);
  /** REQ-TV-003: catalog and URL parser; the fake one keeps e2e off ytimg.com thumbnails. */
  readonly tvProvider: VideoProvider =
    tvPlayerKind(import.meta.env) === 'fake' ? new FakeVideoProvider() : new YouTubeProvider();
  /** REQ-TV-004: panel commands go to the room; the player follows the replicated `tv`. */
  readonly tvControls = new TvBinding(this.tvPlayer, {
    catalogDuration: (id) => this.tvProvider.getVideo(id)?.duration ?? null,
    visibility: document,
  });
  /** REQ-TV-009: per-video error card on the screen; the binding reports changes. */
  private readonly tvErrorScreen = new TvErrorScreen(this.tvLayer.container);
  private readonly offTvError = this.tvControls.onErrorChange((e) => this.tvErrorScreen.show(e));
  /** REQ-TV-002: TV mode makes the screen clickable and hands focus back on close. */
  readonly tvMode = new TvMode((open) => this.applyTvMode(open));
  private readonly nameplate = new Nameplate();
  readonly player = new Player();
  readonly input = new KeyboardInput(window);
  /** Seats are owned by the server; this only sends intents (see `Player.applyServer`). */
  readonly controller: InteractionController;
  onPrompt: ((prompt: Prompt) => void) | undefined;
  onToast: ((message: string) => void) | undefined;
  onExit: (() => void) | undefined;
  onFrame: ((dt: number) => void) | undefined;
  private promptText: string | null = null;
  // WASD while seated needs no handler: movement inputs reach the server, which stands up.
  private readonly keydown = (e: KeyboardEvent): void => {
    if (this.tvMode.isOpen) {
      // Esc closes the panel while the app has focus; other game keys wait for Close.
      if (e.code === 'Escape') this.tvMode.exit();
      return;
    }
    if (e.code === 'KeyE' && !e.repeat) this.controller.press();
    if (e.code === 'KeyG' && !e.repeat) this.controller.wave();
  };
  private readonly timer = new THREE.Timer();
  private readonly resizeObserver: ResizeObserver;
  private readonly rig: CameraRig;
  private readonly debugHook: unknown;
  private readonly disposeLighting: () => void;
  private furniture: Awaited<ReturnType<typeof loadFurniture>> | undefined;
  private disposed = false;
  /** Disconnects local prediction from the room (inputs out, patches in). */
  private unbindPrediction: () => void;
  /** Joined office room; replaced by `attachRoom` when the session is resumed. */
  private room: OfficeRoomHandle;
  private readonly remotes: RemoteAvatars;
  /** Employee list for the 2D panel and the entrance board (REQ-UI-003). */
  readonly roster: EmployeeRoster;
  private readonly board = new EntranceBoard(officeLayout);
  private readonly unbindBoard: () => void;

  constructor(
    private readonly host: HTMLElement,
    private readonly identity: { name: string; avatarId: AvatarId },
    /** Joined office room; owned by the connection, which leaves it on exit. */
    netRoom: OfficeRoomHandle,
  ) {
    this.room = netRoom;
    // Occupancy always reads the current room, also after a resumed session.
    const current = () => this.room;
    this.controller = new InteractionController(
      this.player,
      roomOccupancy({
        get state() {
          return current().state;
        },
      }),
      netRoom.sessionId,
      {
        onExit: () => this.onExit?.(),
        sendIntent: (intent) => this.sendIntent(intent),
        onAction: (target) => {
          const result = handleAction(target, this.player, this.controller);
          if (result.message) this.onToast?.(result.message);
        },
        onTv: () => this.tvMode.enter(),
      },
    );
    this.unbindPrediction = this.bindRoom(netRoom);
    this.tvControls.attach(netRoom);
    const office = buildRoom(officeLayout);
    this.remotes = new RemoteAvatars(this.scene, employeeSource(netRoom), netRoom.sessionId);
    this.scene.add(office);
    this.roster = new EmployeeRoster(employeeSource(netRoom), netRoom.sessionId);
    this.scene.add(this.board.mesh);
    this.scene.add(this.tvScreen.group);
    this.board.set(this.roster.count);
    this.unbindBoard = this.roster.subscribe(() => this.board.set(this.roster.count));
    const occluders: THREE.Object3D[] = [];
    office.traverse((o) => {
      if (o.userData.occluder) occluders.push(o);
    });
    void loadFurniture(office, officeLayout).then((result) => {
      this.furniture = result;
      occluders.length = 0;
      office.updateMatrixWorld(true);
      office.traverse((o) => {
        if (o.userData.occluder) occluders.push(o);
      });
    });
    this.scene.add(this.player.mesh);
    this.player.mesh.add(this.nameplate.object);
    void AvatarView.load(identity.avatarId)
      .then((view) => {
        if (!this.disposed) {
          this.player.setView(view);
          // setView clears the fallback mesh, including its attached nameplate.
          this.player.mesh.add(this.nameplate.object);
        }
      })
      .catch((error: unknown) => console.warn('Avatar loading failed; keeping capsule.', error));
    this.rig = new CameraRig(this.camera, this.renderer.domElement, occluders);
    this.rig.yaw = this.player.state.heading;
    this.scene.updateMatrixWorld(true);
    this.rig.update(this.player.mesh.position, 0);
    const lighting = setupLighting(
      this.renderer,
      this.scene,
      new THREE.Box3().setFromObject(office),
    );
    this.disposeLighting = lighting.dispose;
    if (import.meta.env.DEV) {
      let lightingReady = false;
      void lighting.ready.then(() => (lightingReady = true));
      this.debugHook = {
        getPlayer: () => ({ ...this.player.state }),
        getCameraYaw: () => this.rig.yaw,
        getCamera: () => {
          const { x, y, z } = this.camera.position;
          return { x, y, z, yaw: this.rig.yaw, pitch: this.rig.pitchInUse };
        },
        setPose: (p: { x: number; z: number; heading: number; yaw?: number; pitch?: number }) => {
          this.player.teleport(p.x, p.z, p.heading);
          this.rig.yaw = p.yaw ?? p.heading;
          if (p.pitch !== undefined) this.rig.pitch = p.pitch;
        },
        getDrawCalls: () => this.measureDrawCalls(),
        getRenderQuality: () => this.renderQuality,
        isLightingReady: () => lightingReady,
        getFurniture: () => this.furniture,
        getActivity: () => this.player.activity,
        teleport: (x: number, z: number, heading: number) => {
          this.player.teleport(x, z, heading);
          this.rig.yaw = heading;
        },
        // Turns the camera only, so e2e can walk with keys in a server-visible way.
        setCameraYaw: (yaw: number) => {
          this.rig.yaw = yaw;
        },
        avatarOk: () => this.player.viewFinite(),
        getTyping: () => this.player.typing,
        getEmote: () => this.player.emote,
        getRemotes: () => this.remotes.list(),
        getRemoteCount: () => this.remotes.count,
        getBoardText: () => this.board.text,
        getTv: () => this.tvInfo(),
        getTvPlayer: () => this.tvPlayer,
        isTvMode: () => this.tvMode.isOpen,
        openTvMode: () => this.tvMode.enter(),
        getTvView: () => this.tvControls.view(),
        getTvSync: () => ({ ...this.tvControls.snapshot, expected: this.tvControls.expected() }),
      };
      (window as unknown as { __office: unknown }).__office = this.debugHook;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Stacking: CSS3D TV layer (0) under the WebGL canvas (1) under the labels (2).
    this.renderer.domElement.style.position = 'relative';
    this.renderer.domElement.style.zIndex = '1';
    // Focusable without a tab stop, so closing TV mode can take focus back from the iframe.
    this.renderer.domElement.tabIndex = -1;
    this.renderer.domElement.style.outline = 'none';
    host.appendChild(this.renderer.domElement);
    this.tvLayer.mount(host);
    this.labelRenderer.domElement.style.cssText =
      'position:absolute;top:0;left:0;pointer-events:none;z-index:2';
    host.appendChild(this.labelRenderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    window.addEventListener('keydown', this.keydown);
  }

  /** The joined office room (the latest handle after a resumed session). */
  get netRoom(): OfficeRoomHandle {
    return this.room;
  }

  /** The connection dropped: stop sending inputs until a session is attached again. */
  detachRoom(): void {
    this.unbindPrediction();
    this.unbindPrediction = () => undefined;
    this.tvControls.detach();
  }

  /**
   * REQ-NET-005: the same session was resumed on a new room handle. Prediction is rebound
   * and resynced to the server position, and the remote avatars and the employee list are
   * rebuilt from the full state the server sends on reconnect.
   */
  attachRoom(netRoom: OfficeRoomHandle): void {
    this.unbindPrediction();
    this.room = netRoom;
    this.player.predictor.resync();
    this.unbindPrediction = this.bindRoom(netRoom);
    this.remotes.rebind(employeeSource(netRoom));
    this.roster.rebind(employeeSource(netRoom));
    this.tvControls.attach(netRoom);
  }

  private bindRoom(netRoom: OfficeRoomHandle): () => void {
    return bindPrediction(netRoom, this.player.predictor, (self) => this.player.applyServer(self));
  }

  private sendIntent(intent: IntentMessage): void {
    try {
      this.netRoom.send(MSG.intent, intent);
    } catch (error) {
      // A closed socket drops the request; nothing changes until the server confirms.
      console.warn('Intent not sent.', error);
    }
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.tvLayer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * REQ-TV-002: in TV mode the screen element takes clicks, and the WebGL canvas above it
   * lets pointer events through (so no camera orbit until Close). Leaving TV mode puts
   * both back and returns keyboard focus from a clicked iframe to the game canvas.
   */
  private applyTvMode(open: boolean): void {
    this.tvLayer.container.style.pointerEvents = open ? 'auto' : 'none';
    this.renderer.domElement.style.pointerEvents = open ? 'none' : '';
    if (open) return;
    this.focusGame();
  }

  /** Gives keyboard focus back to the game canvas (TV Close, emote menu closed). */
  focusGame(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    this.renderer.domElement.focus({ preventScroll: true });
  }

  /** REQ-AVATAR-004 (T-1222): the emote menu's request; the server decides. */
  emote(emote: EmoteId): boolean {
    return this.controller.emote(emote);
  }

  canEmote(emote: EmoteId): boolean {
    return this.controller.canEmote(emote);
  }

  /** Renders two frames: one with the shadow pass, one reusing the shadow map (main pass only). */
  private measureDrawCalls(): { total: number; main: number; shadow: number; triangles: number } {
    const shadowMap = this.renderer.shadowMap;
    this.renderer.render(this.scene, this.camera);
    const total = this.renderer.info.render.calls;
    const triangles = this.renderer.info.render.triangles;
    const autoUpdate = shadowMap.autoUpdate;
    shadowMap.autoUpdate = false;
    this.renderer.render(this.scene, this.camera);
    const main = this.renderer.info.render.calls;
    shadowMap.autoUpdate = autoUpdate;
    return { total, main, shadow: total - main, triangles };
  }

  start(): void {
    this.renderer.setAnimationLoop(() => {
      this.timer.update();
      const dt = Math.min(this.timer.getDelta(), 0.1);
      // TV mode: the panel has the keyboard (URL field); the player stands still until Close.
      const input = this.tvMode.isOpen ? IDLE_INPUT : this.input.read();
      this.player.update(input, this.rig.yaw, dt);
      const prompt = this.tvMode.isOpen ? null : this.controller.currentPrompt();
      const text = prompt?.text ?? null;
      if (text !== this.promptText) {
        this.promptText = text;
        this.onPrompt?.(prompt);
      }
      this.rig.update(this.player.mesh.position, dt);
      this.player.setOpacity(fadeOpacity(this.rig.distanceToFocus));
      this.onFrame?.(dt);
      this.remotes.update(dt);
      this.nameplate.set(this.identity.name, activityLabel(this.player.activity));
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
      this.tvLayer.render(this.camera);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.tvMode.exit();
    this.renderer.setAnimationLoop(null);
    this.unbindPrediction();
    this.input.dispose();
    window.removeEventListener('keydown', this.keydown);
    this.rig.dispose();
    this.remotes.dispose();
    this.unbindBoard();
    this.roster.dispose();
    this.board.dispose();
    const w = window as unknown as { __office?: unknown };
    if (this.debugHook !== undefined && w.__office === this.debugHook) delete w.__office;
    this.resizeObserver.disconnect();
    this.disposeLighting();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
    this.offTvError();
    this.tvControls.dispose();
    this.tvErrorScreen.dispose();
    this.tvPlayer.dispose();
    this.tvLayer.dispose();
    this.tvScreen.dispose();
  }

  /** Dev hook: TV screen pose, CSS layer size and whether the screen centre is in view. */
  private tvInfo() {
    const { position, width, height, rotY } = this.tvScreen.pose;
    this.camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      ),
    );
    const [centre] = this.tvScreen.worldPoints();
    const layer = this.tvLayer.renderer.domElement;
    const box = this.tvLayer.container.getBoundingClientRect();
    return {
      position,
      width,
      height,
      rotY,
      inView: frustum.containsPoint(centre!),
      layerSize: { width: layer.clientWidth, height: layer.clientHeight },
      screenRect: { x: box.x, y: box.y, width: box.width, height: box.height },
      pointerEvents: getComputedStyle(this.tvLayer.container).pointerEvents,
      canvasPointerEvents: getComputedStyle(this.renderer.domElement).pointerEvents,
      mounted: layer.isConnected && this.tvLayer.container.isConnected,
    };
  }
}
