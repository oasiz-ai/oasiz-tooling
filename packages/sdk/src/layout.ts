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

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    if (typeof value !== "string") {
      return undefined;
    }

    const parsed = Number.parseFloat(value.trim());
    if (!Number.isFinite(parsed)) {
      return undefined;
    }

    return parsed;
  }
  return value;
}

function clampSafeAreaTopPixels(value: unknown): number {
  const numeric = toFiniteNumber(value);
  if (typeof numeric === "undefined") {
    return 0;
  }
  return Math.max(0, numeric);
}

function normalizeSafeAreaTopPercent(value: unknown): number | undefined {
  const numeric = toFiniteNumber(value);
  if (typeof numeric === "undefined") {
    return undefined;
  }
  return Math.min(100, Math.max(0, numeric));
}

function getViewportHeight(bridge: LayoutBridgeWindow): number {
  const visualViewportHeight = bridge.visualViewport?.height;
  if (
    typeof visualViewportHeight === "number" &&
    Number.isFinite(visualViewportHeight) &&
    visualViewportHeight > 0
  ) {
    return visualViewportHeight;
  }

  const innerHeight = bridge.innerHeight;
  if (typeof innerHeight === "number" && Number.isFinite(innerHeight) && innerHeight > 0) {
    return innerHeight;
  }

  const documentHeight = bridge.document?.documentElement?.clientHeight;
  if (typeof documentHeight === "number" && Number.isFinite(documentHeight) && documentHeight > 0) {
    return documentHeight;
  }

  const bodyHeight = bridge.document?.body?.clientHeight;
  if (typeof bodyHeight === "number" && Number.isFinite(bodyHeight) && bodyHeight > 0) {
    return bodyHeight;
  }

  return 0;
}

function readCssSafeAreaValue(bridge: LayoutBridgeWindow, cssValue: string): number {
  const doc = bridge.document;
  const root = doc?.body ?? doc?.documentElement;
  if (
    !doc ||
    !root ||
    typeof doc.createElement !== "function" ||
    typeof root.appendChild !== "function" ||
    typeof bridge.getComputedStyle !== "function"
  ) {
    return 0;
  }

  const probe = doc.createElement("div");
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.style.width = "0";
  probe.style.height = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingTop = cssValue;

  root.appendChild(probe);
  try {
    return clampSafeAreaTopPixels(bridge.getComputedStyle(probe).paddingTop);
  } finally {
    if (typeof probe.remove === "function") {
      probe.remove();
    } else {
      probe.parentNode?.removeChild(probe);
    }
  }
}

function readCssSafeAreaTopPixels(bridge: LayoutBridgeWindow): number {
  const envPixels = readCssSafeAreaValue(bridge, "env(safe-area-inset-top)");
  if (envPixels > 0) {
    return envPixels;
  }

  return readCssSafeAreaValue(bridge, "constant(safe-area-inset-top)");
}

function getDevicePixelRatio(bridge: LayoutBridgeWindow): number {
  const dpr = bridge.devicePixelRatio;
  if (typeof dpr !== "number" || !Number.isFinite(dpr) || dpr <= 0) {
    return 1;
  }
  return dpr;
}

function roughlyEqualPixels(a: number, b: number): boolean {
  return Math.abs(a - b) <= 2;
}

function normalizeSafeAreaTopPixels(value: unknown, bridge: LayoutBridgeWindow): number {
  const pixels = clampSafeAreaTopPixels(value);
  const cssEnvPixels = readCssSafeAreaTopPixels(bridge);
  if (pixels <= 0) {
    return cssEnvPixels;
  }

  const dpr = getDevicePixelRatio(bridge);
  if (
    cssEnvPixels > 0 &&
    dpr > 1 &&
    roughlyEqualPixels(pixels / dpr, cssEnvPixels)
  ) {
    return cssEnvPixels;
  }

  return pixels;
}

function pixelsTopToPercentOfViewport(
  pixels: number,
  bridge: LayoutBridgeWindow,
): number {
  const h = getViewportHeight(bridge);
  if (h <= 0) {
    return 0;
  }
  return normalizeSafeAreaTopPercent((pixels / h) * 100) ?? 0;
}

function cssSafeAreaTopPercent(bridge: LayoutBridgeWindow): number {
  return pixelsTopToPercentOfViewport(readCssSafeAreaTopPixels(bridge), bridge);
}

function resolvePercentValue(value: unknown, bridge: LayoutBridgeWindow): number | undefined {
  const percent = normalizeSafeAreaTopPercent(value);
  if (typeof percent === "undefined") {
    return undefined;
  }

  return percent > 0 ? percent : cssSafeAreaTopPercent(bridge);
}

function resolvePixelValue(value: unknown, bridge: LayoutBridgeWindow): number | undefined {
  const numeric = toFiniteNumber(value);
  if (typeof numeric === "undefined") {
    return undefined;
  }

  return pixelsTopToPercentOfViewport(normalizeSafeAreaTopPixels(numeric, bridge), bridge);
}

/**
 * Top safe-area inset as a percentage of the viewport height (0–100).
 * The host may expose CSS pixels via `getSafeAreaTop` / `__OASIZ_SAFE_AREA_TOP__`
 * (converted using the active viewport height), or percentages via
 * `getSafeAreaTopPercent` / `__OASIZ_SAFE_AREA_TOP_PERCENT__`.
 */
export function getSafeAreaTop(): number {
  const bridge = getBridgeWindow();
  if (!bridge) {
    return 0;
  }

  if (typeof bridge.getSafeAreaTopPercent === "function") {
    const percent = resolvePercentValue(bridge.getSafeAreaTopPercent(), bridge);
    if (typeof percent !== "undefined") {
      return percent;
    }
  }

  if (typeof bridge.__OASIZ_SAFE_AREA_TOP_PERCENT__ !== "undefined") {
    const percent = resolvePercentValue(bridge.__OASIZ_SAFE_AREA_TOP_PERCENT__, bridge);
    if (typeof percent !== "undefined") {
      return percent;
    }
  }

  if (typeof bridge.getSafeAreaTop === "function") {
    const percent = resolvePixelValue(bridge.getSafeAreaTop(), bridge);
    if (typeof percent !== "undefined") {
      return percent;
    }
  }

  if (typeof bridge.__OASIZ_SAFE_AREA_TOP__ !== "undefined") {
    const percent = resolvePixelValue(bridge.__OASIZ_SAFE_AREA_TOP__, bridge);
    if (typeof percent !== "undefined") {
      return percent;
    }
  }

  const cssPercent = cssSafeAreaTopPercent(bridge);
  if (cssPercent > 0) {
    return cssPercent;
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
