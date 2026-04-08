type LayoutBridgeWindow = Window & {
  __OASIZ_SAFE_AREA_TOP__?: unknown;
  __OASIZ_SAFE_AREA_TOP_PERCENT__?: unknown;
  __oasizSetLeaderboardVisible?: (visible: boolean) => void;
  getSafeAreaTop?: () => unknown;
  getSafeAreaTopPercent?: () => unknown;
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

function normalizeSafeAreaTopPixels(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function normalizeSafeAreaTopPercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function viewportInnerHeight(bridge: LayoutBridgeWindow): number {
  const h = bridge.innerHeight;
  if (typeof h !== "number" || !Number.isFinite(h) || h <= 0) {
    return 0;
  }
  return h;
}

function pixelsTopToPercentOfViewport(
  pixels: number,
  bridge: LayoutBridgeWindow,
): number {
  const h = viewportInnerHeight(bridge);
  if (h <= 0) {
    return 0;
  }
  return normalizeSafeAreaTopPercent((pixels / h) * 100);
}

/**
 * Top safe-area inset as a percentage of the viewport height (0–100).
 * The host may expose CSS pixels via `getSafeAreaTop` / `__OASIZ_SAFE_AREA_TOP__`
 * (converted using `window.innerHeight`), or percentages via
 * `getSafeAreaTopPercent` / `__OASIZ_SAFE_AREA_TOP_PERCENT__`.
 */
export function getSafeAreaTop(): number {
  const bridge = getBridgeWindow();
  if (!bridge) {
    return 0;
  }

  if (typeof bridge.getSafeAreaTopPercent === "function") {
    return normalizeSafeAreaTopPercent(bridge.getSafeAreaTopPercent());
  }

  if (typeof bridge.__OASIZ_SAFE_AREA_TOP_PERCENT__ !== "undefined") {
    return normalizeSafeAreaTopPercent(bridge.__OASIZ_SAFE_AREA_TOP_PERCENT__);
  }

  if (typeof bridge.getSafeAreaTop === "function") {
    const px = normalizeSafeAreaTopPixels(bridge.getSafeAreaTop());
    return pixelsTopToPercentOfViewport(px, bridge);
  }

  if (typeof bridge.__OASIZ_SAFE_AREA_TOP__ !== "undefined") {
    const px = normalizeSafeAreaTopPixels(bridge.__OASIZ_SAFE_AREA_TOP__);
    return pixelsTopToPercentOfViewport(px, bridge);
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
