# Research — real-time text chat (2-minute expiry) and voice chat

> Status: Research only, 2026-11-19 (Claude Code, owner request). Nothing here is approved or planned. Both features change approved scope and need an owner decision before any plan or Meridian task (AGENTS.md §5).

## 1. Scope position today

| Feature    | PRD (`PRD/Scope.md`)                                     | SPEC / ARCH today                                                                                                                                                  | What an owner "go" changes                                                                                                                           |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text chat  | **Optional** (`Chat UI`, `Chat messages` in PRD-ARCH §5) | "The prototype is chat-free" (SPEC REQ-SCOPE-002, REQ-NFR-005, OQ-026; ARCH §5). Emotes carry ids only to keep it chat-free (phase-4.1 §3.8).                      | Lift the chat-free rule: new REQ-CHAT-xxx in SPEC, a chat rate limit in REQ-NFR-005 / `BALANCE`, ARCH §5 line, DECISIONS entry.                      |
| Voice chat | **Out of scope**                                         | REQ-SCOPE-001 excludes voice; phase-4.1 §7 lists it as parked ("possible Phase 4.2", owner 2026-11-16); "no audio in the client" (phase-4.1 §1, owner 2026-11-15). | A scope change against the PRD (owner approval), plus the zero-cost constraint (ARCH §1) applied to media relays, and the first audio in the client. |

Text chat is a small, self-contained change inside the current architecture. Voice chat is a new subsystem (WebRTC media path, relay infrastructure, permissions, audio) and should be its own phase.

## 2. Text chat with 2-minute expiry

### 2.1 Proposed design

- **Transport:** Colyseus messages on the existing `OfficeRoom` (no new service). New client message `MSG.chat` `{ text }`; server broadcast `SERVER_MSG.chat` `{ id, sessionId, name, text, sentAt, expiresInMs }`.
- **Not in the Colyseus schema.** Messages are events, not shared state; keeping them out of `OfficeState` avoids patch churn and keeps deletion simple.
- **Server memory only:** a per-room ring buffer of messages younger than `BALANCE.chat.ttlSeconds` (120 s), pruned on a timer. A joining or resumed client receives the live buffer once (`chat_history`) so late joiners see the last 2 minutes and a 20 s reconnect does not lose context. Nothing is written to disk; the server must not log message text.
- **Expiry without clock sync:** the server sends `expiresInMs` (remaining lifetime) with every message and in the history; the client removes each message at `receivedAt + expiresInMs` on its own clock. No dependency on the TV clock-offset estimator. A short fade in the last ~10 s.
- **Validation (protocol `parseChat`):** trim, 1–200 visible characters (same counting as names, OQ-026), strip control characters, reject markup-only; rendered as text only (React escaping, `textContent` for bubbles), never `innerHTML`.
- **Rate limit:** reuse `CommandRateLimiter` (e.g. 5 messages per 10 s per client, `chat_rate_limited` notice with `retryAfterMs`), values in `BALANCE.chat`.
- **UI:** a chat panel (bottom-left, tokens from `ui/tokens.css`) opened with Enter, sent with Enter, closed with Esc; plus a speech bubble above the sender's avatar for a few seconds through the existing CSS2D nameplate overlay (`hud/Nameplate.ts`).
- **Keyboard conflict (must fix):** `KeyboardInput` listens on `window` (`apps/web/src/game/input.ts`), so typing "w" in a chat box would also walk. While the chat input has focus the game must read `IDLE_INPUT` and ignore E/G (same pattern as `tvMode.isOpen` in `Game.ts`), and closing chat returns focus through `Game.focusGame()`.

### 2.2 Honest limits of "auto delete"

- Deletion means: gone from server memory and from every client UI after 2 minutes. It cannot stop screenshots, copy-paste or browser extensions. With no accounts or DB there is no other copy.
- A Render restart wipes the buffer earlier (already true for all room state).
- No accounts means no real moderation; a local "hide messages from X" toggle is the realistic option.

### 2.3 Tests

Unit: `parseChat`, expiry pruning with an injected clock, rate limit. Server integration with real SDK clients: broadcast, history on join and on resume, expiry. Playwright (two pages): send, see the bubble and panel line on the other page, gone after a shortened TTL (test override of `BALANCE.chat.ttlSeconds`), typing does not move the avatar.

### 2.4 Rough size

About 5 Meridian-sized tasks: protocol + SPEC/DECISIONS, server, client panel + bubble + focus handling, e2e, docs. No new dependency, no new infrastructure, no cost.

## 3. Voice chat

### 3.1 Options

| Option                                                | How                                                                                                                                                      | Cost for 10 people                                                                                                                                                                                                        | Effort / risk                                                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. P2P mesh, Colyseus as signalling (recommended)** | Browser WebRTC `RTCPeerConnection` per pair, audio only (Opus). Offer/answer/ICE relayed through `OfficeRoom`. STUN for direct paths, TURN for the rest. | Free STUN (`stun.cloudflare.com`, Google). TURN only for peers that cannot connect directly: Cloudflare Realtime TURN has 1,000 GB/month free (shared with its SFU), then $0.05/GB; Metered Open Relay ~20 GB/month free. | No new dependency (browser API). Mesh is fine for ≤ 10 audio-only peers: ~9 × 40–50 kbps up and down per client (~0.5 Mbps each way). Most work is connection state handling. |
| B. Managed SFU (LiveKit Cloud)                        | Each client sends one stream to the SFU; LiveKit SDK on client, token minted by our server.                                                              | Free Build plan: 5,000 WebRTC minutes/month. 10 people × 1 h/day × 22 days ≈ 13,200 minutes → over the free tier.                                                                                                         | New SDK + server secret. Simplest client code, best scaling, breaks the zero-cost rule at real use.                                                                           |
| C. Self-hosted SFU (LiveKit OSS / mediasoup on a VPS) | Same as B on our own server (e.g. Oracle Always Free VPS, ARCH §6 fallback).                                                                             | Free compute, but needs open UDP ports and a VPS the team operates.                                                                                                                                                       | Most ops work; not possible on Render Free (no UDP). Only worth it beyond ~10 per room.                                                                                       |

With `maxClients = 10`, option A covers the requirement without new cost. Option B/C only matter if rooms grow.

### 3.2 Recommended shape (option A)

- **Proximity / zone voice:** connect only to peers within a radius (e.g. 6 m) or in the same zone (lounge, pantry, desks), with distance-based volume through Web Audio `PannerNode` from the existing avatar positions. Fits the "walk over to talk" office feel and reduces the number of live connections. Open question for the owner: proximity vs whole-room.
- **Default muted, push-to-talk or toggle (e.g. V / M key)**; mic permission asked only when the user first enables voice, never on join. Speaking indicator on nameplate and employee list (Web Audio `AnalyserNode` level).
- **Signalling on the server:** new `MSG.rtc` `{ to, kind: offer|answer|ice, payload }`, size-capped and rate-limited; server forwards only to a session in the same room and stamps `from`. Voice state (`micOn`, `speaking`) as small schema fields so others can show icons.
- **TURN credentials:** short-lived credentials minted by the game server from a TURN API key kept in a server env var (Render secret), served over the existing HTTP endpoint; never in frontend code (REQ-NFR security rules).
- **Browser audio:** echo cancellation, noise suppression and auto gain from `getUserMedia` constraints; playback starts after the join click (autoplay policy); lower TV volume while someone speaks (ducking) is a nice-to-have.

### 3.3 Constraints and risks found in this repo

1. **Mouth movement is not possible with current avatars.** `men_suit.glb` / `women_suit.glb` have no jaw bone and no morph targets. Options: a speaking icon/ring above the nameplate (cheap), a small procedural head nod in `avatar/overlays.ts` driven by voice level, or new avatar assets (out of the current CC0 set).
2. **Secure context:** `getUserMedia` works on `localhost` and HTTPS only. The planned LAN playtest over `http://<ip>:5173` will not get a microphone; it needs HTTPS for the dev server (e.g. a self-signed certificate) or the deployed Phase 5 URL.
3. **Render Free sleeps/restarts:** calls drop with the room; acceptable for a prototype, same as other state.
4. **Corporate networks:** UDP is often blocked; TURN over TLS 443 is needed for those users. This is where TURN traffic (and possible cost) comes from.
5. **Testing:** Playwright Chromium can use `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` for a two-page connection test; audio quality and echo still need a manual check with real devices.
6. **Privacy:** the room code is not authentication (PRD security note), so anyone with the code can listen. Default-muted and a visible "mic on" state are the minimum.
7. **Performance:** audio adds little GPU cost; the main client cost is up to 9 peer connections. Keep the render budget checks from phase-4.1 §3.1 unchanged.

### 3.4 Rough size

About 8–10 tasks: protocol + SPEC/DECISIONS/scope change, server signalling + voice state, TURN credential endpoint, client peer manager (connect/renegotiate/close on leave and reconnect), mic UI + push-to-talk + permissions, spatial audio, speaking indicator, e2e with fake media, manual multi-device check, docs (DEPLOY: TURN secret). Introduces the first external service account (TURN provider) unless STUN-only is accepted for LAN testing.

## 4. Recommendation

1. **Text chat first.** Small, no cost, no new infrastructure, already "Optional" in the PRD; needs the owner to lift the SPEC "chat-free" rule.
2. **Voice as a separate phase (the parked "Phase 4.2")**, option A (P2P mesh, Colyseus signalling, proximity audio, push-to-talk), with Cloudflare TURN behind a server-side key. Decide before planning: proximity vs whole room, push-to-talk vs toggle, speaking indicator vs mouth movement, and whether a TURN account is acceptable under the zero-cost rule.

## 5. Sources

- LiveKit Cloud plans: https://livekit.com/pricing, quotas: https://docs.livekit.io/deploy/admin/quotas-and-limits/
- Cloudflare Realtime TURN pricing: https://developers.cloudflare.com/realtime/sfu/pricing, FAQ: https://developers.cloudflare.com/realtime/turn/faq/
- Metered Open Relay: https://metered.ca/tools/openrelay/
