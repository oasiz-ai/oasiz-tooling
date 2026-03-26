import type { GameState } from "./types.ts";

type StateBridgeWindow = Window & {
  loadGameState?: () => unknown;
  saveGameState?: (state: GameState) => void;
  flushGameState?: () => void;
};

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
}

function getBridgeWindow(): StateBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as StateBridgeWindow;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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

export function loadGameState(): GameState {
  const bridge = getBridgeWindow();

  if (typeof bridge?.loadGameState !== "function") {
    warnMissingBridge("loadGameState");
    return {};
  }

  const state = bridge.loadGameState();
  if (!isPlainObject(state)) {
    if (isDevelopment()) {
      console.warn(
        "[oasiz/sdk] loadGameState returned invalid data. Falling back to empty object.",
      );
    }
    return {};
  }

  return state;
}

export function saveGameState(state: GameState): void {
  if (!isPlainObject(state)) {
    if (isDevelopment()) {
      console.warn("[oasiz/sdk] saveGameState expected a plain object:", state);
    }
    return;
  }

  const bridge = getBridgeWindow();
  if (typeof bridge?.saveGameState === "function") {
    bridge.saveGameState(state);
    return;
  }

  warnMissingBridge("saveGameState");
}

export function flushGameState(): void {
  const bridge = getBridgeWindow();
  if (typeof bridge?.flushGameState === "function") {
    bridge.flushGameState();
    return;
  }

  warnMissingBridge("flushGameState");
}
