# Phase 4.2 — Text chat with 1-minute expiry

> Status: Scope approved by the owner on 2026-11-19 (chat): add text chat as Phase 4.2, started only after Phase 4.1 (FEAT-68) is closed. All §6 decisions confirmed by the owner on 2026-11-19 (speech bubbles added to scope). Research: `docs/plans/research-voice-text-chat.md` §2 (written for a 2-minute expiry; this plan supersedes its TTL and its transport choice). Tracked in Meridian as FEAT-150 (auto-approved 2026-11-20 Asia/Saigon), tasks T-1692 to T-1697 (§4); the speech bubble is FEAT-151 (task 7), split because a Meridian requirement holds at most six tasks.

**Goal:** Employees in the same office can send short text messages to everyone in the room through the existing Colyseus `OfficeRoom`. Every message is deleted for good one minute after it was sent: removed from server memory and from every client, with no other copy anywhere.

**Owner decisions behind this plan (2026-11-19, chat):**

1. Text chat is in scope. This lifts the "prototype is chat-free" rule in SPEC (REQ-NET-008, REQ-NFR-005, REQ-SCOPE-002, defaults table, OQ-026) and ARCHITECTURE §5; PRD already lists text chat as optional (`PRD/Scope.md`, PRD-ARCH §5).
2. Use what the project already has: Colyseus on the existing room, no new service, dependency or storage.
3. Messages are deleted permanently 60 s after they appear (the server accepts the message and it reaches every client in the same patch).
4. Phase 4.2 starts after Phase 4.1 is closed.
5. Chat is for the whole office (everyone with the same office code), and the sender's message also shows as a speech bubble above their avatar.

Voice chat stays parked (phase-4.1 decision 9); it is not part of this phase.

## 1. Starting point

- One `OfficeRoom` per office code, max 10 clients, server-authoritative state in `OfficeState` (`packages/protocol/src/net/schema.ts`), 20 Hz fixed-step tick (`apps/server/src/rooms/OfficeRoom.ts`).
- Per-client message budgets already exist (`CommandRateLimiter`, used for TV commands and clock samples).
- No accounts and no database (DECISIONS 2026-11-09); room state is in memory and lost on restart.
- `KeyboardInput` listens on `window` (`apps/web/src/game/input.ts`), so a text box would also move the avatar unless the game ignores keys while it has focus. The TV panel already does this with `tvMode.isOpen`.

## 2. Entry gates

| Gate                       | Blocks    | Why                                                         |
| -------------------------- | --------- | ----------------------------------------------------------- |
| Phase 4.1 closed (FEAT-68) | All tasks | Owner decision 4; both phases edit protocol, `App.tsx`, e2e |

## 3. Design

### 3.1 Transport: room state, not broadcast events

Messages live in the room state as a schema collection (`OfficeState.chat`, entries `ChatMessageState { id, sessionId, name, text, sentAt }`), written only by the server.

The research note proposed broadcast events plus a history message. Room state is chosen instead because:

- Deletion is one server action: removing the entry removes it from every client through the normal patch, so no client keeps a message after the server dropped it.
- Late joiners and resumed sessions (20 s reconnect window) get the live messages from the full state sync, with no extra `chat_history` path.
- The size is bounded and small: at most `maxMessages` entries of at most `maxLength` characters for at most ten clients.

`sentAt` is the server clock (`roomServices.now()`). The client never decides expiry; it shows what the state holds.

### 3.2 Server

- `MSG.chat` `{ text }` → `parseChatMessage` (protocol) → per-client `CommandRateLimiter` → append with `id`, sender `sessionId`, sender name and `sentAt`.
- Over budget: `chat_rate_limited` notice `{ retryAfterMs }` to the sender only, message dropped. Invalid payloads are dropped silently, as for TV commands.
- Expiry: in the existing tick, remove every entry with `now - sentAt >= ttlSeconds * 1000` (at most one tick late, about 50 ms). If the collection is full, the oldest entry is removed first.
- A sender who leaves keeps their messages until they expire (they were already seen); `onLeave` only forgets the rate-limit budget.
- The server never logs message text.
- Test hook: the TTL comes from `roomServices` (default `BALANCE.chat.ttlSeconds`) so integration and e2e tests can shorten it, like `reconnectSeconds`.

### 3.3 Protocol

- `parseChatMessage`: trim, strip control characters, 1 to `maxLength` visible characters (same counting as names, OQ-026), reject anything else.
- `BALANCE.chat`: `ttlSeconds`, `maxLength`, `maxMessages`, `rateLimitMessages`, `rateLimitWindowSeconds`.
- `PROTOCOL_VERSION` + 1.

### 3.4 Client

- `net/chat.ts`: plain TS store over the room's `chat` collection (add / remove callbacks, stable snapshot, `rebind` after a resumed session), same pattern as `ui/employeeRoster.ts`.
- `ui/ChatPanel.tsx`: message list (name, text, local time), input, send; styles from `ui/tokens.css`. Text is rendered as text only (React escaping), never as HTML. Rate-limit notice shown until `retryAfterMs`.
- Keys: Enter opens the input and focuses it; Enter sends; Esc closes and returns focus through `Game.focusGame()`. While the input has focus the game reads idle input and ignores E, F, G and the emote menu.
- Speech bubble (task 7): above the sender's head, local player included, drawn through the existing CSS2D overlay next to the nameplate (`game/hud/Nameplate.ts`, `remote/RemoteAvatars.ts`, `player.ts`). It shows the sender's newest live message for `BALANCE.chat.bubbleSeconds` (6 s), cut to `bubbleMaxChars` (80) with an ellipsis, replaced by a newer message, and removed at once if the server deletes the message. Text only (`textContent`), styles from tokens. The full message stays in the panel until it expires.
- Nothing about chat is written to `localStorage` or `sessionStorage`.

### 3.5 What "deleted permanently" means

After one minute the message is gone from server memory and from every client's state and screen. There is no database, file or log that holds it. Limits the owner should know: nothing stops a viewer from taking a screenshot or copying text during that minute, and a server restart deletes messages earlier.

## 4. Tasks

Two Meridian requirements: FEAT-150 (tasks 1–6, the project limit of six per requirement) and FEAT-151 (task 7). Each task stays within the 30-minute cap. Order: 1 → 2 → 3 → 4 → 5 → 7 → 6 (Meridian does not record dependencies inside one requirement; follow this order by hand). Task 6 runs the e2e for the bubble too.

| #   | Meridian | Task                                                                                    | Requirements                            |
| --- | -------- | --------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | T-1692   | Docs: lift chat-free in SPEC and ARCHITECTURE, new REQ-CHAT-001/002, DECISIONS entry    | REQ-SCOPE-002, REQ-NFR-005, OQ-026      |
| 2   | T-1693   | Protocol: chat schema, `parseChatMessage`, `BALANCE.chat`, message names, version bump  | REQ-CHAT-001, REQ-CHAT-002              |
| 3   | T-1694   | Server: chat handler, rate limit and notice, expiry in the tick, injectable TTL         | REQ-CHAT-001, REQ-CHAT-002, REQ-NFR-005 |
| 4   | T-1695   | Client: chat store over room state and the chat panel                                   | REQ-CHAT-001, REQ-UI-001                |
| 5   | T-1696   | Client: chat keys and focus (Enter / Esc, game input idle while typing)                 | REQ-CHAT-001, REQ-MOVE-001              |
| 6   | T-1697   | Two-page e2e (send, receive, expiry with a short TTL, typing does not walk) and records | REQ-CHAT-001, REQ-CHAT-002              |
| 7   | T-1698   | Client: speech bubble above the sender's avatar (FEAT-151)                              | REQ-CHAT-003                            |

## 5. Phase acceptance

- Two browsers in the same office: a message sent in one appears in both within one patch.
- With the default TTL, the message disappears from both browsers and from the server state 60 s after it was sent (±0.1 s on the server); a browser that joins at 30 s sees it and loses it at the same moment.
- Over the rate limit, the sender sees the notice and the message reaches nobody.
- The other browser sees a bubble with the message above the sender's avatar for 6 s; the sender sees it above their own avatar.
- Typing W, A, S, D, E, F or G in the chat input does not move the avatar or trigger an interaction.
- Server logs contain no message text; browser storage contains no chat data.
- `pnpm check` passes; e2e chat spec passes; existing e2e (walk, emote, tv, reconnect) still pass.

## 6. Owner decisions (all confirmed on 2026-11-19)

1. **Audience.** Everyone in the same office code (not proximity).
2. **Expiry clock.** 60 s from the moment the message appears. It appears for everyone in the patch right after the server accepts it (at most about 50 ms later), so the server counts from acceptance; a late joiner sees only the time left.
3. **Limits.** Confirmed by the owner on 2026-11-19: up to 200 visible characters per message, 5 messages per 10 s per employee, at most 50 messages held per room.
4. **Speech bubble above the avatar.** In scope (task 7). Defaults for the bubble: shown 6 s, cut to 80 characters; say if you want different values.

## 7. Out of scope

Voice chat, private or direct messages, proximity chat, message history beyond one minute, editing or deleting your own message early, moderation tools, emoji pickers, attachments and links that open previews.

## 8. Risks

- Bubble draw cost: CSS2D elements, no WebGL draw calls; at most one bubble per employee.
- Keyboard leaks into the game while typing: covered by task 5 and the e2e check.
- Patch size: bounded by `maxMessages` and `maxLength`; checked in task 3 tests.
- Expectation of privacy: §3.5 limits are stated in the UI help text and in SPEC.
