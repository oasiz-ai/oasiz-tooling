# @oasiz/sdk

Typed SDK for integrating games with the Oasiz platform. Handles score submission, haptic feedback, cross-session state persistence, multiplayer room codes, navigation hooks, and app lifecycle events for local development.

## Install

```bash
npm install @oasiz/sdk
```

## Quick start

```ts
import { oasiz } from "@oasiz/sdk";

// 1. Load persisted state at the start of each session
const state = oasiz.loadGameState();
let level = typeof state.level === "number" ? state.level : 1;

// 2. Save state at checkpoints
oasiz.saveGameState({ level, coins: 42 });

// 3. Trigger haptics on key events
oasiz.triggerHaptic("medium");

// 4. Respect the host's top safe area
document.documentElement.style.setProperty(
  "--safe-top",
  `${oasiz.safeAreaTop}px`,
);

// 5. Submit score when the game ends
oasiz.submitScore(score);

// 6. Optionally hide the leaderboard while a custom overlay is open
oasiz.setLeaderboardVisible(false);

// 7. Optionally surface console logs in-game while debugging
oasiz.enableLogOverlay({
  enabled: new URLSearchParams(window.location.search).has("oasizLogs"),
  collapsed: true,
});
```

---

## Score

### `oasiz.submitScore(score: number)`

Submit the player's final score at game over. Call this exactly once per session, when the game ends. The platform handles leaderboard persistence — do not track high scores locally.

```ts
private onGameOver(): void {
  oasiz.submitScore(Math.floor(this.score));
}
```

- `score` must be a non-negative integer. Floats are floored automatically.
- Do not call on intermediate scores or level completions, only on final game over.

---

## Haptics

### `oasiz.triggerHaptic(type: HapticType)`

Trigger native haptic feedback. Always guard with the user's haptics setting.

```ts
type HapticType = "light" | "medium" | "heavy" | "success" | "error";
```

| Type | When to use |
|---|---|
| `"light"` | UI button taps, menu navigation, D-pad press |
| `"medium"` | Collecting items, standard collisions, scoring |
| `"heavy"` | Explosions, major impacts, screen shake |
| `"success"` | Level complete, new high score, achievement unlocked |
| `"error"` | Damage taken, game over, invalid action |

```ts
// UI buttons — always light
button.addEventListener("click", () => {
  oasiz.triggerHaptic("light");
});

// Tiered hit feedback
private onBallHit(zone: "center" | "edge"): void {
  if (this.settings.haptics) {
    oasiz.triggerHaptic(zone === "center" ? "success" : "medium");
  }
}

// Game over
private onGameOver(): void {
  oasiz.submitScore(this.score);
  if (this.settings.haptics) {
    oasiz.triggerHaptic("error");
  }
}
```

Haptics are throttled internally (50ms cooldown) to prevent spam.

---

## Debugging

### `oasiz.enableLogOverlay(options?: LogOverlayOptions)`

Mount an opt-in in-game console viewer for local debugging, QA sessions, or creator support. It mirrors `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug` into a floating overlay inside the game iframe. The overlay can be collapsed, repositioned by dragging the top bar, and resized from the bottom-right corner while the action buttons remain clickable.

```ts
const logOverlay = oasiz.enableLogOverlay({
  enabled: new URLSearchParams(window.location.search).has("oasizLogs"),
  collapsed: true,
});

console.log("[Boot] Scene ready");

// Optional cleanup if your game tears down and remounts
logOverlay.destroy();
```

Options:
- `enabled`: defaults to `true`. Pass your own flag or query-param check here.
- `collapsed`: start with only the toggle pill visible.
- `maxEntries`: cap retained log lines. Defaults to `200`.
- `title`: optional label shown at the top of the panel. Defaults to `SDK Logs`.

The returned handle supports `show()`, `hide()`, `clear()`, `isVisible()`, and `destroy()`.

---

## Game state persistence

Persist cross-session data such as unlocked levels, inventory, or lifetime stats. State is stored per-user per-game in the Oasiz backend — available across devices and app reinstalls.

### `oasiz.loadGameState(): Record<string, unknown>`

Returns the player's saved state synchronously. Returns `{}` if no state has been saved yet. Call once at the start of the game.

```ts
private initFromSavedState(): void {
  const state = oasiz.loadGameState();
  this.level        = typeof state.level === "number" ? state.level : 1;
  this.lifetimeHits = typeof state.lifetimeHits === "number" ? state.lifetimeHits : 0;
  this.unlockedSkins = Array.isArray(state.unlockedSkins) ? state.unlockedSkins : [];
}
```

Always validate the shape of loaded data — it may be `{}` on first play.

### `oasiz.saveGameState(state: Record<string, unknown>)`

Queues a debounced save. Saves are batched automatically — call freely at checkpoints without worrying about request spam.

```ts
// Save after each level completion
private onLevelComplete(): void {
  this.level += 1;
  oasiz.saveGameState({
    level: this.level,
    lifetimeHits: this.lifetimeHits,
    unlockedSkins: this.unlockedSkins,
  });
}
```

**Rules:**
- State must be a plain JSON object (not an array or primitive).
- Do not use `localStorage` for cross-session progress — use `saveGameState` so data syncs across platforms.
- Do not store scores here — scores are submitted via `submitScore`.

### `oasiz.flushGameState()`

Forces an immediate write, bypassing the debounce. Use at important checkpoints like game over or before the page unloads.

```ts
private onGameOver(): void {
  oasiz.saveGameState({ level: this.level, lifetimeHits: this.lifetimeHits });
  oasiz.flushGameState(); // ensure it lands before the page closes
  oasiz.submitScore(this.score);
}
```

---

## Layout

Use the runtime safe-area value instead of hardcoded top offsets. The host reports the current top inset in CSS pixels for persistent chrome such as the back button and top controls.

### `oasiz.getSafeAreaTop(): number`

Returns the current top inset. Unsupported hosts return `0`.

```ts
const safeTop = oasiz.getSafeAreaTop();
document.documentElement.style.setProperty("--safe-top", `${safeTop}px`);
```

### `oasiz.safeAreaTop`

Getter alias for `getSafeAreaTop()`.

Recommended CSS pattern:

```css
:root {
  --safe-top: 0px;
}

#top-bar {
  padding-top: var(--safe-top);
}
```

### `oasiz.setLeaderboardVisible(visible: boolean): void`

Show or hide the host leaderboard UI from inside the game. This only affects the leaderboard; back and social controls remain visible.

```ts
function openCustomOverlay(): void {
  oasiz.setLeaderboardVisible(false);
}

function closeCustomOverlay(): void {
  oasiz.setLeaderboardVisible(true);
}
```

Unsupported hosts safely no-op.

---

## Lifecycle

The platform dispatches lifecycle events when the app goes to the background or returns to the foreground. Subscribe to pause game loops and audio accordingly.

### `oasiz.onPause(callback: () => void): Unsubscribe`
### `oasiz.onResume(callback: () => void): Unsubscribe`

Both return an unsubscribe function.

```ts
const offPause  = oasiz.onPause(() => {
  this.gameLoop.stop();
  this.bgMusic.pause();
});

const offResume = oasiz.onResume(() => {
  this.gameLoop.start();
  this.bgMusic.play();
});

// Clean up when the game is destroyed
offPause();
offResume();
```

---

## Navigation

Use navigation hooks when your game needs to control back behavior (Android back / web Escape) or participate in host-driven close events.

### `oasiz.onBackButton(callback: () => void): Unsubscribe`

Registers a callback for platform back actions. While at least one back listener is subscribed, back actions are routed to your game instead of immediately closing it.

Use this for pause menus, in-game overlays, or custom back-stack behavior.

If your callback throws, Oasiz falls back to closing the game and returning the player to Oasiz home before rethrowing the error for debugging/reporting.

```ts
const offBack = oasiz.onBackButton(() => {
  if (this.isPauseMenuOpen) {
    this.closePauseMenu();
    return;
  }
  this.openPauseMenu();
});

// Restore default host back behavior when no longer needed
offBack();
```

### `oasiz.leaveGame(): void`

Programmatically request the host to close the current game (for example, from a Quit button inside your game UI).

```ts
quitButton.addEventListener("click", () => {
  oasiz.leaveGame();
});
```

### `oasiz.onLeaveGame(callback: () => void): Unsubscribe`

Registers a callback fired when the host initiates closing the game (for example, close button, gesture, or host navigation). Use this for lightweight cleanup.

```ts
const offLeave = oasiz.onLeaveGame(() => {
  oasiz.flushGameState();
  this.bgMusic.pause();
});

// Clean up listener when destroyed
offLeave();
```

---

## Multiplayer

### `oasiz.shareRoomCode(code: string | null, options?: { inviteOverride?: boolean })`

Notify the platform of the active multiplayer room so friends can join via the invite system. Pass `null` when leaving a room.

Set `inviteOverride: true` when your game wants to hide the platform invite pill and render its own invite button/UI. The platform still tracks the room code, but your game owns the invite entry point.

```ts
import { insertCoin, getRoomCode } from "playroomkit";
import { oasiz } from "@oasiz/sdk";

await insertCoin({ skipLobby: true });
oasiz.shareRoomCode(getRoomCode());

// On disconnect
oasiz.shareRoomCode(null);
```

```ts
// Game-owned invite UI: hide the platform pill, keep room tracking
oasiz.shareRoomCode(getRoomCode(), { inviteOverride: true });
```

If you still want to use the platform invite sheet from your own in-game button, combine it with `openInviteModal()`:

```ts
import { openInviteModal, shareRoomCode } from "@oasiz/sdk";

shareRoomCode("ABCD", { inviteOverride: true });

inviteButton.addEventListener("click", () => {
  openInviteModal();
});
```

### Read-only injected values

These are populated by the platform before the game loads. Always check for `undefined` before using.

```ts
// The platform's internal game ID
const gameId = oasiz.gameId;

// Pre-filled room code for auto-joining a friend's session
if (oasiz.roomCode) {
  await connectToRoom(oasiz.roomCode);
}

// Player identity for multiplayer games
const name   = oasiz.playerName;
const avatar = oasiz.playerAvatar;
```

---

## Named exports

All methods are also available as named exports if you prefer not to use the `oasiz` namespace object:

```ts
import {
  submitScore,
  triggerHaptic,
  loadGameState,
  saveGameState,
  flushGameState,
  shareRoomCode,
  enableLogOverlay,
  onPause,
  onResume,
  onBackButton,
  onLeaveGame,
  leaveGame,
  getGameId,
  getRoomCode,
  getPlayerName,
  getPlayerAvatar,
} from "@oasiz/sdk";
```

---

## TypeScript types

```ts
import type {
  GameState,
  HapticType,
  LogOverlayHandle,
  LogOverlayOptions,
} from "@oasiz/sdk";
```

---

## Local development

All methods safely no-op when the platform bridges are not injected. In development mode a console warning is logged so you know the call was made:

```
[oasiz/sdk] submitScore bridge is unavailable. This is expected in local development.
```

No crashes, no special setup required for local dev.
