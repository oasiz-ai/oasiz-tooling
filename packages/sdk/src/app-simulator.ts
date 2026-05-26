import type { ViewportInsetEdges, ViewportInsets } from "./layout.ts";
import {
  enableBackButtonTesting,
  type BackButtonTestingHandle,
  type BackButtonTestingOptions,
} from "./navigation.ts";

export type AppSimulatorDeviceName =
  | "iphone-11"
  | "iphone-11-pro"
  | "iphone-11-pro-max"
  | "iphone-12-mini"
  | "iphone-12"
  | "iphone-12-pro"
  | "iphone-12-pro-max"
  | "iphone-13-mini"
  | "iphone-13"
  | "iphone-13-pro"
  | "iphone-13-pro-max"
  | "iphone-14"
  | "iphone-14-plus"
  | "iphone-14-pro"
  | "iphone-14-pro-max"
  | "iphone-15"
  | "iphone-15-plus"
  | "iphone-15-pro"
  | "iphone-15-pro-max"
  | "iphone-16"
  | "iphone-16-plus"
  | "iphone-16-pro"
  | "iphone-16-pro-max"
  | "iphone-16e"
  | "iphone-17"
  | "iphone-17-pro"
  | "iphone-17-pro-max"
  | "iphone-17e"
  | "iphone-air"
  | "iphone-se"
  | "pixel-8";

export type AppSimulatorOrientation = "portrait" | "landscape";

export interface AppSimulatorDevice {
  height: number;
  name?: string;
  safeArea?: Partial<ViewportInsetEdges>;
  width: number;
}

export interface AppSimulatorOptions {
  browserHistoryBack?: BackButtonTestingOptions["browserHistory"];
  comments?: number;
  device?: AppSimulatorDeviceName | AppSimulatorDevice;
  enabled?: boolean;
  /**
   * When true, the SDK tries to place the current game DOM inside a centered
   * phone viewport on desktop. Use false if your game already runs in browser
   * device emulation or owns its own preview frame. Defaults to true.
   */
  frame?: boolean | "auto";
  keyboardBack?: BackButtonTestingOptions["keyboard"];
  leaderboardVisible?: boolean;
  likes?: number;
  log?: boolean;
  orientation?: AppSimulatorOrientation;
  score?: number;
  title?: string;
}

export interface AppSimulatorHandle {
  closeSheet: () => void;
  destroy: () => void;
  getViewportInsets: () => ViewportInsets;
  hide: () => void;
  isVisible: () => boolean;
  openComments: () => void;
  openLeaderboard: () => void;
  setCounts: (counts: { comments?: number; likes?: number }) => void;
  setLeaderboardVisible: (visible: boolean) => void;
  setLiked: (liked: boolean) => void;
  show: () => void;
  triggerBack: () => void;
  triggerLeave: () => void;
}

type AppSimulatorSheet = "comments" | "leaderboard" | null;

type AppSimulatorWindow = Window & {
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
  __oasizAppSimulatorHandle__?: AppSimulatorHandle;
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

interface AppSimulatorElements {
  gameViewport: HTMLDivElement | null;
  root: HTMLDivElement;
  stage: HTMLDivElement;
  style: HTMLStyleElement;
}

interface AppSimulatorRect {
  height: number;
  left: number;
  scale: number;
  top: number;
  width: number;
}

interface BridgeSnapshot {
  globals: Partial<Record<keyof AppSimulatorWindow, unknown>>;
}

interface AppSimulatorState {
  backHandle: BackButtonTestingHandle;
  bridgeSnapshot: BridgeSnapshot;
  cleanupResize: () => void;
  device: Required<AppSimulatorDevice>;
  elements: AppSimulatorElements;
  frameEnabled: boolean;
  movedNodes: Node[];
  previousBodyStyle: string | null;
  previousDocumentElementStyle: string | null;
  rect: AppSimulatorRect;
  sheet: AppSimulatorSheet;
  visible: boolean;
  wasDestroyed: boolean;
  wasLiked: boolean;
  counts: {
    comments: number;
    likes: number;
  };
  leaderboard: {
    score: number;
    visible: boolean;
  };
  options: Required<
    Pick<
      AppSimulatorOptions,
      "browserHistoryBack" | "keyboardBack" | "log" | "orientation" | "title"
    >
  >;
}

const DEVICE_PRESETS: Record<AppSimulatorDeviceName, Required<AppSimulatorDevice>> = {
  "iphone-11": {
    name: "iPhone 11",
    width: 414,
    height: 896,
    safeArea: { top: 48, right: 0, bottom: 34, left: 0 },
  },
  "iphone-11-pro": {
    name: "iPhone 11 Pro",
    width: 375,
    height: 812,
    safeArea: { top: 44, right: 0, bottom: 34, left: 0 },
  },
  "iphone-11-pro-max": {
    name: "iPhone 11 Pro Max",
    width: 414,
    height: 896,
    safeArea: { top: 44, right: 0, bottom: 34, left: 0 },
  },
  "iphone-12-mini": {
    name: "iPhone 12 mini",
    width: 375,
    height: 812,
    safeArea: { top: 50, right: 0, bottom: 34, left: 0 },
  },
  "iphone-12": {
    name: "iPhone 12",
    width: 390,
    height: 844,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  "iphone-12-pro": {
    name: "iPhone 12 Pro",
    width: 390,
    height: 844,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  "iphone-12-pro-max": {
    name: "iPhone 12 Pro Max",
    width: 428,
    height: 926,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  "iphone-13-mini": {
    name: "iPhone 13 mini",
    width: 375,
    height: 812,
    safeArea: { top: 50, right: 0, bottom: 34, left: 0 },
  },
  "iphone-13": {
    name: "iPhone 13",
    width: 390,
    height: 844,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  "iphone-13-pro": {
    name: "iPhone 13 Pro",
    width: 390,
    height: 844,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  "iphone-13-pro-max": {
    name: "iPhone 13 Pro Max",
    width: 428,
    height: 926,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  "iphone-14": {
    name: "iPhone 14",
    width: 390,
    height: 844,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  "iphone-14-plus": {
    name: "iPhone 14 Plus",
    width: 428,
    height: 926,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  "iphone-14-pro": {
    name: "iPhone 14 Pro",
    width: 393,
    height: 852,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  "iphone-14-pro-max": {
    name: "iPhone 14 Pro Max",
    width: 430,
    height: 932,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  "iphone-15": {
    name: "iPhone 15",
    width: 393,
    height: 852,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  "iphone-15-plus": {
    name: "iPhone 15 Plus",
    width: 430,
    height: 932,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  "iphone-15-pro": {
    name: "iPhone 15 Pro",
    width: 393,
    height: 852,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  "iphone-15-pro-max": {
    name: "iPhone 15 Pro Max",
    width: 430,
    height: 932,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  "iphone-16": {
    name: "iPhone 16",
    width: 393,
    height: 852,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  "iphone-16-plus": {
    name: "iPhone 16 Plus",
    width: 430,
    height: 932,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  "iphone-16-pro": {
    name: "iPhone 16 Pro",
    width: 402,
    height: 874,
    safeArea: { top: 62, right: 0, bottom: 34, left: 0 },
  },
  "iphone-16-pro-max": {
    name: "iPhone 16 Pro Max",
    width: 440,
    height: 956,
    safeArea: { top: 62, right: 0, bottom: 34, left: 0 },
  },
  "iphone-16e": {
    name: "iPhone 16e",
    width: 390,
    height: 844,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  "iphone-17": {
    name: "iPhone 17",
    width: 402,
    height: 874,
    safeArea: { top: 62, right: 0, bottom: 34, left: 0 },
  },
  "iphone-17-pro": {
    name: "iPhone 17 Pro",
    width: 402,
    height: 874,
    safeArea: { top: 62, right: 0, bottom: 34, left: 0 },
  },
  "iphone-17-pro-max": {
    name: "iPhone 17 Pro Max",
    width: 440,
    height: 956,
    safeArea: { top: 62, right: 0, bottom: 34, left: 0 },
  },
  "iphone-17e": {
    name: "iPhone 17e",
    width: 390,
    height: 844,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  "iphone-air": {
    name: "iPhone Air",
    width: 420,
    height: 912,
    safeArea: { top: 62, right: 0, bottom: 34, left: 0 },
  },
  "iphone-se": {
    name: "iPhone SE",
    width: 375,
    height: 667,
    safeArea: { top: 20, right: 0, bottom: 0, left: 0 },
  },
  "pixel-8": {
    name: "Pixel 8",
    width: 412,
    height: 915,
    safeArea: { top: 32, right: 0, bottom: 24, left: 0 },
  },
};

const DEFAULT_COUNTS = {
  comments: 18,
  likes: 128,
};

const DEFAULT_SCORE = 12400;
const TOP_BAR_OFFSET = 12;
const TOP_CHROME_HEIGHT = 44;
const BODY_BACKGROUND = "#08090d";
const TEXT_PRIMARY = "#F6F9FB";
const TEXT_SECONDARY = "rgba(246,249,251,0.72)";
const TEXT_MUTED = "rgba(246,249,251,0.52)";
const BORDER = "rgba(255,255,255,0.14)";
const SURFACE = "rgba(18,20,24,0.82)";
const SURFACE_LIGHT = "rgba(255,255,255,0.10)";
const ACCENT = "#00A1E4";
const LIKE = "#ef4444";
const TROPHY = "#FBBF24";
const MAX_Z_INDEX = 2147483638;

const EMPTY_INSETS: ViewportInsetEdges = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

const BRIDGE_KEYS: Array<keyof AppSimulatorWindow> = [
  "__OASIZ_SAFE_AREA_BOTTOM__",
  "__OASIZ_SAFE_AREA_BOTTOM_PERCENT__",
  "__OASIZ_SAFE_AREA_LEFT__",
  "__OASIZ_SAFE_AREA_LEFT_PERCENT__",
  "__OASIZ_SAFE_AREA_RIGHT__",
  "__OASIZ_SAFE_AREA_RIGHT_PERCENT__",
  "__OASIZ_SAFE_AREA_TOP__",
  "__OASIZ_SAFE_AREA_TOP_PERCENT__",
  "__OASIZ_VIEWPORT_INSETS__",
  "__OASIZ_VIEWPORT_INSETS_PERCENT__",
  "__oasizSetLeaderboardVisible",
  "getSafeAreaBottom",
  "getSafeAreaBottomPercent",
  "getSafeAreaLeft",
  "getSafeAreaLeftPercent",
  "getSafeAreaRight",
  "getSafeAreaRightPercent",
  "getSafeAreaTop",
  "getSafeAreaTopPercent",
  "getViewportInsets",
  "getViewportInsetsPercent",
];

const NOOP_HANDLE: AppSimulatorHandle = {
  closeSheet() {},
  destroy() {},
  getViewportInsets() {
    return { pixels: { ...EMPTY_INSETS }, percent: { ...EMPTY_INSETS } };
  },
  hide() {},
  isVisible() {
    return false;
  },
  openComments() {},
  openLeaderboard() {},
  setCounts() {},
  setLeaderboardVisible() {},
  setLiked() {},
  show() {},
  triggerBack() {},
  triggerLeave() {},
};

function getBrowserWindow(): AppSimulatorWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as AppSimulatorWindow;
}

function getDocument(): Document | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  return document;
}

function warn(message: string): void {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  if (nodeEnv !== "production") {
    console.warn("[oasiz/sdk] " + message);
  }
}

function normalizeCount(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (value >= 1_000) {
    return (value / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return String(value);
}

function resolveDevice(
  device: AppSimulatorOptions["device"],
  orientation: AppSimulatorOrientation,
): Required<AppSimulatorDevice> {
  const preset =
    typeof device === "string"
      ? DEVICE_PRESETS[device]
      : device
        ? {
            name: device.name ?? "Custom phone",
            width: device.width,
            height: device.height,
            safeArea: {
              ...EMPTY_INSETS,
              ...device.safeArea,
            },
          }
        : DEVICE_PRESETS["iphone-17-pro-max"];

  const normalized: Required<AppSimulatorDevice> = {
    name: preset.name,
    width: Math.max(320, Math.floor(preset.width)),
    height: Math.max(480, Math.floor(preset.height)),
    safeArea: {
      ...EMPTY_INSETS,
      ...preset.safeArea,
    },
  };

  if (orientation === "landscape") {
    return {
      ...normalized,
      width: Math.max(normalized.width, normalized.height),
      height: Math.min(normalized.width, normalized.height),
      safeArea: {
        top: 0,
        right: normalized.safeArea.top,
        bottom: 21,
        left: normalized.safeArea.top,
      },
    };
  }

  return normalized;
}

function shouldFrame(
  frame: AppSimulatorOptions["frame"],
  browserWindow: AppSimulatorWindow,
  device: Required<AppSimulatorDevice>,
): boolean {
  if (frame === true) {
    return true;
  }
  if (frame === false) {
    return false;
  }
  return (
    browserWindow.innerWidth > device.width + 80 ||
    browserWindow.innerHeight > device.height + 80
  );
}

function computeRect(
  browserWindow: AppSimulatorWindow,
  device: Required<AppSimulatorDevice>,
  frameEnabled: boolean,
): AppSimulatorRect {
  const viewportWidth = Math.max(320, browserWindow.innerWidth || device.width);
  const viewportHeight = Math.max(480, browserWindow.innerHeight || device.height);

  if (!frameEnabled) {
    return {
      left: 0,
      top: 0,
      width: viewportWidth,
      height: viewportHeight,
      scale: Math.min(viewportWidth / device.width, viewportHeight / device.height),
    };
  }

  const margin = 24;
  const scale = Math.min(
    (viewportWidth - margin) / device.width,
    (viewportHeight - margin) / device.height,
    1,
  );
  const width = Math.round(device.width * scale);
  const height = Math.round(device.height * scale);

  return {
    left: Math.round((viewportWidth - width) / 2),
    top: Math.round((viewportHeight - height) / 2),
    width,
    height,
    scale,
  };
}

function scaledInset(value: number | undefined, scale: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value * scale));
}

function getSimulatorInsets(state: AppSimulatorState): ViewportInsets {
  const safe = state.device.safeArea;
  const top = scaledInset(safe.top, state.rect.scale) + Math.round((TOP_BAR_OFFSET + TOP_CHROME_HEIGHT) * state.rect.scale);
  const pixels: ViewportInsetEdges = {
    top,
    right: scaledInset(safe.right, state.rect.scale),
    bottom: scaledInset(safe.bottom, state.rect.scale),
    left: scaledInset(safe.left, state.rect.scale),
  };
  const percent: ViewportInsetEdges = {
    top: state.rect.height > 0 ? (pixels.top / state.rect.height) * 100 : 0,
    right: state.rect.width > 0 ? (pixels.right / state.rect.width) * 100 : 0,
    bottom: state.rect.height > 0 ? (pixels.bottom / state.rect.height) * 100 : 0,
    left: state.rect.width > 0 ? (pixels.left / state.rect.width) * 100 : 0,
  };

  return { pixels, percent };
}

function snapshotBridge(browserWindow: AppSimulatorWindow): BridgeSnapshot {
  const globals: Partial<Record<keyof AppSimulatorWindow, unknown>> = {};
  for (const key of BRIDGE_KEYS) {
    globals[key] = browserWindow[key];
  }
  return { globals };
}

function restoreBridge(
  browserWindow: AppSimulatorWindow,
  snapshot: BridgeSnapshot,
): void {
  for (const key of BRIDGE_KEYS) {
    const value = snapshot.globals[key];
    if (typeof value === "undefined") {
      delete browserWindow[key];
    } else {
      (browserWindow as unknown as Record<string, unknown>)[key] = value;
    }
  }
}

function installBridge(state: AppSimulatorState): void {
  const browserWindow = getBrowserWindow();
  if (!browserWindow) return;
  const bridge = browserWindow;

  function refreshInsets(): ViewportInsets {
    const insets = getSimulatorInsets(state);
    bridge.__OASIZ_VIEWPORT_INSETS__ = insets;
    bridge.__OASIZ_VIEWPORT_INSETS_PERCENT__ = insets.percent;
    bridge.__OASIZ_SAFE_AREA_TOP__ = insets.pixels.top;
    bridge.__OASIZ_SAFE_AREA_RIGHT__ = insets.pixels.right;
    bridge.__OASIZ_SAFE_AREA_BOTTOM__ = insets.pixels.bottom;
    bridge.__OASIZ_SAFE_AREA_LEFT__ = insets.pixels.left;
    bridge.__OASIZ_SAFE_AREA_TOP_PERCENT__ = insets.percent.top;
    bridge.__OASIZ_SAFE_AREA_RIGHT_PERCENT__ = insets.percent.right;
    bridge.__OASIZ_SAFE_AREA_BOTTOM_PERCENT__ = insets.percent.bottom;
    bridge.__OASIZ_SAFE_AREA_LEFT_PERCENT__ = insets.percent.left;
    return insets;
  }

  bridge.getViewportInsets = () => refreshInsets();
  bridge.getViewportInsetsPercent = () => refreshInsets().percent;
  bridge.getSafeAreaTop = () => refreshInsets().pixels.top;
  bridge.getSafeAreaRight = () => refreshInsets().pixels.right;
  bridge.getSafeAreaBottom = () => refreshInsets().pixels.bottom;
  bridge.getSafeAreaLeft = () => refreshInsets().pixels.left;
  bridge.getSafeAreaTopPercent = () => refreshInsets().percent.top;
  bridge.getSafeAreaRightPercent = () => refreshInsets().percent.right;
  bridge.getSafeAreaBottomPercent = () => refreshInsets().percent.bottom;
  bridge.getSafeAreaLeftPercent = () => refreshInsets().percent.left;
  bridge.__oasizSetLeaderboardVisible = (visible: boolean) => {
    state.leaderboard.visible = visible;
    renderSimulator(state);
  };

  refreshInsets();
}

function createStyleElement(): HTMLStyleElement {
  const style = document.createElement("style");
  style.setAttribute("data-oasiz-app-simulator", "styles");
  style.textContent = [
    ".oasiz-app-sim-button{appearance:none;border:0;margin:0;padding:0;font:inherit;color:inherit;background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}",
    ".oasiz-app-sim-button:active{transform:scale(0.97)}",
    ".oasiz-app-sim-glass{background:rgba(18,20,24,0.42);border:1px solid rgba(255,255,255,0.22);box-shadow:0 12px 30px rgba(0,0,0,0.28),inset 0 1px 0 rgba(255,255,255,0.18);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}",
    ".oasiz-app-sim-scroll::-webkit-scrollbar{width:0;height:0}",
  ].join("\n");
  return style;
}

function applyTextStyle(element: HTMLElement, size = 12, weight = 600): void {
  element.style.font =
    String(weight) +
    " " +
    String(size) +
    "px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
}

function createDiv(className?: string): HTMLDivElement {
  const element = document.createElement("div");
  if (className) {
    element.className = className;
  }
  return element;
}

function createButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "oasiz-app-sim-button";
  button.setAttribute("aria-label", title);
  button.title = title;
  button.innerHTML = label;
  return button;
}

function svgIcon(name: "back" | "bookmark" | "chat" | "heart" | "share" | "trophy", filled = false): string {
  if (name === "back") {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';
  }
  if (name === "heart") {
    return filled
      ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 21s-7.4-4.4-9.7-9.1C.7 8.5 2.7 4.8 6.4 4.3c2-.3 3.8.7 5.6 2.8 1.8-2.1 3.6-3.1 5.6-2.8 3.7.5 5.7 4.2 4.1 7.6C19.4 16.6 12 21 12 21Z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6c-2-1.8-5.1-1.5-6.9.6L12 7.4l-1.9-2.2C8.3 3.1 5.2 2.8 3.2 4.6.8 6.8.7 10.5 3 12.9L12 21l9-8.1c2.3-2.4 2.2-6.1-.2-8.3Z"/></svg>';
  }
  if (name === "chat") {
    return filled
      ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v7A3.5 3.5 0 0 1 16.5 16H9l-4.2 3.1A1.1 1.1 0 0 1 3 18.2V5.5Z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v7A3.5 3.5 0 0 1 16.5 16H9l-4.2 3.1A1.1 1.1 0 0 1 3 18.2V5.5Z"/></svg>';
  }
  if (name === "trophy") {
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 3h10v3h3a1 1 0 0 1 1 1c0 3.2-1.8 5.5-4.6 6.1A5 5 0 0 1 13 15.9V19h3v2H8v-2h3v-3.1a5 5 0 0 1-3.4-2.8C4.8 12.5 3 10.2 3 7a1 1 0 0 1 1-1h3V3Zm10 5v2.8c1.1-.5 1.8-1.5 2-2.8h-2ZM5 8c.2 1.3.9 2.3 2 2.8V8H5Z"/></svg>';
  }
  if (name === "share") {
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 14v5h14v-5"/></svg>';
  }
  return filled
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>';
}

function setBoxStyle(element: HTMLElement, state: AppSimulatorState): void {
  const { rect } = state;
  element.style.left = rect.left + "px";
  element.style.top = rect.top + "px";
  element.style.width = rect.width + "px";
  element.style.height = rect.height + "px";
}

function createCircleButton(
  icon: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = createButton(icon, title);
  button.classList.add("oasiz-app-sim-glass");
  button.style.cssText += [
    "position:absolute",
    "width:44px",
    "height:44px",
    "border-radius:999px",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "color:" + TEXT_PRIMARY,
    "pointer-events:auto",
  ].join(";");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function createHubPill(state: AppSimulatorState): HTMLButtonElement {
  const button = createButton("", "Open comments");
  button.classList.add("oasiz-app-sim-glass");
  button.style.cssText += [
    "position:absolute",
    "right:16px",
    "height:44px",
    "min-width:94px",
    "border-radius:999px",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "gap:10px",
    "padding:0 14px",
    "color:" + TEXT_PRIMARY,
    "pointer-events:auto",
  ].join(";");

  const likeColor = state.wasLiked ? LIKE : TEXT_PRIMARY;
  button.innerHTML =
    '<span style="display:inline-flex;align-items:center;gap:4px;color:' +
    likeColor +
    '">' +
    svgIcon("heart", state.wasLiked) +
    '<span>' +
    formatCompactCount(state.counts.likes) +
    "</span></span>" +
    '<span style="display:inline-flex;align-items:center;gap:4px;color:' +
    ACCENT +
    '">' +
    svgIcon("chat", true) +
    '<span>' +
    formatCompactCount(state.counts.comments) +
    "</span></span>";
  applyTextStyle(button, 12, 700);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.sheet = "comments";
    renderSimulator(state);
  });
  return button;
}

function createLeaderboardPill(state: AppSimulatorState): HTMLButtonElement {
  const button = createButton("", "Open leaderboard");
  button.classList.add("oasiz-app-sim-glass");
  button.style.cssText += [
    "position:absolute",
    "left:50%",
    "height:44px",
    "min-width:118px",
    "border-radius:999px",
    "display:" + (state.leaderboard.visible ? "flex" : "none"),
    "align-items:center",
    "justify-content:center",
    "gap:8px",
    "padding:0 14px",
    "color:" + TEXT_PRIMARY,
    "pointer-events:auto",
    "transform:translateX(-50%)",
  ].join(";");
  button.innerHTML =
    '<span style="color:' +
    TROPHY +
    ';display:inline-flex">' +
    svgIcon("trophy", true) +
    '</span><span style="min-width:0">' +
    formatCompactCount(state.leaderboard.score) +
    "</span>";
  applyTextStyle(button, 14, 800);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.sheet = "leaderboard";
    renderSimulator(state);
  });
  return button;
}

function createToolbarButton(
  icon: string,
  count: number | null,
  color: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = createButton("", title);
  button.classList.add("oasiz-app-sim-glass");
  button.style.cssText += [
    "height:42px",
    "min-width:42px",
    "border-radius:999px",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "gap:6px",
    "padding:0 12px",
    "color:" + color,
    "pointer-events:auto",
  ].join(";");
  button.innerHTML =
    icon +
    (count === null
      ? ""
      : '<span style="color:' +
        color +
        ';min-width:0">' +
        formatCompactCount(count) +
        "</span>");
  applyTextStyle(button, 13, 700);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function createSheet(state: AppSimulatorState): HTMLDivElement | null {
  if (!state.sheet) {
    return null;
  }

  const overlay = createDiv();
  overlay.style.cssText = [
    "position:absolute",
    "left:0",
    "top:0",
    "right:0",
    "bottom:0",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:" +
      String(scaledInset(state.device.safeArea.top, state.rect.scale) + 72) +
      "px 12px " +
      String(Math.max(18, scaledInset(state.device.safeArea.bottom, state.rect.scale) + 18)) +
      "px",
    "background:rgba(0,0,0,0.34)",
    "pointer-events:auto",
  ].join(";");
  overlay.addEventListener("click", () => {
    state.sheet = null;
    renderSimulator(state);
  });

  const sheet = createDiv();
  sheet.style.cssText = [
    "position:relative",
    "width:min(100%, 408px)",
    "max-height:100%",
    "min-height:min(390px, 64%)",
    "display:flex",
    "flex-direction:column",
    "border-radius:24px",
    "border:1px solid " + BORDER,
    "background:linear-gradient(180deg, rgba(18,20,24,0.97), rgba(9,11,15,0.98))",
    "box-shadow:0 30px 80px rgba(0,0,0,0.52), inset 0 1px 0 rgba(255,255,255,0.10)",
    "overflow:hidden",
    "pointer-events:auto",
  ].join(";");
  sheet.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  const handle = createDiv();
  handle.style.cssText = [
    "width:42px",
    "height:5px",
    "border-radius:999px",
    "background:rgba(255,255,255,0.28)",
    "align-self:center",
    "margin:10px 0 2px",
  ].join(";");

  const header = createDiv();
  header.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "gap:8px",
    "min-height:62px",
    "padding:6px 14px 10px",
    "border-bottom:1px solid " + BORDER,
  ].join(";");

  const left = createDiv();
  left.style.cssText = "display:flex;align-items:center;gap:8px;min-width:112px";
  const title = createDiv();
  title.textContent =
    state.sheet === "comments"
      ? String(state.counts.comments) + " comments"
      : "Leaderboard";
  title.style.cssText = [
    "flex:1",
    "min-width:0",
    "text-align:center",
    "color:" + TEXT_PRIMARY,
  ].join(";");
  applyTextStyle(title, 14, 700);

  const right = createDiv();
  right.style.cssText = "display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:112px";

  const back = createToolbarButton(svgIcon("back"), null, TEXT_PRIMARY, "Close", () => {
    state.sheet = null;
    renderSimulator(state);
  });
  back.style.width = "36px";
  back.style.height = "36px";
  back.style.padding = "0";
  left.appendChild(back);

  if (state.sheet === "comments") {
    const like = createToolbarButton(
      svgIcon("heart", state.wasLiked),
      state.counts.likes,
      state.wasLiked ? LIKE : TEXT_PRIMARY,
      "Like game",
      () => {
        state.wasLiked = !state.wasLiked;
        state.counts.likes = Math.max(0, state.counts.likes + (state.wasLiked ? 1 : -1));
        renderSimulator(state);
      },
    );
    left.appendChild(like);
  } else {
    const trophy = createToolbarButton(svgIcon("trophy", true), null, TROPHY, "Leaderboard", () => {});
    trophy.style.width = "36px";
    trophy.style.height = "36px";
    trophy.style.padding = "0";
    left.appendChild(trophy);
  }

  const share = createToolbarButton(svgIcon("share"), null, TEXT_PRIMARY, "Share", () => {});
  const save = createToolbarButton(svgIcon("bookmark"), null, TEXT_PRIMARY, "Save", () => {});
  right.appendChild(share);
  right.appendChild(save);

  header.appendChild(left);
  header.appendChild(title);
  header.appendChild(right);

  const body = createDiv("oasiz-app-sim-scroll");
  body.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:10px",
    "overflow:auto",
    "padding:14px 16px calc(" +
      String(Math.max(16, scaledInset(state.device.safeArea.bottom, state.rect.scale))) +
      "px + 14px)",
    "min-height:0",
  ].join(";");

  if (state.sheet === "leaderboard") {
    appendLeaderboardBody(body);
  } else {
    appendCommentsBody(body, state);
  }

  sheet.appendChild(handle);
  sheet.appendChild(header);
  sheet.appendChild(body);
  overlay.appendChild(sheet);
  return overlay;
}

function appendLeaderboardBody(body: HTMLDivElement): void {
  const tabs = createDiv();
  tabs.style.cssText = [
    "display:grid",
    "grid-template-columns:repeat(3,1fr)",
    "gap:6px",
    "padding:4px",
    "border-radius:14px",
    "background:rgba(255,255,255,0.07)",
  ].join(";");

  for (const label of ["Weekly", "Global", "Friends"]) {
    const tab = createDiv();
    tab.textContent = label;
    tab.style.cssText = [
      "border-radius:10px",
      "padding:8px 6px",
      "text-align:center",
      "color:" + (label === "Weekly" ? TEXT_PRIMARY : TEXT_MUTED),
      "background:" + (label === "Weekly" ? "rgba(0,161,228,0.28)" : "transparent"),
    ].join(";");
    applyTextStyle(tab, 12, 700);
    tabs.appendChild(tab);
  }
  body.appendChild(tabs);

  const entries = [
    ["1", "Nova", "24.8k"],
    ["2", "You", "12.4k"],
    ["3", "Mika", "9.7k"],
    ["4", "Ari", "8.1k"],
  ];

  for (const [rank, name, score] of entries) {
    const row = createDiv();
    row.style.cssText = [
      "display:grid",
      "grid-template-columns:34px 1fr auto",
      "align-items:center",
      "gap:10px",
      "min-height:58px",
      "padding:10px 12px",
      "border-radius:14px",
      "background:" + (name === "You" ? "rgba(0,161,228,0.13)" : "rgba(255,255,255,0.06)"),
      "border:1px solid " + (name === "You" ? "rgba(0,161,228,0.28)" : "rgba(255,255,255,0.08)"),
    ].join(";");
    const rankEl = createDiv();
    rankEl.textContent = rank;
    rankEl.style.cssText = "color:" + (rank === "1" ? TROPHY : TEXT_MUTED) + ";text-align:center";
    applyTextStyle(rankEl, 14, 800);
    const nameEl = createDiv();
    nameEl.textContent = name;
    nameEl.style.cssText = "color:" + TEXT_PRIMARY + ";min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    applyTextStyle(nameEl, 14, 700);
    const scoreEl = createDiv();
    scoreEl.textContent = score;
    scoreEl.style.cssText = "color:" + TEXT_SECONDARY;
    applyTextStyle(scoreEl, 13, 700);
    row.appendChild(rankEl);
    row.appendChild(nameEl);
    row.appendChild(scoreEl);
    body.appendChild(row);
  }
}

function appendCommentsBody(body: HTMLDivElement, state: AppSimulatorState): void {
  const toolbar = createDiv();
  toolbar.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:8px",
    "height:48px",
  ].join(";");
  toolbar.appendChild(
    createToolbarButton(
      svgIcon("heart", state.wasLiked),
      state.counts.likes,
      state.wasLiked ? LIKE : TEXT_PRIMARY,
      "Like game",
      () => {
        state.wasLiked = !state.wasLiked;
        state.counts.likes = Math.max(0, state.counts.likes + (state.wasLiked ? 1 : -1));
        renderSimulator(state);
      },
    ),
  );
  toolbar.appendChild(
    createToolbarButton(svgIcon("chat", true), state.counts.comments, ACCENT, "Comments", () => {}),
  );
  toolbar.appendChild(createToolbarButton(svgIcon("share"), null, TEXT_PRIMARY, "Share", () => {}));
  toolbar.appendChild(createToolbarButton(svgIcon("bookmark"), null, TEXT_PRIMARY, "Save", () => {}));
  body.appendChild(toolbar);

  const comments = [
    ["You", "Can my score panel clear the top buttons?"],
    ["Nova", "This is a good spot to check pause and menu spacing."],
    ["Mika", "The app chrome stays above the game just like mobile."],
  ];

  for (const [author, text] of comments) {
    const row = createDiv();
    row.style.cssText = [
      "display:grid",
      "grid-template-columns:34px 1fr",
      "gap:10px",
      "padding:10px 0",
    ].join(";");
    const avatar = createDiv();
    avatar.textContent = author.charAt(0);
    avatar.style.cssText = [
      "width:34px",
      "height:34px",
      "border-radius:999px",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "background:rgba(0,161,228,0.28)",
      "color:" + TEXT_PRIMARY,
    ].join(";");
    applyTextStyle(avatar, 13, 800);
    const message = createDiv();
    message.innerHTML =
      '<div style="color:' +
      TEXT_PRIMARY +
      ';font-weight:700;margin-bottom:3px">' +
      author +
      '</div><div style="color:' +
      TEXT_SECONDARY +
      '">' +
      text +
      "</div>";
    applyTextStyle(message, 13, 500);
    row.appendChild(avatar);
    row.appendChild(message);
    body.appendChild(row);
  }

  const composer = createDiv();
  composer.textContent = "Add comment...";
  composer.style.cssText = [
    "height:44px",
    "border-radius:18px",
    "display:flex",
    "align-items:center",
    "padding:0 14px",
    "background:rgba(255,255,255,0.08)",
    "border:1px solid rgba(255,255,255,0.10)",
    "color:" + TEXT_MUTED,
  ].join(";");
  applyTextStyle(composer, 13, 600);
  body.appendChild(composer);
}

function renderSimulator(state: AppSimulatorState): void {
  if (state.wasDestroyed) {
    return;
  }

  const { root, stage, gameViewport } = state.elements;
  root.style.display = state.visible ? "block" : "none";
  setBoxStyle(stage, state);
  if (gameViewport) {
    setBoxStyle(gameViewport, state);
  }

  stage.replaceChildren();

  const top = scaledInset(state.device.safeArea.top, state.rect.scale) + Math.round(TOP_BAR_OFFSET * state.rect.scale);
  const back = createCircleButton(svgIcon("back"), "Back", () => {
    if (state.backHandle.isBackOverrideActive()) {
      state.backHandle.triggerBack();
    } else {
      state.backHandle.triggerLeave();
    }
  });
  back.style.left = Math.round(16 * state.rect.scale) + "px";
  back.style.top = top + "px";

  const leaderboard = createLeaderboardPill(state);
  leaderboard.style.top = top + "px";

  const hub = createHubPill(state);
  hub.style.top = top + "px";
  hub.style.right = Math.round(16 * state.rect.scale) + "px";

  stage.appendChild(back);
  stage.appendChild(leaderboard);
  stage.appendChild(hub);

  const sheet = createSheet(state);
  if (sheet) {
    stage.appendChild(sheet);
  }

  if (state.options.log) {
    console.info("[oasiz/sdk] App simulator rendered.", {
      device: state.device.name,
      frame: state.frameEnabled,
      insets: getSimulatorInsets(state),
    });
  }
}

function installFrame(
  doc: Document,
  state: Pick<
    AppSimulatorState,
    "elements" | "frameEnabled" | "movedNodes" | "previousBodyStyle" | "previousDocumentElementStyle"
  >,
): void {
  if (!state.frameEnabled || !doc.body) {
    return;
  }

  const body = doc.body;
  const html = doc.documentElement;
  const viewport = state.elements.gameViewport;
  if (!viewport) {
    return;
  }

  html.style.cssText = [
    state.previousDocumentElementStyle ?? "",
    "width:100%",
    "height:100%",
    "background:" + BODY_BACKGROUND,
    "overflow:hidden",
  ].join(";");
  body.style.cssText = [
    state.previousBodyStyle ?? "",
    "width:100%",
    "height:100%",
    "margin:0",
    "background:" + BODY_BACKGROUND,
    "overflow:hidden",
  ].join(";");

  const candidates = Array.from(body.children).filter((node) =>
    shouldMoveIntoGameViewport(node, state.elements),
  );
  for (const node of candidates) {
    state.movedNodes.push(node);
    viewport.appendChild(node);
  }

  body.appendChild(viewport);
}

function shouldMoveIntoGameViewport(
  node: Element,
  elements: AppSimulatorElements,
): boolean {
  if (node === elements.root || node === elements.style || node === elements.gameViewport) {
    return false;
  }
  const tagName = node.tagName.toUpperCase();
  if (
    tagName === "SCRIPT" ||
    tagName === "STYLE" ||
    tagName === "LINK" ||
    tagName === "META" ||
    tagName === "NOSCRIPT"
  ) {
    return false;
  }
  return node.getAttribute("data-oasiz-app-simulator") !== "true";
}

function restoreFrame(doc: Document, state: AppSimulatorState): void {
  const body = doc.body;
  if (!body) {
    return;
  }

  for (const node of state.movedNodes) {
    body.appendChild(node);
  }
  state.movedNodes = [];

  state.elements.gameViewport?.remove();

  if (state.previousBodyStyle === null) {
    body.removeAttribute("style");
  } else {
    body.setAttribute("style", state.previousBodyStyle);
  }

  if (state.previousDocumentElementStyle === null) {
    doc.documentElement.removeAttribute("style");
  } else {
    doc.documentElement.setAttribute("style", state.previousDocumentElementStyle);
  }
}

function createElements(frameEnabled: boolean): AppSimulatorElements {
  const root = document.createElement("div");
  root.setAttribute("data-oasiz-app-simulator", "true");
  root.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:" + String(MAX_Z_INDEX),
    "pointer-events:none",
    "display:block",
    "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
  ].join(";");

  const stage = document.createElement("div");
  stage.setAttribute("data-oasiz-app-simulator", "stage");
  stage.style.cssText = [
    "position:absolute",
    "overflow:hidden",
    "pointer-events:none",
  ].join(";");
  root.appendChild(stage);

  const gameViewport = frameEnabled ? document.createElement("div") : null;
  if (gameViewport) {
    gameViewport.setAttribute("data-oasiz-app-simulator", "game-viewport");
    gameViewport.style.cssText = [
      "position:fixed",
      "z-index:0",
      "overflow:hidden",
      "background:#000",
      "border-radius:28px",
      "outline:1px solid rgba(255,255,255,0.28)",
      "box-shadow:0 28px 90px rgba(0,0,0,0.48),0 0 0 8px rgba(255,255,255,0.06),0 0 0 10px rgba(0,0,0,0.58)",
    ].join(";");
  }

  return {
    gameViewport,
    root,
    stage,
    style: createStyleElement(),
  };
}

function installResizeHandler(
  browserWindow: AppSimulatorWindow,
  state: AppSimulatorState,
): () => void {
  const resize = () => {
    state.rect = computeRect(browserWindow, state.device, state.frameEnabled);
    installBridge(state);
    renderSimulator(state);
  };
  browserWindow.addEventListener("resize", resize);
  browserWindow.addEventListener("orientationchange", resize);
  return () => {
    browserWindow.removeEventListener("resize", resize);
    browserWindow.removeEventListener("orientationchange", resize);
  };
}

export function enableAppSimulator(
  options: AppSimulatorOptions = {},
): AppSimulatorHandle {
  if (options.enabled === false) {
    return NOOP_HANDLE;
  }

  const browserWindow = getBrowserWindow();
  const doc = getDocument();
  if (!browserWindow || !doc?.body || !doc.documentElement) {
    warn("enableAppSimulator requires a browser document.");
    return NOOP_HANDLE;
  }

  browserWindow.__oasizAppSimulatorHandle__?.destroy();

  const orientation = options.orientation ?? "portrait";
  const device = resolveDevice(options.device, orientation);
  const frameEnabled = shouldFrame(options.frame ?? true, browserWindow, device);
  const elements = createElements(frameEnabled);
  const rect = computeRect(browserWindow, device, frameEnabled);
  const backHandle = enableBackButtonTesting({
    browserHistory: options.browserHistoryBack ?? true,
    keyboard: options.keyboardBack ?? true,
    log: options.log === true,
  });

  const state: AppSimulatorState = {
    backHandle,
    bridgeSnapshot: snapshotBridge(browserWindow),
    cleanupResize: () => {},
    counts: {
      comments: normalizeCount(options.comments, DEFAULT_COUNTS.comments),
      likes: normalizeCount(options.likes, DEFAULT_COUNTS.likes),
    },
    device,
    elements,
    frameEnabled,
    leaderboard: {
      score: normalizeCount(options.score, DEFAULT_SCORE),
      visible: options.leaderboardVisible ?? true,
    },
    movedNodes: [],
    options: {
      browserHistoryBack: options.browserHistoryBack ?? true,
      keyboardBack: options.keyboardBack ?? true,
      log: options.log === true,
      orientation,
      title: options.title ?? "Oasiz App Preview",
    },
    previousBodyStyle: doc.body.getAttribute("style"),
    previousDocumentElementStyle: doc.documentElement.getAttribute("style"),
    rect,
    sheet: null,
    visible: true,
    wasDestroyed: false,
    wasLiked: false,
  };

  if (doc.head) {
    doc.head.appendChild(elements.style);
  } else {
    doc.body.appendChild(elements.style);
  }
  installFrame(doc, state);
  doc.body.appendChild(elements.root);
  installBridge(state);
  state.cleanupResize = installResizeHandler(browserWindow, state);

  const handle: AppSimulatorHandle = {
    closeSheet: () => {
      state.sheet = null;
      renderSimulator(state);
    },
    destroy: () => {
      if (state.wasDestroyed) return;
      state.wasDestroyed = true;
      state.cleanupResize();
      state.backHandle.destroy();
      restoreBridge(browserWindow, state.bridgeSnapshot);
      delete browserWindow.__oasizAppSimulatorHandle__;
      elements.root.remove();
      elements.style.remove();
      restoreFrame(doc, state);
    },
    getViewportInsets: () => getSimulatorInsets(state),
    hide: () => {
      state.visible = false;
      renderSimulator(state);
    },
    isVisible: () => state.visible,
    openComments: () => {
      state.sheet = "comments";
      renderSimulator(state);
    },
    openLeaderboard: () => {
      state.sheet = "leaderboard";
      renderSimulator(state);
    },
    setCounts: (counts) => {
      state.counts.comments = normalizeCount(counts.comments, state.counts.comments);
      state.counts.likes = normalizeCount(counts.likes, state.counts.likes);
      renderSimulator(state);
    },
    setLeaderboardVisible: (visible) => {
      state.leaderboard.visible = visible;
      renderSimulator(state);
    },
    setLiked: (liked) => {
      if (state.wasLiked === liked) {
        return;
      }
      state.wasLiked = liked;
      state.counts.likes = Math.max(0, state.counts.likes + (liked ? 1 : -1));
      renderSimulator(state);
    },
    show: () => {
      state.visible = true;
      renderSimulator(state);
    },
    triggerBack: () => state.backHandle.triggerBack(),
    triggerLeave: () => state.backHandle.triggerLeave(),
  };

  browserWindow.__oasizAppSimulatorHandle__ = handle;
  renderSimulator(state);
  return handle;
}
