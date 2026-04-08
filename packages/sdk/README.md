# Oasiz game SDKs

Games on Oasiz can integrate using either of these official SDKs:

| Platform | Package | Use for |
| --- | --- | --- |
| **HTML5 / TypeScript** | [`@oasiz/sdk`](#html5--typescript-oasizsdk) (npm) | Canvas, Phaser, custom JS/TS, any browser game |
| **Unity WebGL** | [Unity runtime](#unity-webgl-sdk) in this repo (`packages/OasizSDK/`) | Unity projects targeting WebGL |

Both talk to the same host bridges (`window.submitScore`, `__oasizLeaveGame`, layout APIs, custom DOM events such as `oasiz:pause`, etc.). Unsupported hosts no-op safely; local dev usually logs warnings instead of crashing.

---

## HTML5 / TypeScript (`@oasiz/sdk`)

Typed SDK for integrating browser games with the Oasiz platform: score, haptics, cross-session state, multiplayer hooks, layout (safe area, leaderboard visibility), navigation (back / leave), and lifecycle events.

### Install

```bash
npm install @oasiz/sdk
```

The published package includes ESM, CommonJS, and TypeScript declarations.

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

// 4. Respect the host's top safe area (percent of viewport height → CSS vh)
document.documentElement.style.setProperty(
  "--safe-top",
  `${oasiz.safeAreaTop}vh`,
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

### Score

#### `oasiz.submitScore(score: number)`

Submit the player's final score at game over. Call this exactly once per session, when the game ends. The platform handles leaderboard persistence — do not track high scores locally.

```ts
private onGameOver(): void {
  oasiz.submitScore(Math.floor(this.score));
}
```

- `score` must be a non-negative integer. Floats are floored automatically.
- Do not call on intermediate scores or level completions, only on final game over.

### Haptics

#### `oasiz.triggerHaptic(type: HapticType)`

Trigger native haptic feedback. Always guard with the user's haptics setting.

```ts
type HapticType = "light" | "medium" | "heavy" | "success" | "error";
```

| Type | When to use |
| --- | --- |
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

### Debugging

#### `oasiz.enableLogOverlay(options?: LogOverlayOptions)`

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

### Game state persistence

Persist cross-session data such as unlocked levels, inventory, or lifetime stats. State is stored per-user per-game in the Oasiz backend — available across devices and app reinstalls.

#### `oasiz.loadGameState(): Record<string, unknown>`

Returns the player's saved state synchronously. Returns `{}` if no state has been saved yet. Call once at the start of the game.

```ts
private initFromSavedState(): void {
  const state = oasiz.loadGameState();
  this.level = typeof state.level === "number" ? state.level : 1;
  this.lifetimeHits = typeof state.lifetimeHits === "number" ? state.lifetimeHits : 0;
  this.unlockedSkins = Array.isArray(state.unlockedSkins) ? state.unlockedSkins : [];
}
```

Always validate the shape of loaded data — it may be `{}` on first play.

#### `oasiz.saveGameState(state: Record<string, unknown>)`

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

#### `oasiz.flushGameState()`

Forces an immediate write, bypassing the debounce. Use at important checkpoints like game over or before the page unloads.

```ts
private onGameOver(): void {
  oasiz.saveGameState({ level: this.level, lifetimeHits: this.lifetimeHits });
  oasiz.flushGameState(); // ensure it lands before the page closes
  oasiz.submitScore(this.score);
}
```

### Layout

Use the runtime safe-area value instead of hardcoded top offsets. The SDK returns the top inset as **a percentage of the viewport height (0–100)**. If the host exposes CSS pixels via `window.getSafeAreaTop()` or `window.__OASIZ_SAFE_AREA_TOP__`, the SDK converts using `window.innerHeight`. The host may instead set **`window.getSafeAreaTopPercent()`** or **`window.__OASIZ_SAFE_AREA_TOP_PERCENT__`** (0–100) and that value is used directly.

#### `oasiz.getSafeAreaTop(): number`

Returns the top inset as a percentage of viewport height (0–100). To get pixels in JavaScript, use `(getSafeAreaTop() / 100) * window.innerHeight`. In CSS, the same value matches **`vh`** units (for example `12.5vh` for 12.5% of the viewport height). Unsupported hosts return `0`.

```ts
const safeTopPct = oasiz.getSafeAreaTop();
document.documentElement.style.setProperty("--safe-top", `${safeTopPct}vh`);
```

#### `oasiz.safeAreaTop`

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

#### `oasiz.setLeaderboardVisible(visible: boolean): void`

Show or hide the host leaderboard UI from inside the game. This only affects the leaderboard; back and social controls remain visible. Calls `window.__oasizSetLeaderboardVisible` when present.

```ts
function openCustomOverlay(): void {
  oasiz.setLeaderboardVisible(false);
}

function closeCustomOverlay(): void {
  oasiz.setLeaderboardVisible(true);
}
```

Unsupported hosts safely no-op.

### Lifecycle

The platform dispatches lifecycle events when the app goes to the background or returns to the foreground. Subscribe to pause game loops and audio accordingly.

#### `oasiz.onPause(callback: () => void): Unsubscribe`

#### `oasiz.onResume(callback: () => void): Unsubscribe`

Both return an unsubscribe function.

```ts
const offPause = oasiz.onPause(() => {
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

### Navigation

Use navigation hooks when your game needs to control back behavior (Android back / web Escape) or participate in host-driven close events.

#### `oasiz.onBackButton(callback: () => void): Unsubscribe`

Registers a callback for platform back actions. While at least one back listener is subscribed, back actions are routed to your game instead of immediately closing it.

Use this for pause menus, in-game overlays, or custom back-stack behavior.

**If your callback throws**, the SDK calls `leaveGame()` (host close) and **rethrows** the error so you still see it in devtools or error reporting. Non-`Error` throws are normalized to an `Error` (strings become the message; otherwise `"Back button callback failed."`).

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

#### `oasiz.leaveGame(): void`

Programmatically request the host to close the current game (for example, from a Quit button inside your game UI).

```ts
quitButton.addEventListener("click", () => {
  oasiz.leaveGame();
});
```

### `oasiz.share(options: { text?: string; score?: number; image?: string }): Promise<void>`

Ask the host to open the same share flow Oasiz already uses today. Use `text` to customize the share message, `score` to trigger a challenge-style share, and `image` to share an `http(s)` URL or `data:image/...` payload.

```ts
await oasiz.share({
  text: "I made it to level 9!",
  score: 4200,
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

### Multiplayer

#### `oasiz.shareRoomCode(code: string | null, options?: { inviteOverride?: boolean })`

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

#### `oasiz.openInviteModal(): void`

Opens the platform invite-friends UI when the bridge is available. Typically used together with `shareRoomCode` (for example, your own invite button calls this).

```ts
import { openInviteModal, shareRoomCode } from "@oasiz/sdk";

shareRoomCode("ABCD", { inviteOverride: true });

inviteButton.addEventListener("click", () => {
  openInviteModal();
});
```

#### Read-only injected values

These are populated by the platform before the game loads. Always check for `undefined` before using.

```ts
// The platform's internal game ID
const gameId = oasiz.gameId;

// Pre-filled room code for auto-joining a friend's session
if (oasiz.roomCode) {
  await connectToRoom(oasiz.roomCode);
}

// Player identity for multiplayer games
const name = oasiz.playerName;
const avatar = oasiz.playerAvatar;
```

### Named exports

All methods are also available as named exports if you prefer not to use the `oasiz` namespace object:

```ts
import {
  submitScore,
  share,
  triggerHaptic,
  loadGameState,
  saveGameState,
  flushGameState,
  shareRoomCode,
  openInviteModal,
  enableLogOverlay,
  getSafeAreaTop,
  setLeaderboardVisible,
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

### TypeScript types

```ts
import type {
  GameState,
  HapticType,
  LogOverlayEntry,
  LogOverlayHandle,
  LogOverlayLevel,
  LogOverlayOptions,
  ShareRequest,
  ShareRoomCodeOptions,
  Unsubscribe,
} from "@oasiz/sdk";
```

---

## Unity WebGL SDK

C# API and **WebGL-only** `OasizBridge.jslib` live in this repository at **`packages/OasizSDK/`**. Copy the **`OasizSDK`** folder into your Unity project under **`Assets/`** (for example `Assets/OasizSDK`).

### Setup

1. Copy `packages/OasizSDK` from this repo into `Assets/OasizSDK`.
2. Ensure the **WebGL** platform is selected for release builds; the `.jslib` under `Runtime/Plugins/WebGL/` is included automatically for WebGL.
3. Add an **`OasizSDK`** component to a persistent GameObject early (for example a bootstrap scene), **or** rely on `OasizSDK.Instance` which creates a `DontDestroyOnLoad` object. The component registers listeners for `oasiz:pause`, `oasiz:resume`, `oasiz:back`, and `oasiz:leave` via `SendMessage`.

### Quick start

```csharp
using Oasiz;
using UnityEngine;

public class GameManager : MonoBehaviour
{
    void Start()
    {
        // Ensure the singleton is initialized early
        _ = OasizSDK.Instance;

        // Subscribe to lifecycle events
        OasizSDK.OnPause += OnPause;
        OasizSDK.OnResume += OnResume;

        // Offset UI for the host's top safe area (0–100 percent of Screen.height)
        float safeTopPct = OasizSDK.SafeAreaTop;
        float safeTopPx = safeTopPct / 100f * Screen.height;
        Debug.Log($"Safe area top: {safeTopPx}px ({safeTopPct}% of height)");

        // Emit score normalization anchors
        OasizSDK.EmitScoreConfig(new ScoreConfig(
            new ScoreAnchor(10, 100),
            new ScoreAnchor(30, 300),
            new ScoreAnchor(75, 600),
            new ScoreAnchor(200, 950)
        ));
    }

    void OnGameOver(int finalScore)
    {
        OasizSDK.SubmitScore(finalScore);
        OasizSDK.FlushGameState();
        OasizSDK.SetLeaderboardVisible(true);
    }

    void OnGameplayStart()
    {
        OasizSDK.SetLeaderboardVisible(false);
    }

    void OnPause() => Time.timeScale = 0f;
    void OnResume() => Time.timeScale = 1f;

    void OnDestroy()
    {
        OasizSDK.OnPause -= OnPause;
        OasizSDK.OnResume -= OnResume;
    }
}
```

### API parity (TypeScript → C#)

| HTML5 (`@oasiz/sdk`) | Unity (`Oasiz` namespace) |
| --- | --- |
| `oasiz.submitScore(n)` | `OasizSDK.SubmitScore(int)` |
| `oasiz.triggerHaptic(type)` | `OasizSDK.TriggerHaptic(HapticType)` |
| `oasiz.loadGameState()` | `OasizSDK.LoadGameState()` → `Dictionary<string, object>` |
| `oasiz.saveGameState(obj)` | `OasizSDK.SaveGameState(Dictionary<string, object>)` |
| `oasiz.flushGameState()` | `OasizSDK.FlushGameState()` |
| `oasiz.getSafeAreaTop()` / `safeAreaTop` | `OasizSDK.GetSafeAreaTop()` / `OasizSDK.SafeAreaTop` (`float`, 0–100, % of viewport height) |
| `oasiz.setLeaderboardVisible(v)` | `OasizSDK.SetLeaderboardVisible(bool)` |
| `oasiz.onPause` / `onResume` | `OasizSDK.OnPause` / `OnResume` static events |
| `oasiz.onBackButton` | `OasizSDK.OnBackButton` or `SubscribeBackButton(Action)` (reference-counts `__oasizSetBackOverride`) |
| `oasiz.onLeaveGame` | `OasizSDK.OnLeaveGame` |
| `oasiz.leaveGame()` | `OasizSDK.LeaveGame()` |
| `oasiz.share(request)` | `OasizSDK.Share(ShareRequest)` |
| `oasiz.shareRoomCode` | `OasizSDK.ShareRoomCode(string, ShareRoomCodeOptions)` |
| `oasiz.openInviteModal()` | `OasizSDK.OpenInviteModal()` |
| `oasiz.gameId` / `roomCode` / ... | `OasizSDK.GameId` / `RoomCode` / `PlayerName` / `PlayerAvatar` |
| -- | `OasizSDK.EmitScoreConfig(ScoreConfig)` → `window.emitScoreConfig` (Unity-only helper for normalized score UI) |
| `oasiz.enableLogOverlay` | `OasizSDK.EnableLogOverlay(LogOverlayOptions)` (see note below) |
| -- | `OasizSDK.AppendLogOverlay(level, message, stackTrace)` (see note below) |

### Share (Unity)

HTML5 **`oasiz.share`** returns a **Promise** you can `await`. Unity **`OasizSDK.Share(ShareRequest)`** returns **`void`**: C# validation throws **`ArgumentException`** with the same rules as TypeScript (at least one of text, score, or image; non-negative integer score; `http(s)` or `data:image/...;base64,...` image). The call forwards JSON to **`window.__oasizShareRequest`**. If the host promise rejects, the **WebGL `.jslib` logs the error** to the browser console.

```csharp
OasizSDK.Share(new ShareRequest
{
    Text = "Beat this run!",
    Score = 1200,
    Image = "https://example.com/card.png",
});
```

### Types

```csharp
// Haptic feedback intensity
public enum HapticType { Light, Medium, Heavy, Success, Error }

// Score normalization (exactly 4 anchors required)
public struct ScoreAnchor { public int raw; public int normalized; }
public struct ScoreConfig { public ScoreAnchor[] anchors; }

// Host share sheet (text / score / image URL or data URL)
public class ShareRequest
{
    public string Text { get; set; }
    public int? Score { get; set; }
    public string Image { get; set; }
}

// Multiplayer invite options
public class ShareRoomCodeOptions { public bool InviteOverride { get; set; } }

// Log overlay configuration
public class LogOverlayOptions
{
    public bool Enabled { get; set; } = true;
    public bool Collapsed { get; set; } = false;
    public int MaxEntries { get; set; } = 200;
    public string Title { get; set; } = "SDK Logs";
}

// Log overlay lifecycle handle
public class LogOverlayHandle
{
    public void Clear();
    public void Hide();
    public void Show();
    public bool IsVisible();
    public void Destroy();
}
```

### Back button and errors

Matching the HTML5 SDK: if any **`OnBackButton`** handler throws, **`OasizSDK.LeaveGame()`** is invoked and the **original exception is rethrown** (`throw;` preserves the stack trace). Use **`SubscribeBackButton`** when you want an unsubscribe delegate; you can also use `OnBackButton +=` / `-=` directly.

```csharp
// Subscribe with automatic unsubscribe support
var offBack = OasizSDK.SubscribeBackButton(() =>
{
    if (isPaused)
        Resume();
    else
        Pause();
});

// Unsubscribe when no longer needed
offBack();
```

### Editor vs WebGL builds

In the **Unity Editor**, bridge calls are mostly **logged** and return safe defaults (for example safe area `0`, `null` platform IDs). Real host integration applies to **WebGL player** builds running inside Oasiz.

### Log overlay (Unity)

The C# API for the log overlay exists for API compatibility, but the **default `OasizBridge.jslib` in this repo does not inject DOM UI** — `EnableLogOverlay` / `AppendLogOverlay` are no-ops at the JavaScript layer. Use Unity's console and device logs for debugging unless you replace or extend the `.jslib` on your side.

`AppendLogOverlay(level, message, stackTrace)` lets you pipe `Debug.Log` output into the overlay manually, since many embedded WebViews do not route Unity player logs through `console.log`. Valid levels: `"debug"`, `"log"`, `"info"`, `"warn"`, `"error"`.

---

## Local development

### HTML5 / TypeScript

All methods safely no-op when the platform bridges are not injected. In development mode a console warning is logged so you know the call was made:

```
[oasiz/sdk] submitScore bridge is unavailable. This is expected in local development.
```

No crashes, no special setup required for local dev.

### Unity WebGL

The `.jslib` logs warnings when `window.*` bridges are missing (for example `submitScore`, `__oasizLeaveGame`). The Editor path avoids calling native plugins and prints `Debug.Log` for most operations instead.
