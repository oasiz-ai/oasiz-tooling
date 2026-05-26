import type { Unsubscribe } from "./lifecycle.ts";

type NavigationEventName = "oasiz:back" | "oasiz:leave";

type NavigationBridgeWindow = Window & {
  __oasizSetBackOverride?: (active: boolean) => void;
  __oasizLeaveGame?: () => void;
};

export interface BackButtonTestingOptions {
  /**
   * When true, pressing Escape dispatches the same event the host app sends for
   * back actions. Defaults to true.
   */
  keyboard?: boolean;
  /**
   * When true, the SDK traps one browser-history entry while back override is
   * active, so the browser Back button can be used for local testing. Defaults
   * to true.
   */
  browserHistory?: boolean;
  /** Log setup details to the console. Defaults to false. */
  log?: boolean;
}

export interface BackButtonTestingHandle {
  destroy: () => void;
  isBackOverrideActive: () => boolean;
  triggerBack: () => void;
  triggerLeave: () => void;
}

const BACK_BUTTON_TEST_STATE_KEY = "__oasizBackButtonTest";

let activeBackListeners = 0;
let activeBackButtonTestingHandle: BackButtonTestingHandle | undefined;

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
}

function getBridgeWindow(): NavigationBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as NavigationBridgeWindow;
}

function warnMissingBridge(methodName: string): void {
  if (isDevelopment()) {
    console.warn(
      "[oasiz/sdk] " +
        methodName +
        " bridge is unavailable. This is expected in local development.",
    );
  }
}

function normalizeNavigationError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(
    typeof error === "string" ? error : "Back button callback failed.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function dispatchNavigationEvent(eventName: NavigationEventName): void {
  const bridge = getBridgeWindow();
  if (!bridge || typeof bridge.dispatchEvent !== "function") {
    return;
  }
  bridge.dispatchEvent(new Event(eventName));
}

function addNavigationListener(
  eventName: NavigationEventName,
  callback: () => void,
): Unsubscribe {
  if (typeof window === "undefined") {
    if (isDevelopment()) {
      console.warn(
        "[oasiz/sdk] " +
          eventName +
          " listener registered without a browser window. This is expected in local development.",
      );
    }
    return () => {};
  }

  const handler: EventListener = () => callback();
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}

export function enableBackButtonTesting(
  options: BackButtonTestingOptions = {},
): BackButtonTestingHandle {
  activeBackButtonTestingHandle?.destroy();

  const bridge = getBridgeWindow();
  if (!bridge) {
    if (isDevelopment()) {
      console.warn(
        "[oasiz/sdk] enableBackButtonTesting requires a browser window.",
      );
    }
    return {
      destroy: () => {},
      isBackOverrideActive: () => false,
      triggerBack: () => {},
      triggerLeave: () => {},
    };
  }

  const bridgeWindow = bridge;

  const keyboard = options.keyboard ?? true;
  const browserHistory = options.browserHistory ?? true;
  const log = options.log === true;
  const previousSetBackOverride = bridgeWindow.__oasizSetBackOverride;
  const previousLeaveGame = bridgeWindow.__oasizLeaveGame;

  let destroyed = false;
  let backOverrideActive = false;
  let historyTrapArmed = false;

  function maybeLog(message: string): void {
    if (log) {
      console.info("[oasiz/sdk] " + message);
    }
  }

  function canUseHistoryTrap(): boolean {
    return (
      browserHistory &&
      typeof bridgeWindow.history?.pushState === "function" &&
      typeof bridgeWindow.history?.replaceState === "function" &&
      typeof bridgeWindow.location?.href === "string"
    );
  }

  function ensureHistoryTrap(): void {
    if (!backOverrideActive || historyTrapArmed || !canUseHistoryTrap()) {
      return;
    }

    try {
      const currentState = isRecord(bridgeWindow.history.state)
        ? bridgeWindow.history.state
        : {};
      bridgeWindow.history.replaceState(
        { ...currentState, [BACK_BUTTON_TEST_STATE_KEY]: "base" },
        "",
        bridgeWindow.location.href,
      );
      bridgeWindow.history.pushState(
        { [BACK_BUTTON_TEST_STATE_KEY]: "trap" },
        "",
        bridgeWindow.location.href,
      );
      historyTrapArmed = true;
      maybeLog("Local browser Back testing is armed.");
    } catch (error) {
      historyTrapArmed = false;
      if (log) {
        console.warn("[oasiz/sdk] Failed to arm browser Back testing:", error);
      }
    }
  }

  function triggerBack(): void {
    dispatchNavigationEvent("oasiz:back");
  }

  function triggerLeave(): void {
    dispatchNavigationEvent("oasiz:leave");
  }

  function setBackOverride(active: boolean): void {
    backOverrideActive = active;
    if (active) {
      ensureHistoryTrap();
    }
    if (typeof previousSetBackOverride === "function") {
      previousSetBackOverride(active);
    }
    maybeLog("Back override " + (active ? "enabled" : "disabled") + ".");
  }

  function stopBackEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    (event as Event & { stopImmediatePropagation?: () => void })
      .stopImmediatePropagation?.();
  }

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!backOverrideActive || event.key !== "Escape") {
      return;
    }
    stopBackEvent(event);
    triggerBack();
  };

  const handlePopState = (event: PopStateEvent): void => {
    if (!backOverrideActive) {
      historyTrapArmed = false;
      return;
    }

    stopBackEvent(event);
    triggerBack();
    historyTrapArmed = false;
    ensureHistoryTrap();
  };

  const testLeaveGame = () => {
    triggerLeave();
    if (typeof previousLeaveGame === "function") {
      previousLeaveGame();
    }
  };

  bridgeWindow.__oasizSetBackOverride = setBackOverride;
  bridgeWindow.__oasizLeaveGame = testLeaveGame;

  if (keyboard) {
    bridgeWindow.addEventListener("keydown", handleKeyDown);
  }
  if (browserHistory) {
    bridgeWindow.addEventListener("popstate", handlePopState);
  }

  if (activeBackListeners > 0) {
    setBackOverride(true);
  }

  maybeLog("Back button testing bridge installed.");

  const handle: BackButtonTestingHandle = {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (keyboard) {
        bridgeWindow.removeEventListener("keydown", handleKeyDown);
      }
      if (browserHistory) {
        bridgeWindow.removeEventListener("popstate", handlePopState);
      }
      if (bridgeWindow.__oasizSetBackOverride === setBackOverride) {
        bridgeWindow.__oasizSetBackOverride = previousSetBackOverride;
      }
      if (bridgeWindow.__oasizLeaveGame === testLeaveGame) {
        bridgeWindow.__oasizLeaveGame = previousLeaveGame;
      }
      if (activeBackButtonTestingHandle === handle) {
        activeBackButtonTestingHandle = undefined;
      }
      maybeLog("Back button testing bridge removed.");
    },
    isBackOverrideActive: () => backOverrideActive,
    triggerBack,
    triggerLeave,
  };

  activeBackButtonTestingHandle = handle;
  return handle;
}

export function onBackButton(callback: () => void): Unsubscribe {
  const off = addNavigationListener("oasiz:back", () => {
    try {
      callback();
    } catch (error) {
      leaveGame();
      throw normalizeNavigationError(error);
    }
  });
  const bridge = getBridgeWindow();

  activeBackListeners += 1;
  if (activeBackListeners === 1) {
    if (typeof bridge?.__oasizSetBackOverride === "function") {
      bridge.__oasizSetBackOverride(true);
    } else {
      warnMissingBridge("__oasizSetBackOverride");
    }
  }

  return () => {
    off();
    activeBackListeners = Math.max(0, activeBackListeners - 1);
    if (activeBackListeners === 0) {
      const currentBridge = getBridgeWindow();
      if (typeof currentBridge?.__oasizSetBackOverride === "function") {
        currentBridge.__oasizSetBackOverride(false);
      } else {
        warnMissingBridge("__oasizSetBackOverride");
      }
    }
  };
}

export function onLeaveGame(callback: () => void): Unsubscribe {
  return addNavigationListener("oasiz:leave", callback);
}

export function leaveGame(): void {
  const bridge = getBridgeWindow();
  if (typeof bridge?.__oasizLeaveGame === "function") {
    bridge.__oasizLeaveGame();
    return;
  }

  warnMissingBridge("__oasizLeaveGame");
}
