export type ViewportInsetSide = "top" | "right" | "bottom" | "left";

export interface ViewportInsetEdges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportInsets {
  pixels: ViewportInsetEdges;
  percent: ViewportInsetEdges;
}

type LayoutBridgeWindow = Window & {
  __OASIZ_SAFE_AREA_BOTTOM__?: unknown;
  __OASIZ_SAFE_AREA_BOTTOM_PERCENT__?: unknown;
  __OASIZ_SAFE_AREA_LEFT__?: unknown;
  __OASIZ_SAFE_AREA_LEFT_PERCENT__?: unknown;
  __OASIZ_SAFE_AREA_RIGHT__?: unknown;
  __OASIZ_SAFE_AREA_RIGHT_PERCENT__?: unknown;
  __OASIZ_SAFE_AREA_TOP__?: unknown;
  __OASIZ_SAFE_AREA_TOP_PERCENT__?: unknown;
  __OASIZ_VIEWPORT_INSETS__?: unknown;
  __OASIZ_VIEWPORT_INSETS_PERCENT__?: unknown;
  __oasizSetLeaderboardVisible?: (visible: boolean) => void;
  getSafeAreaBottom?: () => unknown;
  getSafeAreaBottomPercent?: () => unknown;
  getSafeAreaLeft?: () => unknown;
  getSafeAreaLeftPercent?: () => unknown;
  getSafeAreaRight?: () => unknown;
  getSafeAreaRightPercent?: () => unknown;
  getSafeAreaTop?: () => unknown;
  getSafeAreaTopPercent?: () => unknown;
  getViewportInsets?: () => unknown;
  getViewportInsetsPercent?: () => unknown;
};

const INSET_SIDES: ViewportInsetSide[] = ["top", "right", "bottom", "left"];

const SIDE_TO_AXIS: Record<ViewportInsetSide, "horizontal" | "vertical"> = {
  top: "vertical",
  right: "horizontal",
  bottom: "vertical",
  left: "horizontal",
};

function createInsetEdges(value: number): ViewportInsetEdges {
  return {
    top: value,
    right: value,
    bottom: value,
    left: value,
  };
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function clampInsetPixels(value: unknown): number | undefined {
  const numeric = toFiniteNumber(value);
  if (typeof numeric === "undefined") {
    return undefined;
  }
  return Math.max(0, numeric);
}

function normalizeInsetPercent(value: unknown): number | undefined {
  const numeric = toFiniteNumber(value);
  if (typeof numeric === "undefined") {
    return undefined;
  }
  return Math.min(100, Math.max(0, numeric));
}

function getViewportSize(
  bridge: LayoutBridgeWindow,
  axis: "horizontal" | "vertical",
): number {
  const visualViewportSize =
    axis === "vertical" ? bridge.visualViewport?.height : bridge.visualViewport?.width;
  if (
    typeof visualViewportSize === "number" &&
    Number.isFinite(visualViewportSize) &&
    visualViewportSize > 0
  ) {
    return visualViewportSize;
  }

  const innerSize = axis === "vertical" ? bridge.innerHeight : bridge.innerWidth;
  if (typeof innerSize === "number" && Number.isFinite(innerSize) && innerSize > 0) {
    return innerSize;
  }

  const documentSize =
    axis === "vertical"
      ? bridge.document?.documentElement?.clientHeight
      : bridge.document?.documentElement?.clientWidth;
  if (typeof documentSize === "number" && Number.isFinite(documentSize) && documentSize > 0) {
    return documentSize;
  }

  const bodySize =
    axis === "vertical"
      ? bridge.document?.body?.clientHeight
      : bridge.document?.body?.clientWidth;
  if (typeof bodySize === "number" && Number.isFinite(bodySize) && bodySize > 0) {
    return bodySize;
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
    return clampInsetPixels(bridge.getComputedStyle(probe).paddingTop) ?? 0;
  } finally {
    if (typeof probe.remove === "function") {
      probe.remove();
    } else {
      probe.parentNode?.removeChild(probe);
    }
  }
}

function readCssSafeAreaPixels(
  bridge: LayoutBridgeWindow,
  side: ViewportInsetSide,
): number {
  const envPixels = readCssSafeAreaValue(
    bridge,
    "env(safe-area-inset-" + side + ")",
  );
  if (envPixels > 0) {
    return envPixels;
  }

  return readCssSafeAreaValue(
    bridge,
    "constant(safe-area-inset-" + side + ")",
  );
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

function normalizeInsetPixels(
  value: unknown,
  bridge: LayoutBridgeWindow,
  side: ViewportInsetSide,
): number | undefined {
  const pixels = clampInsetPixels(value);
  if (typeof pixels === "undefined") {
    return undefined;
  }

  const cssEnvPixels = readCssSafeAreaPixels(bridge, side);
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

function pixelsToPercentOfViewport(
  pixels: number,
  bridge: LayoutBridgeWindow,
  side: ViewportInsetSide,
): number {
  const size = getViewportSize(bridge, SIDE_TO_AXIS[side]);
  if (size <= 0) {
    return 0;
  }
  return normalizeInsetPercent((pixels / size) * 100) ?? 0;
}

function percentToPixelsOfViewport(
  percent: number,
  bridge: LayoutBridgeWindow,
  side: ViewportInsetSide,
): number {
  const size = getViewportSize(bridge, SIDE_TO_AXIS[side]);
  if (size <= 0) {
    return 0;
  }
  return (percent / 100) * size;
}

function cssSafeAreaPercent(
  bridge: LayoutBridgeWindow,
  side: ViewportInsetSide,
): number {
  return pixelsToPercentOfViewport(readCssSafeAreaPixels(bridge, side), bridge, side);
}

function resolvePercentValue(
  value: unknown,
  bridge: LayoutBridgeWindow,
  side: ViewportInsetSide,
): number | undefined {
  const percent = normalizeInsetPercent(value);
  if (typeof percent === "undefined") {
    return undefined;
  }

  return percent > 0 ? percent : cssSafeAreaPercent(bridge, side);
}

function resolvePixelValue(
  value: unknown,
  bridge: LayoutBridgeWindow,
  side: ViewportInsetSide,
): number | undefined {
  const numeric = toFiniteNumber(value);
  if (typeof numeric === "undefined") {
    return undefined;
  }

  return normalizeInsetPixels(numeric, bridge, side);
}

function sideSuffix(side: ViewportInsetSide): "Top" | "Right" | "Bottom" | "Left" {
  switch (side) {
    case "top":
      return "Top";
    case "right":
      return "Right";
    case "bottom":
      return "Bottom";
    case "left":
      return "Left";
  }
}

function callBridgeFunction(
  bridge: LayoutBridgeWindow,
  name: keyof LayoutBridgeWindow,
): unknown {
  const fn = bridge[name];
  if (typeof fn !== "function") {
    return undefined;
  }

  try {
    return fn.call(bridge);
  } catch (error) {
    console.error("[oasiz/sdk] " + String(name) + " failed:", error);
    return undefined;
  }
}

function readInsetObjectValue(
  value: unknown,
  side: ViewportInsetSide,
  group?: "pixels" | "percent",
): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  if (group) {
    return isRecord(value[group]) ? value[group][side] : undefined;
  }

  return value[side];
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => typeof value !== "undefined");
}

interface HostInsetSources {
  globalPixels?: unknown;
  globalPercent?: unknown;
  methodPixels?: unknown;
  methodPercent?: unknown;
}

function readHostInsetSources(bridge: LayoutBridgeWindow): HostInsetSources {
  return {
    globalPixels: bridge.__OASIZ_VIEWPORT_INSETS__,
    globalPercent: bridge.__OASIZ_VIEWPORT_INSETS_PERCENT__,
    methodPixels: callBridgeFunction(bridge, "getViewportInsets"),
    methodPercent: callBridgeFunction(bridge, "getViewportInsetsPercent"),
  };
}

function readIndividualPercentValue(
  bridge: LayoutBridgeWindow,
  side: ViewportInsetSide,
): unknown {
  const suffix = sideSuffix(side);
  return firstDefined(
    callBridgeFunction(
      bridge,
      ("getSafeArea" + suffix + "Percent") as keyof LayoutBridgeWindow,
    ),
    bridge[
      ("__OASIZ_SAFE_AREA_" + side.toUpperCase() + "_PERCENT__") as keyof LayoutBridgeWindow
    ],
  );
}

function readIndividualPixelValue(
  bridge: LayoutBridgeWindow,
  side: ViewportInsetSide,
): unknown {
  const suffix = sideSuffix(side);
  return firstDefined(
    callBridgeFunction(
      bridge,
      ("getSafeArea" + suffix) as keyof LayoutBridgeWindow,
    ),
    bridge[("__OASIZ_SAFE_AREA_" + side.toUpperCase() + "__") as keyof LayoutBridgeWindow],
  );
}

function resolveInsetSide(
  bridge: LayoutBridgeWindow,
  sources: HostInsetSources,
  side: ViewportInsetSide,
): { pixels: number; percent: number } {
  const percentCandidate = firstDefined(
    readInsetObjectValue(sources.methodPercent, side, "percent"),
    readInsetObjectValue(sources.methodPercent, side),
    readInsetObjectValue(sources.globalPercent, side, "percent"),
    readInsetObjectValue(sources.globalPercent, side),
    readInsetObjectValue(sources.methodPixels, side, "percent"),
    readInsetObjectValue(sources.globalPixels, side, "percent"),
    readIndividualPercentValue(bridge, side),
  );
  const percent = resolvePercentValue(percentCandidate, bridge, side);
  if (typeof percent !== "undefined") {
    return {
      pixels: percentToPixelsOfViewport(percent, bridge, side),
      percent,
    };
  }

  const pixelCandidate = firstDefined(
    readInsetObjectValue(sources.methodPixels, side, "pixels"),
    readInsetObjectValue(sources.methodPixels, side),
    readInsetObjectValue(sources.globalPixels, side, "pixels"),
    readInsetObjectValue(sources.globalPixels, side),
    readIndividualPixelValue(bridge, side),
  );
  const pixels = resolvePixelValue(pixelCandidate, bridge, side);
  if (typeof pixels !== "undefined") {
    return {
      pixels,
      percent: pixelsToPercentOfViewport(pixels, bridge, side),
    };
  }

  const cssPixels = readCssSafeAreaPixels(bridge, side);
  return {
    pixels: cssPixels,
    percent: pixelsToPercentOfViewport(cssPixels, bridge, side),
  };
}

/**
 * Effective viewport insets that game UI should avoid.
 *
 * `top` preserves the existing Oasiz game-safe top behavior: host chrome and
 * invite/leaderboard clearance can contribute to it. Other sides are device
 * safe-area insets today, and can include future host UI obstructions.
 */
export function getViewportInsets(): ViewportInsets {
  const bridge = getBridgeWindow();
  if (!bridge) {
    return {
      pixels: createInsetEdges(0),
      percent: createInsetEdges(0),
    };
  }

  const sources = readHostInsetSources(bridge);
  const pixels = createInsetEdges(0);
  const percent = createInsetEdges(0);

  for (const side of INSET_SIDES) {
    const resolved = resolveInsetSide(bridge, sources, side);
    pixels[side] = resolved.pixels;
    percent[side] = resolved.percent;
  }

  return { pixels, percent };
}

/**
 * Legacy alias for the top entry of `getViewportInsets().percent`.
 */
export function getSafeAreaTop(): number {
  const bridge = getBridgeWindow();
  if (!bridge) {
    return 0;
  }

  const top = getViewportInsets().percent.top;
  if (top <= 0) {
    warnMissingBridge("getSafeAreaTop");
  }
  return top;
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
