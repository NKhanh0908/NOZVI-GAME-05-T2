/** The wave lasts the same for the legacy `wave` intent and the `wave` emote. */
const WAVE_SECONDS = 1.6;

export const BALANCE = {
  interaction: { facingConeDeg: 90 },
  /**
   * Client-only interaction feedback (REQ-INT-001/004/005, T-1156, plan phase-4.1 §3.5).
   * The current target's materials get `highlight.color` as emissive at
   * `highlight.intensity`. Cabinet, fridge and main-door leaves swing open by `openAngleDeg`
   * over `openSeconds` (local only, never replicated); the door exit leaves the room
   * `doorExitSeconds` after E so the swing is seen.
   */
  interactionView: {
    highlight: { color: '#ffcf70', intensity: 0.35 },
    openSeconds: 0.45,
    openAngleDeg: { cabinet: 105, fridge: 100, door: 75 },
    doorExitSeconds: 0.5,
  },
  activity: { drinkSeconds: 2.5, waveSeconds: WAVE_SECONDS, crossFadeSeconds: 0.25 },
  /**
   * REQ-INT-003 coffee routine (plan phase-4.1 §3.4, §6.2). A sip lasts
   * `activity.drinkSeconds`; the machine serves one employee at a time.
   */
  coffee: { brewSeconds: 4, sips: 3 },
  /**
   * REQ-AVATAR-004 emotes (plan phase-4.1 §3.8, DECISIONS 2026-11-17). The server ends an
   * emote after its duration. A new emote is refused until `minGapSeconds` after the
   * previous emote of the same employee started, which also limits the rate.
   */
  emote: {
    durationSeconds: { wave: WAVE_SECONDS, dance: 4, think: 3, laugh: 2.5, stretch: 3 },
    minGapSeconds: 1,
  },
  /**
   * Client-only avatar overlays (plan phase-4.1 §3.7, owner option (a)). Directions are
   * weights of the avatar's forward / up / right axes; the overlay blends in and out over
   * `activity.crossFadeSeconds`.
   */
  avatar: {
    /** REQ-AVATAR-002 typing while `working` (T-1219): alternating taps, Hz per hand. */
    typing: { tapHz: 3.5, tapDepth: 0.35, reach: 0.6, elbowOut: 0.18, handsIn: 0.32 },
    /** REQ-AVATAR-004 emote overlays (T-1222); angles in radians, rates in Hz. */
    emote: {
      think: { headNod: 0.3 },
      laugh: { hz: 4, chest: 0.12, head: 0.2 },
      stretch: { swayHz: 0.5, sway: 0.1, lean: 0.15 },
    },
  },
  /**
   * Client-only coffee presentation (REQ-INT-003, T-1154). Sizes and offsets in metres (a
   * prop is scaled uniformly to its height or its max width, whichever is smaller);
   * `grip` is relative to the hand bone along the avatar's forward / up / right axes;
   * `rest` puts a seated employee's cup `inset` past the near edge of the desk or coffee
   * table and `side` to the seat's right, at least `margin` inside the top. Steam starts
   * `aboveMachine` above the machine's layout position and puffs rise at `riseSpeed` (m/s)
   * for `height`.
   */
  coffeeView: {
    cupHeight: 0.1,
    cupMaxWidth: 0.13,
    glassHeight: 0.12,
    glassMaxWidth: 0.08,
    grip: { forward: 0.03, up: -0.02, right: 0 },
    rest: { inset: 0.14, side: 0.45, margin: 0.06 },
    steam: { puffs: 14, riseSpeed: 0.22, height: 0.35, size: 0.06, aboveMachine: 0.2 },
  },
  /**
   * Client-only working desktop (REQ-INT-002, T-1155, plan phase-4.1 §3.3, §6.3). One shared
   * canvas per screen state, `canvas` pixels; the desktop canvas is redrawn at most every
   * `redrawSeconds` (clock, `lines` text lines in one window, one new line per redraw).
   * Colours name `officeLayout.palette` entries. `offColor` is the empty desk's dark screen;
   * `lockDim` darkens the wallpaper on the lock screen. `surfaceOffset` (m) lifts the screen
   * quad off the monitor panel. The desk lamp shade glows with `lamp` while its desk shows
   * the desktop; `shadeGrow` enlarges the glow shell over the shade.
   */
  deskScreen: {
    canvas: [256, 192],
    redrawSeconds: 1,
    lines: 7,
    wallpaper: ['chairBack', 'deskDividers'],
    window: 'walls',
    text: 'chairSeat',
    offColor: '#0b0c0e',
    lockDim: 0.55,
    surfaceOffset: 0.003,
    lamp: { color: '#fff1d6', emissive: '#ffd9a0', emissiveIntensity: 5, shadeGrow: 1.04 },
  },
  movement: { walkSpeed: 2.0, runSpeed: 4.0, capsuleRadius: 0.3, turnRate: 12 },
  camera: {
    fovDeg: 60,
    distance: 4.0,
    minDistance: 1.0,
    maxDistance: 6.0,
    minPitchDeg: 10,
    maxPitchDeg: 60,
    defaultPitchDeg: 25,
    targetHeight: 1.4,
    stiffness: 10,
    mouseSensitivity: 0.0035,
    occlusionPadding: 0.2,
    /** The camera stays this far below the room ceiling (layout room.dimensions.height). */
    ceilingClearance: 0.15,
    /** Player mesh fades from opaque at fadeStartDistance to fadeMinOpacity at fadeEndDistance. */
    fadeStartDistance: 1.2,
    fadeEndDistance: 1.0,
    fadeMinOpacity: 0.35,
  },
  net: {
    /** Server simulation rate; one client input equals one fixed step of 1 / tickHz seconds. */
    tickHz: 20,
    /** Server state patch interval (Colyseus patchRate). */
    patchMs: 50,
    /** Remote avatars are rendered this far in the past. */
    interpolationDelayMs: 100,
    /** Seat and avatar are held this long after an unexpected disconnect. */
    reconnectSeconds: 20,
    /** Client retry delays after a drop; after the last one the UI offers Rejoin. */
    backoffSeconds: [1, 2, 4, 8],
    maxClients: 10,
    /** Per-client cap on queued inputs (0.5 s at 20 Hz); extra inputs are dropped. */
    inputQueueMax: 10,
    /** Per-client cap on intents waiting for earlier inputs to apply; extra intents are dropped. */
    intentQueueMax: 4,
    joinsPerMinutePerIp: 10,
    /** Client reconciliation: a replayed position closer than this (m) to the prediction is kept. */
    reconcileEpsilon: 0.001,
    /** Client reconciliation: a larger correction is blended in over this many seconds. */
    correctionBlendSeconds: 0.15,
    /**
     * REQ-NET-004 test network profile, dev only: applied to every outgoing server message
     * when the server starts with NET_PROFILE=test (off by default). WebSocket runs on TCP,
     * so a lost segment is never a missing message: it is resent after about one
     * retransmission timeout and holds back everything behind it (a delay spike).
     */
    testProfile: {
      /** Added delay approximating the full round trip (the uplink is not delayed). */
      rttMs: 100,
      /** Uniform jitter of +/- this many ms around rttMs. */
      jitterMs: 20,
      /** Share of messages that pay the retransmission delay (simulated 1% loss). */
      lossPercent: 1,
      /** Extra delay of a "lost" message (Linux minimum TCP retransmission timeout). */
      retransmitMs: 200,
      /** Length of the manual soak run (`e2e/netProfile.spec.ts`). */
      runMinutes: 10,
    },
  },
  /** Phase 4 shared TV (REQ-TV-006, REQ-NFR-005). */
  tv: {
    /** Drift below this many seconds is left alone. */
    ignoreBelowSeconds: 0.5,
    /** Drift from ignoreBelowSeconds up to this many seconds is corrected with a rate nudge. */
    nudgeUpToSeconds: 2,
    /** Drift above nudgeUpToSeconds is corrected with a hard seek. */
    hardSeekAboveSeconds: 2,
    /** A nudge plays at 1 +/- this rate (0.05 = 5 %). */
    nudgeRate: 0.05,
    /** A single nudge lasts at most this long. */
    nudgeMaxSeconds: 2,
    /** Clients are expected to converge within this many seconds after a change. */
    convergenceSeconds: 5,
    /** Phase acceptance: drift between clients after convergence stays below this. */
    driftTargetSeconds: 1.0,
    /** REQ-NFR-005: at most rateLimitCommands TV commands per rateLimitWindowSeconds per client. */
    rateLimitCommands: 5,
    rateLimitWindowSeconds: 10,
  },
  rendering: {
    /** 'agx' or 'aces' (THREE.AgXToneMapping / THREE.ACESFilmicToneMapping). */
    toneMapping: 'aces',
    exposure: 1.0,
    background: '#eceef0',
    /** Intensity of the light probe baked from THREE RoomEnvironment (image-based fill). */
    environmentIntensity: 0.55,
    hemisphere: { sky: '#f2f0ec', ground: '#e6e0d6', intensity: 0.8 },
    /**
     * Daylight through the south window (layout shell.windows[south_window], top edge 2.55 m
     * at z 4.75). T-1150: a lower, warmer sun (about 26 degrees up) so the light falls through
     * the window wall across the desk pods instead of straight down through the ceiling.
     */
    sun: { color: '#fff0d8', intensity: 3.2, position: [1.5, 4.2, 9.5], target: [0, 0, 1] },
    /**
     * T-1150: softer contact shadows: a wider PCF filter radius and shadows that keep some
     * bounce light (intensity < 1) instead of going fully dark.
     */
    shadow: {
      mapSize: 2048,
      bias: -0.0004,
      normalBias: 0.03,
      radius: 6,
      intensity: 0.8,
      margin: 0.3,
    },
    /**
     * T-1150: flush LED ceiling panels (layout shell.lighting[ceiling_light], room centre).
     * Emissive only: they add no light and cast no shadow. A grid of `columns` x `rows`
     * panels, `spacing` metres apart (x, z), centred under the ceiling.
     */
    ceilingFixtures: {
      columns: 4,
      rows: 3,
      spacing: [2.4, 2.4],
      panelSize: 0.6,
      thickness: 0.03,
      color: '#e5e7eb',
      emissive: '#fff8ee',
      /** Linear HDR; above postProcessing.bloom.threshold so panels glow in `high`. */
      emissiveIntensity: 6,
    },
    /**
     * T-1150, `high` render quality only (off in `e2e`): MSAA in the composer targets and a
     * mild bloom. The threshold is in linear HDR before tone mapping, above sunlit walls, so
     * only emissive panels, screens and lamps bloom. Drop bloom (strength 0) if it costs
     * more than 5 FPS on the owner's laptop (plan §6.5).
     */
    postProcessing: {
      msaaSamples: 4,
      bloom: { strength: 0.25, radius: 0.4, threshold: 4 },
    },
    /**
     * T-1149, `high` render quality only: `scene.environment` is a PMREM of THREE
     * RoomEnvironment (soft reflections on glass, metal and screens) at
     * `environmentIntensity`, in place of the light probe. `e2e` keeps the light probe.
     * `blurSigma` is the PMREMGenerator.fromScene blur (radians).
     */
    reflections: { blurSigma: 0.04 },
    /**
     * T-1149: one material table per material class, applied to the loaded Kenney
     * furniture, prop and decor materials (`apps/web/src/game/materials.ts` maps Kenney
     * material names to a class). `palette` names an `officeLayout.palette` entry whose
     * colour the class takes (REQ-ROOM-001: walnut wood, white metal); classes without one
     * keep the Kenney colour.
     */
    materials: {
      // No `palette` colour: recolouring by Kenney material name also tinted the bear, the
      // cardboard box, plant pots and lamp stands; Kenney colours stay (lead, 2026-11-18).
      wood: { roughness: 0.7, metalness: 0 },
      metal: { roughness: 0.4, metalness: 0.4 },
      fabric: { roughness: 0.95, metalness: 0 },
      glass: { roughness: 0.05, metalness: 0 },
      /** Plastic housings and screens (black electronics). */
      plastic: { roughness: 0.3, metalness: 0 },
      default: { roughness: 0.8, metalness: 0 },
    },
  },
} as const;
export type Balance = typeof BALANCE;
