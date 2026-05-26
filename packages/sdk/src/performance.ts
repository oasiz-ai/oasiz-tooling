export type GraphicsPerformanceTier = "minimal" | "low" | "medium" | "high";

export interface GraphicsPerformanceMetric {
  /** Recommended graphics/rendering frame-rate target for the current device. */
  fps: number;
  /** Suggested graphics/rendering tier for the current device. */
  tier: GraphicsPerformanceTier;
}

type PerformanceBridgeWindow = Window & {
  __OASIZ_GRAPHICS_PERFORMANCE__?: unknown;
  __OASIZ_PERFORMANCE_METRIC__?: unknown;
  getGraphicsPerformance?: () => unknown;
  getGraphicsPerformanceMetric?: () => unknown;
  getPerformanceMetric?: () => unknown;
};

const DEFAULT_GRAPHICS_PERFORMANCE: GraphicsPerformanceMetric = {
  fps: 45,
  tier: "medium",
};

const TIER_DEFAULT_FPS: Record<GraphicsPerformanceTier, number> = {
  minimal: 24,
  low: 30,
  medium: 45,
  high: 60,
};

let cachedEstimatedGraphicsPerformance: GraphicsPerformanceMetric | undefined;

function getBridgeWindow(): PerformanceBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as PerformanceBridgeWindow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampFps(value: number): number {
  return Math.min(240, Math.max(1, Math.round(value)));
}

function tierFromScore(score: number): GraphicsPerformanceTier {
  if (score < 25) return "minimal";
  if (score < 40) return "low";
  if (score < 70) return "medium";
  return "high";
}

function tierFromFps(fps: number): GraphicsPerformanceTier {
  if (fps < 30) return "minimal";
  if (fps < 45) return "low";
  if (fps < 58) return "medium";
  return "high";
}

function fpsFromScore(score: number): number {
  return TIER_DEFAULT_FPS[tierFromScore(score)];
}

function normalizeTier(value: unknown): GraphicsPerformanceTier | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "minimal" || normalized === "safe") return "minimal";
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  if (normalized === "low") return "low";
  return undefined;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => typeof value !== "undefined");
}

function normalizeMetric(value: unknown): GraphicsPerformanceMetric | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }

  if (typeof value === "number" || typeof value === "string") {
    const numeric = toFiniteNumber(value);
    if (typeof numeric !== "undefined") {
      const fps = clampFps(numeric);
      return { fps, tier: tierFromFps(fps) };
    }

    const tier = normalizeTier(value);
    if (tier) {
      return { fps: TIER_DEFAULT_FPS[tier], tier };
    }

    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const fpsCandidate = firstDefined(
    value.fps,
    value.targetFps,
    value.frameRate,
    value.framesPerSecond,
  );
  const legacyScoreCandidate = firstDefined(
    value.score,
    value.metric,
    value.value,
    value.performance,
    value.performanceScore,
    value.graphicsScore,
  );
  const tierCandidate = firstDefined(
    value.tier,
    value.graphicsTier,
    value.performanceTier,
    value.qualityTier,
    value.recommendedTier,
  );

  const tier = normalizeTier(tierCandidate);
  const fpsNumeric = toFiniteNumber(fpsCandidate);
  const scoreNumeric = toFiniteNumber(legacyScoreCandidate);

  if (typeof fpsNumeric === "undefined" && typeof scoreNumeric === "undefined" && !tier) {
    return undefined;
  }

  const fps = clampFps(
    typeof fpsNumeric !== "undefined"
      ? fpsNumeric
      : typeof scoreNumeric !== "undefined"
        ? fpsFromScore(clampScore(scoreNumeric))
        : TIER_DEFAULT_FPS[tier!],
  );
  return {
    fps,
    tier: tier ?? tierFromFps(fps),
  };
}

function callBridgeMetric(
  bridge: PerformanceBridgeWindow,
  name: keyof PerformanceBridgeWindow,
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

function readHostGraphicsPerformance(
  bridge: PerformanceBridgeWindow,
): GraphicsPerformanceMetric | undefined {
  const candidates = [
    callBridgeMetric(bridge, "getGraphicsPerformance"),
    callBridgeMetric(bridge, "getGraphicsPerformanceMetric"),
    callBridgeMetric(bridge, "getPerformanceMetric"),
    bridge.__OASIZ_GRAPHICS_PERFORMANCE__,
    bridge.__OASIZ_PERFORMANCE_METRIC__,
  ];

  for (const candidate of candidates) {
    const metric = normalizeMetric(candidate);
    if (metric) {
      return metric;
    }
  }

  return undefined;
}

function getDevicePixelRatio(bridge: PerformanceBridgeWindow): number {
  const dpr = bridge.devicePixelRatio;
  return typeof dpr === "number" && Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

function getNavigatorValue(
  bridge: PerformanceBridgeWindow,
): (Navigator & { deviceMemory?: number }) | undefined {
  return bridge.navigator as (Navigator & { deviceMemory?: number }) | undefined;
}

function parseIosMajorVersion(userAgent: string): number | undefined {
  const match = /\bOS (\d+)_/i.exec(userAgent);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isAppleMobileDevice(bridge: PerformanceBridgeWindow): boolean {
  const userAgent = bridge.navigator?.userAgent ?? "";
  return (
    /iP(hone|ad|od)/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && (bridge.navigator?.maxTouchPoints ?? 0) > 1)
  );
}

function getLongestScreenEdge(bridge: PerformanceBridgeWindow): number {
  const screenWidth = bridge.screen?.width;
  const screenHeight = bridge.screen?.height;
  const innerWidth = bridge.innerWidth;
  const innerHeight = bridge.innerHeight;
  return Math.max(
    typeof screenWidth === "number" ? screenWidth : 0,
    typeof screenHeight === "number" ? screenHeight : 0,
    typeof innerWidth === "number" ? innerWidth : 0,
    typeof innerHeight === "number" ? innerHeight : 0,
  );
}

function isCoarsePointer(bridge: PerformanceBridgeWindow): boolean {
  try {
    return bridge.matchMedia?.("(pointer: coarse)").matches === true;
  } catch {
    return false;
  }
}

function getWebGlInfo(bridge: PerformanceBridgeWindow): {
  maxTextureSize?: number;
  renderer?: string;
  webglVersion: 0 | 1 | 2;
} {
  const canvas = bridge.document?.createElement?.("canvas");
  if (!canvas || typeof canvas.getContext !== "function") {
    return { webglVersion: 0 };
  }

  const gl2 = canvas.getContext("webgl2");
  const gl =
    gl2 ??
    canvas.getContext("webgl") ??
    canvas.getContext("experimental-webgl");

  if (!gl) {
    return { webglVersion: 0 };
  }

  const context = gl as WebGLRenderingContext | WebGL2RenderingContext;
  let maxTextureSize: number | undefined;
  let renderer: string | undefined;

  try {
    const value = context.getParameter(context.MAX_TEXTURE_SIZE);
    if (typeof value === "number" && Number.isFinite(value)) {
      maxTextureSize = value;
    }
  } catch {
    // Ignore unavailable WebGL parameters.
  }

  try {
    const debugInfo = context.getExtension("WEBGL_debug_renderer_info") as
      | { UNMASKED_RENDERER_WEBGL?: number }
      | null;
    const rendererParam = debugInfo?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER;
    const value = context.getParameter(rendererParam);
    if (typeof value === "string") {
      renderer = value;
    }
  } catch {
    // Ignore unavailable debug renderer info.
  }

  return {
    maxTextureSize,
    renderer,
    webglVersion: gl2 ? 2 : 1,
  };
}

function applyMemoryScore(score: number, memory: number | undefined): number {
  if (typeof memory !== "number" || !Number.isFinite(memory) || memory <= 0) {
    return score;
  }
  if (memory <= 1) return score - 18;
  if (memory <= 2) return score - 10;
  if (memory >= 8) return score + 16;
  if (memory >= 6) return score + 10;
  return score;
}

function applyCoreScore(score: number, cores: number | undefined): number {
  if (typeof cores !== "number" || !Number.isFinite(cores) || cores <= 0) {
    return score;
  }
  if (cores <= 2) return score - 12;
  if (cores <= 4) return score;
  if (cores >= 8) return score + 12;
  return score + 8;
}

function applyWebGlScore(
  score: number,
  info: ReturnType<typeof getWebGlInfo>,
): number {
  let next = score;
  if (info.webglVersion === 2) {
    next += 16;
  } else if (info.webglVersion === 1) {
    next += 6;
  } else {
    next -= 25;
  }

  if (typeof info.maxTextureSize === "number") {
    if (info.maxTextureSize >= 8192) next += 10;
    else if (info.maxTextureSize >= 4096) next += 3;
    else next -= 8;
  }

  const renderer = info.renderer?.toLowerCase() ?? "";
  if (/swiftshader|llvmpipe|software/.test(renderer)) {
    next = Math.min(next, 35);
  } else if (/\bm[1-9]\b|apple gpu|a1[6-9]|rtx|radeon|adreno 7|adreno 8/.test(renderer)) {
    next += 8;
  }

  return next;
}

function applyMobileCostScore(
  score: number,
  bridge: PerformanceBridgeWindow,
): number {
  if (!isCoarsePointer(bridge)) {
    return score;
  }

  const dpr = getDevicePixelRatio(bridge);
  const width = bridge.screen?.width ?? bridge.innerWidth ?? 0;
  const height = bridge.screen?.height ?? bridge.innerHeight ?? 0;
  const physicalPixels = width * height * dpr * dpr;
  if (physicalPixels > 4_000_000) {
    return score - 5;
  }
  return score;
}

function applyAppleMobileRules(
  score: number,
  bridge: PerformanceBridgeWindow,
): number {
  if (!isAppleMobileDevice(bridge)) {
    return score;
  }

  const userAgent = bridge.navigator?.userAgent ?? "";
  const iosMajorVersion = parseIosMajorVersion(userAgent);
  const highDensityDisplay = getDevicePixelRatio(bridge) >= 3;
  const longestScreenEdge = getLongestScreenEdge(bridge);

  if (typeof iosMajorVersion === "number" && iosMajorVersion < 15) {
    return Math.min(score, 35);
  }

  if (
    highDensityDisplay &&
    longestScreenEdge >= 430 &&
    (typeof iosMajorVersion === "undefined" || iosMajorVersion >= 17)
  ) {
    return Math.max(score, 78);
  }

  if (
    highDensityDisplay &&
    longestScreenEdge >= 414 &&
    (typeof iosMajorVersion === "undefined" || iosMajorVersion >= 16)
  ) {
    return Math.max(score, 62);
  }

  return Math.min(score, 48);
}

function estimateGraphicsPerformance(
  bridge: PerformanceBridgeWindow,
): GraphicsPerformanceMetric {
  const navigatorValue = getNavigatorValue(bridge);
  let score = 45;
  score = applyMemoryScore(score, navigatorValue?.deviceMemory);
  score = applyCoreScore(score, navigatorValue?.hardwareConcurrency);
  score = applyWebGlScore(score, getWebGlInfo(bridge));
  score = applyMobileCostScore(score, bridge);
  score = applyAppleMobileRules(score, bridge);

  const normalizedScore = clampScore(score);
  return {
    fps: fpsFromScore(normalizedScore),
    tier: tierFromScore(normalizedScore),
  };
}

/**
 * Return the current device's recommended graphics performance profile.
 *
 * Hosts can provide an FPS/tier recommendation through
 * `window.getGraphicsPerformance()` or `window.__OASIZ_GRAPHICS_PERFORMANCE__`.
 * When no host value exists, the SDK estimates from browser/device/WebGL
 * capability signals so games still get a usable recommendation in local
 * development and unsupported hosts.
 */
export function getGraphicsPerformance(): GraphicsPerformanceMetric {
  const bridge = getBridgeWindow();
  if (!bridge) {
    return { ...DEFAULT_GRAPHICS_PERFORMANCE };
  }

  const hostMetric = readHostGraphicsPerformance(bridge);
  if (hostMetric) {
    return hostMetric;
  }

  cachedEstimatedGraphicsPerformance ??= estimateGraphicsPerformance(bridge);
  return { ...cachedEstimatedGraphicsPerformance };
}
