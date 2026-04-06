import assert from "node:assert/strict";
import test from "node:test";

import { enableLogOverlay, oasiz } from "../src/index.ts";
import {
  getSafeAreaTop,
  setLeaderboardVisible,
} from "../src/layout.ts";
import { onPause, onResume } from "../src/lifecycle.ts";
import { leaveGame, onBackButton, onLeaveGame } from "../src/navigation.ts";
import {
  getGameId,
  getPlayerAvatar,
  getPlayerName,
  getRoomCode,
  openInviteModal,
  shareRoomCode,
} from "../src/multiplayer.ts";
import { submitScore } from "../src/score.ts";
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

test("getSafeAreaTop reads bridge-backed values", () => {
  const safeAreaTop = withWindow(
    {
      getSafeAreaTop: () => 96,
    },
    () => getSafeAreaTop(),
  );

  assert.equal(safeAreaTop, 96);
  assert.equal(
    withWindow({ getSafeAreaTop: () => 32 }, () => oasiz.safeAreaTop),
    32,
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

test("multiplayer getters return injected values", () => {
  withWindow(
    {
      __GAME_ID__: "game-123",
      __ROOM_CODE__: "WXYZ",
      __PLAYER_NAME__: "Josiah",
      __PLAYER_AVATAR__: "https://example.com/avatar.png",
    },
    () => {
      assert.equal(getGameId(), "game-123");
      assert.equal(getRoomCode(), "WXYZ");
      assert.equal(getPlayerName(), "Josiah");
      assert.equal(getPlayerAvatar(), "https://example.com/avatar.png");

      assert.equal(oasiz.gameId, "game-123");
      assert.equal(oasiz.roomCode, "WXYZ");
      assert.equal(oasiz.playerName, "Josiah");
      assert.equal(oasiz.playerAvatar, "https://example.com/avatar.png");
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
