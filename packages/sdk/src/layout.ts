type LayoutBridgeWindow = Window & {
  __OASIZ_SAFE_AREA_TOP__?: unknown;
  __oasizSetLeaderboardVisible?: (visible: boolean) => void;
  getSafeAreaTop?: () => unknown;
};

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
}

function getBridgeWindow(): LayoutBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as LayoutBridgeWindow;
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

function normalizeSafeAreaTop(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

export function getSafeAreaTop(): number {
  const bridge = getBridgeWindow();
  if (!bridge) {
    return 0;
  }

  if (typeof bridge.getSafeAreaTop === "function") {
    return normalizeSafeAreaTop(bridge.getSafeAreaTop());
  }

  if (typeof bridge.__OASIZ_SAFE_AREA_TOP__ !== "undefined") {
    return normalizeSafeAreaTop(bridge.__OASIZ_SAFE_AREA_TOP__);
  }

  warnMissingBridge("getSafeAreaTop");
  return 0;
}

export function setLeaderboardVisible(visible: boolean): void {
  if (typeof visible !== "boolean") {
    if (isDevelopment()) {
      console.warn(
        "[oasiz/sdk] setLeaderboardVisible expected a boolean:",
        visible,
      );
    }
    return;
  }

  const bridge = getBridgeWindow();
  if (typeof bridge?.__oasizSetLeaderboardVisible === "function") {
    bridge.__oasizSetLeaderboardVisible(visible);
    return;
  }

  warnMissingBridge("__oasizSetLeaderboardVisible");
}
