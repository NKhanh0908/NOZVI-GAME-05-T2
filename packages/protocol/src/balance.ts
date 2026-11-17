/** The wave lasts the same for the legacy `wave` intent and the `wave` emote. */
const WAVE_SECONDS = 1.6;

export const BALANCE = {
  interaction: { facingConeDeg: 90 },
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
    /** Daylight through the south window (layout shell.windows[south_window]). */
    sun: { color: '#fff1dc', intensity: 3.0, position: [2, 6, 9], target: [0, 0, 0] },
    shadow: { mapSize: 2048, bias: -0.0004, normalBias: 0.03, radius: 3, margin: 0.3 },
  },
} as const;
export type Balance = typeof BALANCE;
