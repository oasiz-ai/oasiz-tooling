import assert from "node:assert/strict";
import test from "node:test";

import {
  enableLogOverlay,
  getPlayerCharacter,
  getJibbleAnimationId,
  getSamplePlayerCharacter,
  JIBBLE_ANIMATION,
  JIBBLE_ANIMATION_IDS,
  JIBBLE_DIRECTIONS,
  oasiz,
  requestBots,
} from "../src/index.ts";
import {
  getSafeAreaTop,
  setLeaderboardVisible,
} from "../src/layout.ts";
import { onPause, onResume } from "../src/lifecycle.ts";
import { leaveGame, onBackButton, onLeaveGame } from "../src/navigation.ts";
import {
  getGameId,
  getLaunchContext,
  getLocalLaunchPlayer,
  getPlayerAvatar,
  getPlayerId,
  getPlayerName,
  getRoomCode,
  isLaunchHost,
  openInviteModal,
  shareRoomCode,
} from "../src/multiplayer.ts";
import { submitScore } from "../src/score.ts";
import { share } from "../src/share.ts";
import { flushGameState, loadGameState, saveGameState } from "../src/state.ts";

function withWindow<T>(value: unknown, run: () => T): T {
  const globalScope = globalThis as typeof globalThis & { window?: unknown };
  const originalWindow = globalScope.window;
  globalScope.window = value;
  try {
    return run();
  } finally {
    globalScope.window = originalWindow;
  }
}

function withoutWindow<T>(run: () => T): T {
  const globalScope = globalThis as typeof globalThis & { window?: unknown };
  const originalWindow = globalScope.window;
  delete globalScope.window;
  try {
    return run();
  } finally {
    globalScope.window = originalWindow;
  }
}

function withFetch<T>(value: unknown, run: () => T): T {
  const globalScope = globalThis as typeof globalThis & { fetch?: unknown };
  const originalFetch = globalScope.fetch;
  if (value === undefined) {
    delete globalScope.fetch;
  } else {
    globalScope.fetch = value;
  }
  try {
    return run();
  } finally {
    if (originalFetch === undefined) {
      delete globalScope.fetch;
    } else {
      globalScope.fetch = originalFetch;
    }
  }
}

class NavigationTarget {
  private listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const current = this.listeners.get(type) ?? new Set<EventListener>();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener.call(this, event);
    }
    return true;
  }
}

class FakeElement {
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  scrollHeight = 0;
  scrollTop = 0;
  style: Record<string, string> = {};
  tagName: string;
  type = "";
  private textValue = "";
  private listeners = new Map<string, Set<() => void>>();

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children = [];
    for (const child of children) {
      this.appendChild(child);
    }
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  remove(): void {
    if (!this.parentNode) {
      return;
    }

    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) {
      this.parentNode.children.splice(index, 1);
    }
    this.parentNode = null;
  }

  get textContent(): string {
    return this.textValue;
  }

  set textContent(value: string) {
    this.textValue = value;
    this.scrollHeight = value.length;
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

class FakeDocument extends EventTarget {
  body: FakeElement | null = new FakeElement("body");

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

function flattenText(node: FakeElement): string {
  const parts: string[] = [];
  if (node.textContent) {
    parts.push(node.textContent);
  }
  for (const child of node.children) {
    parts.push(flattenText(child));
  }
  return parts.join("\n");
}

test("jibble animation helpers expose stable animation ids", () => {
  assert.equal(JIBBLE_ANIMATION.Idle.South, "idle_s");
  assert.equal(JIBBLE_ANIMATION.Walk.North, "walk_n");
  assert.equal(JIBBLE_ANIMATION.Backflip, "backflip");
  assert.equal(getJibbleAnimationId("walk", "back"), "walk_n");
  assert.equal(getJibbleAnimationId("walk", "right"), "walk_e");
  assert.equal(getJibbleAnimationId("walk", "north"), "walk_n");
  assert.equal(getJibbleAnimationId("walk", "front-right"), "walk_se");
  assert.equal(getJibbleAnimationId("walk", "back-left"), "walk_nw");
  assert.equal(getJibbleAnimationId("idle", "forward"), "idle_s");
  assert.equal(getJibbleAnimationId("idle", "forth"), "idle_s");
  assert.equal(getJibbleAnimationId("idle", "front"), "idle_s");
  assert.equal(getJibbleAnimationId("backflip", "nw"), "backflip");
  assert.equal(oasiz.getJibbleAnimationId("walk", "left"), "walk_w");
  assert.equal(oasiz.jibbleAnimations.Walk.SouthEast, "walk_se");
  assert.deepEqual([...JIBBLE_DIRECTIONS], ["n", "ne", "e", "se", "s", "sw", "w", "nw"]);
  assert.ok(JIBBLE_ANIMATION_IDS.includes("idle_n"));
  assert.ok(JIBBLE_ANIMATION_IDS.includes("walk_sw"));
  assert.ok(JIBBLE_ANIMATION_IDS.includes("backflip"));
});

test("getPlayerCharacter fetches the platform sample atlas on localhost without the app bridge", async () => {
  const platformCharacter = getSamplePlayerCharacter();
  platformCharacter.characterName = "Oasiz Sample Jibble";
  platformCharacter.baseCharacterId = "jibbles";
  platformCharacter.compositionCode = "jibbles-sdk-sample";
  platformCharacter.textureAtlas.imageUrl =
    "https://assets.oasiz.ai/characters/jibbles/jibbles-sdk-sample/atlas.png";

  const character = await withWindow(
    { location: { protocol: "http:", hostname: "localhost" } },
    () =>
      withFetch(
        async () =>
          ({
            ok: true,
            json: async () => ({ ok: true, character: platformCharacter }),
          }) as Response,
        () => getPlayerCharacter(),
      ),
  );

  assert.ok(character);
  assert.equal(character.characterName, "Oasiz Sample Jibble");
  assert.equal(character.baseCharacterId, "jibbles");
  assert.ok(character.textureAtlas.imageUrl.startsWith("https://assets.oasiz.ai/"));

  const animationIds = new Set(
    character.textureAtlas.animations.map((animation) => animation.animationId),
  );
  for (const animationId of JIBBLE_ANIMATION_IDS) {
    assert.ok(animationIds.has(animationId), `missing sample animation ${animationId}`);
  }
});

test("getPlayerCharacter falls back to the generated sample when the platform sample is unavailable", async () => {
  const character = await withWindow(
    { location: { protocol: "http:", hostname: "localhost" } },
    () =>
      withFetch(
        async () => ({ ok: false, json: async () => ({}) }) as Response,
        () => getPlayerCharacter(),
      ),
  );

  assert.equal(character?.characterName, "SDK Sample Jibble");
  assert.ok(character?.textureAtlas.imageUrl.startsWith("data:image/svg+xml"));

  const strict = await withWindow(
    { location: { protocol: "http:", hostname: "localhost" } },
    () =>
      withFetch(
        async () => ({ ok: false, json: async () => ({}) }) as Response,
        () => getPlayerCharacter({ generatedFallback: false }),
      ),
  );
  assert.equal(strict, null);
});

test("getPlayerCharacter local fallback can be disabled or forced", async () => {
  const disabled = await withWindow(
    { location: { protocol: "http:", hostname: "localhost" } },
    () => getPlayerCharacter({ localFallback: false }),
  );
  assert.equal(disabled, null);

  const forced = await withoutWindow(() =>
    withFetch(
      async () => ({ ok: false, json: async () => ({}) }) as Response,
      () => getPlayerCharacter({ localFallback: true }),
    ),
  );
  assert.equal(forced?.baseCharacterId, "sdk-sample-jibble");
});

test("getPlayerCharacter does not use the sample when a bridge is present", async () => {
  const bridgeResult = getSamplePlayerCharacter();
  bridgeResult.characterName = "Bridge Character";

  const character = await withWindow(
    {
      location: { protocol: "http:", hostname: "localhost" },
      __oasizGetPlayerCharacter: async () => bridgeResult,
    },
    () => getPlayerCharacter(),
  );
  assert.equal(character?.characterName, "Bridge Character");

  const noCharacter = await withWindow(
    {
      location: { protocol: "http:", hostname: "localhost" },
      __oasizGetPlayerCharacter: async () => null,
    },
    () => getPlayerCharacter(),
  );
  assert.equal(noCharacter, null);
});

test("getPlayerCharacter keeps remote non-app pages null by default", async () => {
  const character = await withWindow(
    { location: { protocol: "https:", hostname: "example.com" } },
    () => getPlayerCharacter(),
  );

  assert.equal(character, null);
});

test("requestBots forwards normalized platform bot options to the host bridge", async () => {
  const calls: unknown[] = [];
  const result = {
    ok: true,
    gameId: "game-1",
    playerId: "player-1",
    poolKey: "ranked",
    source: "game_pool",
    requestedCount: 2,
    returnedCount: 1,
    bots: [
      {
        id: "spark",
        name: "Spark",
        characteristic: "chases coins",
        difficulty: "easy",
        behavior: { target: "coins" },
        personality: { mood: "bold" },
        appearance: null,
      },
    ],
  } as const;

  const bots = await withWindow(
    {
      __oasizRequestBots: async (options: unknown) => {
        calls.push(options);
        return result;
      },
    },
    () =>
      requestBots({
        count: 2,
        difficulty: ["easy", "easy", "medium"],
        poolKey: " ranked ",
        seed: " match-1 ",
        includeAppearance: false,
      }),
  );

  assert.deepEqual(calls, [
    {
      count: 2,
      difficulty: ["easy", "medium"],
      poolKey: "ranked",
      seed: "match-1",
      includeAppearance: false,
    },
  ]);
  assert.equal(bots?.bots[0]?.name, "Spark");
  assert.equal(oasiz.requestBots, requestBots);
});

test("requestBots returns null without bridge or invalid options", async () => {
  const missingBridge = await withoutWindow(() => requestBots({ count: 1 }));
  assert.equal(missingBridge, null);

  let calls = 0;
  const invalidCount = await withWindow(
    {
      __oasizRequestBots: async () => {
        calls += 1;
        return null;
      },
    },
    () => requestBots({ count: 0 }),
  );
  const invalidDifficulty = await withWindow(
    {
      __oasizRequestBots: async () => {
        calls += 1;
        return null;
      },
    },
    () => requestBots({ difficulty: "nightmare" as "easy" }),
  );

  assert.equal(invalidCount, null);
  assert.equal(invalidDifficulty, null);
  assert.equal(calls, 0);
});

function withBrowser<T>(
  options: {
    consoleImpl?: Console;
    documentImpl?: FakeDocument;
    windowImpl?: Record<string, unknown>;
  },
  run: (context: { document: FakeDocument; window: Window & Record<string, unknown> }) => T | Promise<T>,
): T | Promise<T> {
  const globalScope = globalThis as typeof globalThis & {
    console: Console;
    document?: FakeDocument;
    window?: Window & Record<string, unknown>;
  };

  const originalConsole = globalScope.console;
  const originalDocument = globalScope.document;
  const originalWindow = globalScope.window;
  const fakeDocument = options.documentImpl ?? new FakeDocument();
  const fakeWindow = {
    document: fakeDocument,
    ...options.windowImpl,
  } as Window & Record<string, unknown>;

  globalScope.console = options.consoleImpl ?? originalConsole;
  globalScope.document = fakeDocument;
  globalScope.window = fakeWindow;

  let shouldRestoreSynchronously = true;
  try {
    const result = run({ document: fakeDocument, window: fakeWindow });
    if (result && typeof (result as PromiseLike<T>).then === "function") {
      shouldRestoreSynchronously = false;
      return Promise.resolve(result).finally(() => {
        globalScope.console = originalConsole;
        globalScope.document = originalDocument;
        globalScope.window = originalWindow;
      });
    }
    return result;
  } finally {
    if (shouldRestoreSynchronously) {
      globalScope.console = originalConsole;
      globalScope.document = originalDocument;
      globalScope.window = originalWindow;
    }
  }
}

test("submitScore is safe without injected bridge", () => {
  withoutWindow(() => {
    assert.doesNotThrow(() => submitScore(10));
  });
});

test("submitScore calls bridge with normalized integer score", () => {
  const calls: number[] = [];
  withWindow(
    {
      submitScore: (score: number) => calls.push(score),
    },
    () => {
      submitScore(42.8);
      submitScore(-7);
    },
  );

  assert.deepEqual(calls, [42, 0]);
});

test("triggerHaptic calls bridge with provided type", () => {
  const calls: string[] = [];
  withWindow(
    {
      triggerHaptic: (type: string) => calls.push(type),
    },
    () => {
      oasiz.triggerHaptic("medium");
    },
  );

  assert.deepEqual(calls, ["medium"]);
});

test("enableLogOverlay is safe when disabled or outside the browser", () => {
  const disabledHandle = enableLogOverlay({ enabled: false });
  assert.equal(disabledHandle.isVisible(), false);

  withoutWindow(() => {
    const globalScope = globalThis as typeof globalThis & { document?: unknown };
    const originalDocument = globalScope.document;
    delete globalScope.document;
    try {
      const handle = enableLogOverlay();
      assert.equal(handle.isVisible(), false);
      assert.doesNotThrow(() => handle.destroy());
    } finally {
      globalScope.document = originalDocument;
    }
  });
});

test("enableLogOverlay captures console output into an on-screen panel", () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const fakeConsole = {
    debug: (...args: unknown[]) => calls.push({ method: "debug", args }),
    log: (...args: unknown[]) => calls.push({ method: "log", args }),
    info: (...args: unknown[]) => calls.push({ method: "info", args }),
    warn: (...args: unknown[]) => calls.push({ method: "warn", args }),
    error: (...args: unknown[]) => calls.push({ method: "error", args }),
  } as unknown as Console;

  withBrowser({ consoleImpl: fakeConsole }, ({ document }) => {
    const handle = enableLogOverlay({ title: "Game Logs", maxEntries: 25 });

    console.log("hello", { score: 3 });
    console.error(new Error("boom"));

    assert.equal(handle.isVisible(), true);
    assert.deepEqual(
      calls.map((call) => call.method),
      ["log", "error"],
    );

    const text = flattenText(document.body!);
    assert.doesNotMatch(text, /Game Logs/);
    assert.match(text, /hello/);
    assert.match(text, /score/);
    assert.match(text, /boom/);

    handle.hide();
    assert.equal(handle.isVisible(), false);
    handle.show();
    assert.equal(handle.isVisible(), true);
    handle.clear();

    assert.match(flattenText(document.body!), /Console output will appear here/);

    handle.destroy();
  });
});

test("enableLogOverlay is reference counted and restores console on final destroy", () => {
  const fakeConsole = {
    debug() {},
    log() {},
    info() {},
    warn() {},
    error() {},
  } as unknown as Console;

  withBrowser({ consoleImpl: fakeConsole }, ({ document, window }) => {
    const first = enableLogOverlay();
    const second = enableLogOverlay({ collapsed: true });

    assert.equal(typeof console.log, "function");
    assert.equal(document.body?.children.length, 1);
    assert.ok((window as Record<string, unknown>).__oasizLogOverlayController__);

    first.destroy();
    assert.equal(typeof console.log, "function");
    assert.equal(document.body?.children.length, 1);

    second.destroy();
    assert.equal(typeof console.log, "function");
    assert.equal(document.body?.children.length, 0);
    assert.equal(
      (window as Record<string, unknown>).__oasizLogOverlayController__,
      undefined,
    );
  });
});

test("loadGameState returns empty object without bridge", () => {
  const state = withoutWindow(() => loadGameState());
  assert.deepEqual(state, {});
});

test("loadGameState returns bridge state object", () => {
  const state = withWindow(
    {
      loadGameState: () => ({ level: 3, inventory: ["key"] }),
    },
    () => loadGameState(),
  );

  assert.deepEqual(state, { level: 3, inventory: ["key"] });
});

test("getSafeAreaTop returns 0 without bridge support", () => {
  const safeAreaTop = withoutWindow(() => getSafeAreaTop());
  assert.equal(safeAreaTop, 0);
});

test("getSafeAreaTop converts pixel bridge to percent of viewport height", () => {
  const safeAreaTop = withWindow(
    {
      getSafeAreaTop: () => 96,
      innerHeight: 800,
    },
    () => getSafeAreaTop(),
  );

  assert.equal(safeAreaTop, 12);
  assert.equal(
    withWindow(
      { getSafeAreaTop: () => 32, innerHeight: 800 },
      () => oasiz.safeAreaTop,
    ),
    4,
  );
});

test("getSafeAreaTop uses percent bridge when present", () => {
  assert.equal(
    withWindow(
      {
        getSafeAreaTopPercent: () => 8.5,
        getSafeAreaTop: () => 999,
        innerHeight: 800,
      },
      () => getSafeAreaTop(),
    ),
    8.5,
  );
  assert.equal(
    withWindow({ __OASIZ_SAFE_AREA_TOP_PERCENT__: 15 }, () => getSafeAreaTop()),
    15,
  );
});

test("getSafeAreaTop returns 0 when viewport height is unavailable", () => {
  assert.equal(
    withWindow({ getSafeAreaTop: () => 96, innerHeight: 0 }, () =>
      getSafeAreaTop(),
    ),
    0,
  );
});

test("setLeaderboardVisible calls bridge when available", () => {
  const calls: boolean[] = [];

  withWindow(
    {
      __oasizSetLeaderboardVisible: (visible: boolean) => calls.push(visible),
    },
    () => {
      setLeaderboardVisible(false);
      oasiz.setLeaderboardVisible(true);
    },
  );

  assert.deepEqual(calls, [false, true]);
});

test("loadGameState falls back to empty object for non-object payloads", () => {
  const state = withWindow(
    {
      loadGameState: () => ["not", "valid"],
    },
    () => loadGameState(),
  );

  assert.deepEqual(state, {});
});

test("saveGameState and flushGameState call bridge", () => {
  const saved: unknown[] = [];
  let flushed = 0;

  withWindow(
    {
      saveGameState: (state: unknown) => saved.push(state),
      flushGameState: () => {
        flushed += 1;
      },
    },
    () => {
      saveGameState({ checkpoint: 4 });
      flushGameState();
    },
  );

  assert.deepEqual(saved, [{ checkpoint: 4 }]);
  assert.equal(flushed, 1);
});

test("shareRoomCode calls bridge", () => {
  const calls: Array<string | null> = [];

  withWindow(
    {
      shareRoomCode: (roomCode: string | null) => calls.push(roomCode),
    },
    () => {
      shareRoomCode("ABCD");
      shareRoomCode(null);
    },
  );

  assert.deepEqual(calls, ["ABCD", null]);
});

test("shareRoomCode forwards invite override options to the bridge", () => {
  const calls: Array<{ roomCode: string | null; inviteOverride?: boolean }> = [];

  withWindow(
    {
      shareRoomCode: (
        roomCode: string | null,
        options?: { inviteOverride?: boolean },
      ) => calls.push({ roomCode, inviteOverride: options?.inviteOverride }),
    },
    () => {
      shareRoomCode("ABCD", { inviteOverride: true });
    },
  );

  assert.deepEqual(calls, [{ roomCode: "ABCD", inviteOverride: true }]);
});

test("openInviteModal calls bridge when available", () => {
  let calls = 0;
  withWindow(
    {
      openInviteModal: () => {
        calls += 1;
      },
    },
    () => {
      openInviteModal();
      oasiz.openInviteModal();
    },
  );

  assert.equal(calls, 2);
});

test("share rejects empty requests", async () => {
  await assert.rejects(
    () => share({}),
    /Share request requires text, score, or image/,
  );
});

test("share rejects invalid scores", async () => {
  await assert.rejects(
    () => share({ score: 3.5 }),
    /Share score must be a non-negative integer/,
  );
});

test("share rejects invalid image references", async () => {
  await assert.rejects(
    () => share({ image: "ftp://example.com/share.png" }),
    /Share image must be an http\(s\) URL or a data:image/,
  );
});

test("share rejects when bridge is unavailable", async () => {
  await withoutWindow(async () => {
    await assert.rejects(
      () => share({ text: "hello" }),
      /Share bridge unavailable/,
    );
  });
});

test("share validates and forwards requests to the host bridge", async () => {
  let request: Record<string, unknown> | null = null;

  await withWindow(
    {
      __oasizShareRequest: async (nextRequest: Record<string, unknown>) => {
        request = nextRequest;
      },
    },
    async () => {
      await share({
        text: "  Beat this  ",
        score: 42,
        image: "https://example.com/share.png",
      });
    },
  );

  assert.deepEqual(request, {
    text: "Beat this",
    score: 42,
    image: "https://example.com/share.png",
  });
});

test("multiplayer getters return injected values", () => {
  withWindow(
    {
      __GAME_ID__: "game-123",
      __ROOM_CODE__: "WXYZ",
      __PLAYER_ID__: "user-123",
      __PLAYER_NAME__: "Josiah",
      __PLAYER_AVATAR__: "https://example.com/avatar.png",
    },
    () => {
      assert.equal(getGameId(), "game-123");
      assert.equal(getRoomCode(), "WXYZ");
      assert.equal(getPlayerId(), "user-123");
      assert.equal(getPlayerName(), "Josiah");
      assert.equal(getPlayerAvatar(), "https://example.com/avatar.png");

      assert.equal(oasiz.gameId, "game-123");
      assert.equal(oasiz.roomCode, "WXYZ");
      assert.equal(oasiz.playerId, "user-123");
      assert.equal(oasiz.playerName, "Josiah");
      assert.equal(oasiz.playerAvatar, "https://example.com/avatar.png");
    },
  );
});

test("platform launch context backs multiplayer getters", () => {
  const launchContext = {
    gameId: "game-123",
    gameVersionId: "version-456",
    hostUserId: "user-host",
    localPlayerId: "user-guest",
    modeId: "duos",
    players: [
      {
        avatarUrl: "https://example.com/host.png",
        botProfile: null,
        connected: true,
        displayName: "Host",
        isBot: false,
        memberId: "member-host",
        ready: true,
        role: "host",
        slotIndex: 0,
        teamId: "red",
        userId: "user-host",
      },
      {
        avatarUrl: "https://example.com/guest.png",
        botProfile: null,
        connected: true,
        displayName: "Guest",
        isBot: false,
        memberId: "member-guest",
        ready: false,
        role: null,
        slotIndex: 1,
        teamId: "blue",
        userId: "user-guest",
      },
    ],
    roomCode: "ABCD23",
    roomId: "room-123",
    sessionId: "session-123",
    settings: { durationMinutes: 10, friendlyFire: false },
    transport: { type: "custom", config: { channel: "room-123" } },
  };

  withWindow(
    {
      __OASIZ_LAUNCH_CONTEXT__: launchContext,
    },
    () => {
      const context = getLaunchContext();

      assert.equal(context?.gameId, "game-123");
      assert.equal(context?.modeId, "duos");
      assert.equal(context?.settings.durationMinutes, 10);
      assert.equal(context?.players.length, 2);
      assert.equal(getGameId(), "game-123");
      assert.equal(getRoomCode(), "ABCD23");
      assert.equal(getPlayerId(), "user-guest");
      assert.equal(getPlayerName(), "Guest");
      assert.equal(getPlayerAvatar(), "https://example.com/guest.png");
      assert.equal(getLocalLaunchPlayer()?.memberId, "member-guest");
      assert.equal(isLaunchHost(), false);
      assert.equal(oasiz.launchContext?.sessionId, "session-123");
      assert.equal(oasiz.localLaunchPlayer?.displayName, "Guest");
      assert.equal(oasiz.isHost, false);
    },
  );
});

test("platform launch context bridge function takes precedence over globals", () => {
  withWindow(
    {
      __GAME_ID__: "legacy-game",
      __OASIZ_LAUNCH_CONTEXT__: { gameId: "ignored" },
      __oasizGetLaunchContext: () => ({
        gameId: "game-hosted",
        gameVersionId: null,
        hostUserId: "user-host",
        localPlayerId: "user-host",
        modeId: "classic",
        players: [
          {
            connected: true,
            displayName: "Host",
            isBot: false,
            memberId: "member-host",
            ready: true,
            slotIndex: 0,
            userId: "user-host",
          },
        ],
        roomCode: "ROOM99",
        roomId: "room-hosted",
        sessionId: "session-hosted",
        settings: {},
        transport: {},
      }),
    },
    () => {
      assert.equal(getLaunchContext()?.gameId, "game-hosted");
      assert.equal(getGameId(), "legacy-game");
      assert.equal(isLaunchHost(), true);
      assert.equal(oasiz.isHost, true);
    },
  );
});

test("onPause and onResume subscribe and unsubscribe from lifecycle events", () => {
  const target = new EventTarget();

  withWindow(
    {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    },
    () => {
      let pauses = 0;
      let resumes = 0;

      const offPause = onPause(() => {
        pauses += 1;
      });
      const offResume = onResume(() => {
        resumes += 1;
      });

      target.dispatchEvent(new Event("oasiz:pause"));
      target.dispatchEvent(new Event("oasiz:resume"));

      assert.equal(pauses, 1);
      assert.equal(resumes, 1);

      offPause();
      offResume();

      target.dispatchEvent(new Event("oasiz:pause"));
      target.dispatchEvent(new Event("oasiz:resume"));

      assert.equal(pauses, 1);
      assert.equal(resumes, 1);
    },
  );
});

test("leaveGame is safe without injected bridge", () => {
  withoutWindow(() => {
    assert.doesNotThrow(() => leaveGame());
  });
});

test("leaveGame calls bridge when available", () => {
  let calls = 0;
  withWindow(
    {
      __oasizLeaveGame: () => {
        calls += 1;
      },
    },
    () => {
      leaveGame();
      oasiz.leaveGame();
    },
  );

  assert.equal(calls, 2);
});

test("onBackButton subscribes, toggles override bridge, and unsubscribes", () => {
  const target = new EventTarget();
  const overrideCalls: boolean[] = [];
  let leaveGameCalls = 0;

  withWindow(
    {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
      __oasizSetBackOverride: (active: boolean) => {
        overrideCalls.push(active);
      },
      __oasizLeaveGame: () => {
        leaveGameCalls += 1;
      },
    },
    () => {
      let backPresses = 0;
      const off = onBackButton(() => {
        backPresses += 1;
      });

      target.dispatchEvent(new Event("oasiz:back"));
      assert.equal(backPresses, 1);

      off();
      target.dispatchEvent(new Event("oasiz:back"));
      assert.equal(backPresses, 1);
    },
  );

  assert.deepEqual(overrideCalls, [true, false]);
  assert.equal(leaveGameCalls, 0);
});

test("onBackButton falls back to leaveGame and rethrows callback errors", () => {
  const target = new NavigationTarget();
  let leaveGameCalls = 0;

  withWindow(
    {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      __oasizSetBackOverride: () => {},
      __oasizLeaveGame: () => {
        leaveGameCalls += 1;
      },
    },
    () => {
      const expected = new Error("boom");
      const off = onBackButton(() => {
        throw expected;
      });

      assert.throws(
        () => target.dispatchEvent(new Event("oasiz:back")),
        (error: unknown) => error === expected,
      );

      off();
    },
  );

  assert.equal(leaveGameCalls, 1);
});

test("onBackButton normalizes non-Error throws before rethrowing", () => {
  const target = new NavigationTarget();
  let leaveGameCalls = 0;

  withWindow(
    {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      __oasizSetBackOverride: () => {},
      __oasizLeaveGame: () => {
        leaveGameCalls += 1;
      },
    },
    () => {
      const off = onBackButton(() => {
        throw "boom";
      });

      assert.throws(
        () => target.dispatchEvent(new Event("oasiz:back")),
        (error: unknown) =>
          error instanceof Error && error.message === "boom",
      );

      off();
    },
  );

  assert.equal(leaveGameCalls, 1);
});

test("onLeaveGame subscribes and unsubscribes from leave event", () => {
  const target = new EventTarget();

  withWindow(
    {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    },
    () => {
      let leaves = 0;
      const off = onLeaveGame(() => {
        leaves += 1;
      });

      target.dispatchEvent(new Event("oasiz:leave"));
      assert.equal(leaves, 1);

      off();
      target.dispatchEvent(new Event("oasiz:leave"));
      assert.equal(leaves, 1);
    },
  );
});
