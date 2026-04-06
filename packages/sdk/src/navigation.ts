import type { Unsubscribe } from "./lifecycle.ts";

type NavigationEventName = "oasiz:back" | "oasiz:leave";

type NavigationBridgeWindow = Window & {
  __oasizSetBackOverride?: (active: boolean) => void;
  __oasizLeaveGame?: () => void;
};

let activeBackListeners = 0;

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
