import type {
  LogOverlayEntry,
  LogOverlayHandle,
  LogOverlayLevel,
  LogOverlayOptions,
} from "./types.ts";

type ConsoleMethodName = "debug" | "log" | "info" | "warn" | "error";

type ConsoleMethod = (...args: unknown[]) => void;

type ConsoleSnapshot = Record<ConsoleMethodName, ConsoleMethod>;

interface OverlayElements {
  body: HTMLDivElement;
  clearButton: HTMLButtonElement;
  collapseButton: HTMLButtonElement;
  emptyState: HTMLDivElement;
  entries: HTMLDivElement;
  controls: HTMLDivElement;
  dragZone: HTMLDivElement;
  panel: HTMLDivElement;
  root: HTMLDivElement;
  toggleButton: HTMLButtonElement;
}

interface LogOverlayController {
  clear: () => void;
  destroy: () => void;
  ensureMounted: () => void;
  hide: () => void;
  isVisible: () => boolean;
  retain: () => void;
  show: () => void;
}

interface LogOverlayState {
  domReadyHandler?: () => void;
  dragMoved: boolean;
  dragStartPoint: { x: number; y: number } | null;
  entries: LogOverlayEntry[];
  expanded: boolean;
  isDragging: boolean;
  isResizing: boolean;
  lastDragPoint: { x: number; y: number } | null;
  maxEntries: number;
  nextEntryId: number;
  originalConsole: ConsoleSnapshot;
  panelSize: { height: number; width: number } | null;
  position: { x: number; y: number } | null;
  refCount: number;
  removeDragListeners: (() => void) | null;
  removeResizeListeners: (() => void) | null;
  resizeStartPoint: { x: number; y: number } | null;
  resizeStartSize: { height: number; width: number } | null;
  resizeHandler?: () => void;
  suppressToggleClickUntil: number;
  title: string;
  unreadCount: number;
  ui: OverlayElements | null;
}

type LogOverlayWindow = Window & {
  __oasizLogOverlayController__?: LogOverlayController;
  __oasizLogOverlayState__?: LogOverlayState;
};

const CONSOLE_METHODS: ConsoleMethodName[] = [
  "debug",
  "log",
  "info",
  "warn",
  "error",
];

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TITLE = "SDK Logs";
const OVERLAY_MARGIN = 12;
const DEFAULT_COLLAPSED_WIDTH = 156;
const DEFAULT_COLLAPSED_HEIGHT = 52;
const DEFAULT_EXPANDED_WIDTH = 565;
const DEFAULT_EXPANDED_HEIGHT = 372;
const DRAG_THRESHOLD_PX = 6;
const MIN_EXPANDED_WIDTH = 160;
const MIN_EXPANDED_HEIGHT = 110;
const RESIZE_HOTSPOT_PX = 28;
const TOP_DRAG_ZONE_PX = 44;

const NOOP_HANDLE: LogOverlayHandle = {
  clear() {},
  destroy() {},
  hide() {},
  isVisible() {
    return false;
  },
  show() {},
};

function getBrowserWindow(): LogOverlayWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as LogOverlayWindow;
}

function getDocument(): Document | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  return document;
}

function clampMaxEntries(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_ENTRIES;
  }
  return Math.max(10, Math.floor(value as number));
}

function createConsoleSnapshot(): ConsoleSnapshot {
  const fallback = console.log.bind(console);

  return {
    debug:
      typeof console.debug === "function" ? console.debug.bind(console) : fallback,
    log: fallback,
    info: typeof console.info === "function" ? console.info.bind(console) : fallback,
    warn: typeof console.warn === "function" ? console.warn.bind(console) : fallback,
    error:
      typeof console.error === "function" ? console.error.bind(console) : fallback,
  };
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return "[" + hours + ":" + minutes + ":" + seconds + "." + milliseconds + "]";
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(
      value,
      (_key, candidate) => {
        if (typeof candidate === "bigint") {
          return candidate.toString() + "n";
        }

        if (typeof candidate === "object" && candidate !== null) {
          if (seen.has(candidate)) {
            return "[Circular]";
          }
          seen.add(candidate);
        }

        return candidate;
      },
      2,
    ) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatArg(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    if (value.stack) {
      return value.stack;
    }
    return value.name + ": " + value.message;
  }

  if (typeof value === "undefined") {
    return "undefined";
  }

  if (typeof value === "function") {
    return "[Function " + (value.name || "anonymous") + "]";
  }

  return safeStringify(value);
}

function formatEntryMessage(args: unknown[]): string {
  const message = args.map(formatArg).join(" ");
  if (message.length <= 4000) {
    return message;
  }
  return message.slice(0, 3997) + "...";
}

function createEntry(level: LogOverlayLevel, args: unknown[], id: number): LogOverlayEntry {
  return {
    id,
    level,
    message: formatEntryMessage(args),
    timestamp: Date.now(),
  };
}

function createButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText = [
    "appearance:none",
    "border:1px solid rgba(255,255,255,0.18)",
    "background:rgba(255,255,255,0.06)",
    "color:#f8fafc",
    "border-radius:999px",
    "padding:6px 10px",
    "font:600 12px/1.1 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace",
    "cursor:pointer",
  ].join(";");
  return button;
}

function getLevelAccent(level: LogOverlayLevel): {
  lineBackground: string;
} {
  if (level === "error") {
    return {
      lineBackground: "rgba(255, 109, 122, 0.08)",
    };
  }
  if (level === "warn") {
    return {
      lineBackground: "rgba(255, 196, 94, 0.07)",
    };
  }
  if (level === "info") {
    return {
      lineBackground: "rgba(82, 187, 255, 0.07)",
    };
  }
  if (level === "debug") {
    return {
      lineBackground: "rgba(166, 137, 255, 0.07)",
    };
  }
  return {
    lineBackground: "rgba(117, 235, 191, 0.06)",
  };
}

function getViewportSize(): { height: number; width: number } {
  const browserWindow = getBrowserWindow();
  return {
    width: Math.max(320, browserWindow?.innerWidth ?? 1280),
    height: Math.max(240, browserWindow?.innerHeight ?? 720),
  };
}

function clampPanelSize(size: { height: number; width: number }): {
  height: number;
  width: number;
} {
  const viewport = getViewportSize();
  const maxWidth = Math.max(MIN_EXPANDED_WIDTH, viewport.width - OVERLAY_MARGIN * 2);
  const maxHeight = Math.max(
    MIN_EXPANDED_HEIGHT,
    viewport.height - OVERLAY_MARGIN * 2,
  );

  return {
    width: Math.min(maxWidth, Math.max(MIN_EXPANDED_WIDTH, size.width)),
    height: Math.min(maxHeight, Math.max(MIN_EXPANDED_HEIGHT, size.height)),
  };
}

function getOverlaySize(state: LogOverlayState): { height: number; width: number } {
  if (state.expanded && state.panelSize) {
    return state.panelSize;
  }

  const rect =
    state.ui?.root &&
    typeof state.ui.root.getBoundingClientRect === "function"
      ? state.ui.root.getBoundingClientRect()
      : null;
  if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
    return {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
  }

  return state.expanded
    ? clampPanelSize({
        width: DEFAULT_EXPANDED_WIDTH,
        height: DEFAULT_EXPANDED_HEIGHT,
      })
    : { width: DEFAULT_COLLAPSED_WIDTH, height: DEFAULT_COLLAPSED_HEIGHT };
}

function applyPanelSize(state: LogOverlayState): void {
  if (!state.ui) {
    return;
  }

  if (!state.expanded) {
    state.ui.root.style.width = "auto";
    state.ui.panel.style.width = "min(565px, calc(100vw - 24px))";
    state.ui.panel.style.height = "auto";
    state.ui.entries.style.maxHeight = "min(36vh, 280px)";
    return;
  }

  if (!state.panelSize) {
    state.ui.root.style.width = "min(565px, calc(100vw - 24px))";
    state.ui.panel.style.width = "min(565px, calc(100vw - 24px))";
    state.ui.panel.style.height = "auto";
    state.ui.entries.style.maxHeight = "min(36vh, 280px)";
    return;
  }

  const nextSize = clampPanelSize(
    state.panelSize,
  );
  state.panelSize = nextSize;
  state.ui.root.style.width = nextSize.width + "px";
  state.ui.panel.style.width = "100%";
  state.ui.panel.style.height = nextSize.height + "px";
  state.ui.entries.style.maxHeight = Math.max(72, nextSize.height - 88) + "px";
}

function clampPosition(
  point: { x: number; y: number },
  state: LogOverlayState,
): { x: number; y: number } {
  const viewport = getViewportSize();
  const size = getOverlaySize(state);
  const maxX = Math.max(OVERLAY_MARGIN, viewport.width - size.width - OVERLAY_MARGIN);
  const maxY = Math.max(
    OVERLAY_MARGIN,
    viewport.height - size.height - OVERLAY_MARGIN,
  );

  return {
    x: Math.min(maxX, Math.max(OVERLAY_MARGIN, point.x)),
    y: Math.min(maxY, Math.max(OVERLAY_MARGIN, point.y)),
  };
}

function applyOverlayPosition(state: LogOverlayState): void {
  if (!state.ui) {
    return;
  }

  if (!state.position) {
    const viewport = getViewportSize();
    const size = getOverlaySize(state);
    state.position = clampPosition(
      {
        x: viewport.width - size.width - OVERLAY_MARGIN,
        y: viewport.height - size.height - OVERLAY_MARGIN,
      },
      state,
    );
  } else {
    state.position = clampPosition(state.position, state);
  }

  state.ui.root.style.left = state.position.x + "px";
  state.ui.root.style.top = state.position.y + "px";
}

function getPointFromMouseEvent(event: MouseEvent): { x: number; y: number } {
  return { x: event.clientX, y: event.clientY };
}

function getPointFromTouchEvent(event: TouchEvent): { x: number; y: number } | null {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) {
    return null;
  }
  return { x: touch.clientX, y: touch.clientY };
}

function stopDragging(state: LogOverlayState): void {
  if (state.isDragging || state.isResizing) {
    state.suppressToggleClickUntil = Date.now() + 180;
  }
  state.isDragging = false;
  state.dragStartPoint = null;
  state.lastDragPoint = null;
  state.removeDragListeners?.();
  state.removeDragListeners = null;
  if (state.ui) {
    state.ui.panel.style.cursor = "default";
    state.ui.dragZone.style.cursor = "grab";
    state.ui.toggleButton.style.cursor = "grab";
  }
}

function stopResizing(state: LogOverlayState): void {
  if (state.isResizing) {
    state.suppressToggleClickUntil = Date.now() + 180;
  }
  state.isResizing = false;
  state.resizeStartPoint = null;
  state.resizeStartSize = null;
  state.removeResizeListeners?.();
  state.removeResizeListeners = null;
}

function beginDragTracking(
  state: LogOverlayState,
  startPoint: { x: number; y: number },
): void {
  const doc = getDocument();
  if (!doc) {
    return;
  }

  stopResizing(state);
  stopDragging(state);
  state.dragMoved = false;
  state.dragStartPoint = startPoint;
  state.lastDragPoint = startPoint;

  const handlePointerMove = (nextPoint: { x: number; y: number } | null) => {
    if (!state.dragStartPoint || !state.lastDragPoint || !nextPoint) {
      return;
    }

    if (!state.isDragging) {
      const deltaFromStartX = nextPoint.x - state.dragStartPoint.x;
      const deltaFromStartY = nextPoint.y - state.dragStartPoint.y;
      const distance = Math.sqrt(
        deltaFromStartX * deltaFromStartX + deltaFromStartY * deltaFromStartY,
      );
      if (distance < DRAG_THRESHOLD_PX) {
        return;
      }
      state.isDragging = true;
      state.dragMoved = true;
      if (state.ui) {
        state.ui.panel.style.cursor = "grabbing";
        state.ui.dragZone.style.cursor = "grabbing";
        state.ui.toggleButton.style.cursor = "grabbing";
      }
    }

    const currentPosition = state.position ?? { x: OVERLAY_MARGIN, y: OVERLAY_MARGIN };
    state.position = clampPosition(
      {
        x: currentPosition.x + (nextPoint.x - state.lastDragPoint.x),
        y: currentPosition.y + (nextPoint.y - state.lastDragPoint.y),
      },
      state,
    );
    state.lastDragPoint = nextPoint;
    applyOverlayPosition(state);
  };

  const handleMouseMove = (event: MouseEvent) => {
    handlePointerMove(getPointFromMouseEvent(event));
  };
  const handleTouchMove = (event: TouchEvent) => {
    handlePointerMove(getPointFromTouchEvent(event));
  };
  const handleMouseUp = () => {
    stopDragging(state);
  };
  const handleTouchEnd = () => {
    stopDragging(state);
  };

  doc.addEventListener("mousemove", handleMouseMove);
  doc.addEventListener("mouseup", handleMouseUp);
  doc.addEventListener("touchmove", handleTouchMove, { passive: true });
  doc.addEventListener("touchend", handleTouchEnd);
  doc.addEventListener("touchcancel", handleTouchEnd);

  state.removeDragListeners = () => {
    doc.removeEventListener("mousemove", handleMouseMove);
    doc.removeEventListener("mouseup", handleMouseUp);
    doc.removeEventListener("touchmove", handleTouchMove);
    doc.removeEventListener("touchend", handleTouchEnd);
    doc.removeEventListener("touchcancel", handleTouchEnd);
  };
}

function startResizing(
  state: LogOverlayState,
  startPoint: { x: number; y: number },
): void {
  const doc = getDocument();
  if (!doc) {
    return;
  }

  stopDragging(state);
  stopResizing(state);
  state.isResizing = true;
  state.resizeStartPoint = startPoint;
  state.resizeStartSize =
    state.panelSize ?? clampPanelSize({ width: DEFAULT_EXPANDED_WIDTH, height: DEFAULT_EXPANDED_HEIGHT });

  const handleResizeMove = (nextPoint: { x: number; y: number } | null) => {
    if (
      !state.isResizing ||
      !state.resizeStartPoint ||
      !state.resizeStartSize ||
      !nextPoint
    ) {
      return;
    }

    state.panelSize = clampPanelSize({
      width: state.resizeStartSize.width + (nextPoint.x - state.resizeStartPoint.x),
      height:
        state.resizeStartSize.height + (nextPoint.y - state.resizeStartPoint.y),
    });
    applyPanelSize(state);
    applyOverlayPosition(state);
  };

  const handleMouseMove = (event: MouseEvent) => {
    handleResizeMove(getPointFromMouseEvent(event));
  };
  const handleTouchMove = (event: TouchEvent) => {
    handleResizeMove(getPointFromTouchEvent(event));
  };
  const handleFinish = () => {
    stopResizing(state);
  };

  doc.addEventListener("mousemove", handleMouseMove);
  doc.addEventListener("mouseup", handleFinish);
  doc.addEventListener("touchmove", handleTouchMove, { passive: true });
  doc.addEventListener("touchend", handleFinish);
  doc.addEventListener("touchcancel", handleFinish);

  state.removeResizeListeners = () => {
    doc.removeEventListener("mousemove", handleMouseMove);
    doc.removeEventListener("mouseup", handleFinish);
    doc.removeEventListener("touchmove", handleTouchMove);
    doc.removeEventListener("touchend", handleFinish);
    doc.removeEventListener("touchcancel", handleFinish);
  };
}

function isInBottomRightResizeZone(
  element: HTMLElement,
  point: { x: number; y: number },
): boolean {
  const rect = element.getBoundingClientRect();
  return (
    point.x >= rect.right - RESIZE_HOTSPOT_PX &&
    point.x <= rect.right &&
    point.y >= rect.bottom - RESIZE_HOTSPOT_PX &&
    point.y <= rect.bottom
  );
}

function canStartDragFromTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  if (
    target.closest("button") ||
    target.closest("a") ||
    target.closest("input") ||
    target.closest("textarea") ||
    target.closest("select")
  ) {
    return false;
  }

  return true;
}

function isInTopDragZone(
  element: HTMLElement,
  point: { x: number; y: number },
  zoneHeight: number,
): boolean {
  const rect = element.getBoundingClientRect();
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.top + zoneHeight
  );
}

function attachDragStartListeners(
  element: HTMLElement,
  state: LogOverlayState,
  options: { allowInteractiveTarget?: boolean; topZoneHeight?: number } = {},
): void {
  element.addEventListener("mousedown", (event) => {
    if (!options.allowInteractiveTarget && !canStartDragFromTarget(event.target)) {
      return;
    }
    const point = getPointFromMouseEvent(event);
    if (
      typeof options.topZoneHeight === "number" &&
      !isInTopDragZone(element, point, options.topZoneHeight)
    ) {
      return;
    }
    beginDragTracking(state, point);
  });

  element.addEventListener("touchstart", (event) => {
    if (!options.allowInteractiveTarget && !canStartDragFromTarget(event.target)) {
      return;
    }
    const point = getPointFromTouchEvent(event);
    if (!point) {
      return;
    }
    if (
      typeof options.topZoneHeight === "number" &&
      !isInTopDragZone(element, point, options.topZoneHeight)
    ) {
      return;
    }
    beginDragTracking(state, point);
  });
}

function attachCollapsedToggleListeners(
  element: HTMLButtonElement,
  state: LogOverlayState,
): void {
  const startToggleInteraction = (startPoint: { x: number; y: number }) => {
    const doc = getDocument();
    if (!doc) {
      return;
    }

    beginDragTracking(state, startPoint);

    const finishInteraction = () => {
      releaseListeners();
      if (state.dragMoved || Date.now() < state.suppressToggleClickUntil) {
        return;
      }
      state.expanded = true;
      state.unreadCount = 0;
      renderOverlay(state);
    };

    const releaseListeners = () => {
      doc.removeEventListener("mouseup", finishInteraction);
      doc.removeEventListener("touchend", finishInteraction);
      doc.removeEventListener("touchcancel", finishInteraction);
    };

    doc.addEventListener("mouseup", finishInteraction);
    doc.addEventListener("touchend", finishInteraction);
    doc.addEventListener("touchcancel", finishInteraction);
  };

  element.addEventListener("mousedown", (event) => {
    event.preventDefault();
    startToggleInteraction(getPointFromMouseEvent(event));
  });

  element.addEventListener("touchstart", (event) => {
    const point = getPointFromTouchEvent(event);
    if (!point) {
      return;
    }
    event.preventDefault();
    startToggleInteraction(point);
  });
}

function attachPanelResizeListeners(
  element: HTMLDivElement,
  state: LogOverlayState,
): void {
  element.addEventListener("mousedown", (event) => {
    if (!state.expanded || !canStartDragFromTarget(event.target)) {
      return;
    }
    const point = getPointFromMouseEvent(event);
    if (!isInBottomRightResizeZone(element, point)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startResizing(state, point);
  });

  element.addEventListener("touchstart", (event) => {
    if (!state.expanded || !canStartDragFromTarget(event.target)) {
      return;
    }
    const point = getPointFromTouchEvent(event);
    if (!point || !isInBottomRightResizeZone(element, point)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startResizing(state, point);
  });
}

function createOverlayUi(state: LogOverlayState): OverlayElements {
  const root = document.createElement("div");
  root.style.cssText = [
    "position:fixed",
    "left:12px",
    "top:12px",
    "z-index:2147483647",
    "display:flex",
    "flex-direction:column",
    "align-items:stretch",
    "gap:8px",
    "width:min(565px, calc(100vw - 24px))",
    "pointer-events:none",
  ].join(";");

  const toggleButton = createButton("Logs");
  toggleButton.style.pointerEvents = "auto";
  toggleButton.style.alignSelf = "flex-end";
  toggleButton.style.display = "inline-flex";
  toggleButton.style.alignItems = "center";
  toggleButton.style.justifyContent = "center";
  toggleButton.style.minHeight = "40px";
  toggleButton.style.minWidth = "76px";
  toggleButton.style.padding = "8px 14px";
  toggleButton.style.textAlign = "center";
  toggleButton.style.border = "1px solid rgba(122, 212, 255, 0.22)";
  toggleButton.style.background =
    "linear-gradient(180deg, rgba(13,31,54,0.98), rgba(8,19,37,0.98))";
  toggleButton.style.boxShadow = "0 18px 40px rgba(4,12,24,0.34)";
  toggleButton.style.cursor = "grab";
  toggleButton.style.touchAction = "none";

  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:relative",
    "display:flex",
    "flex-direction:column",
    "width:min(565px, calc(100vw - 24px))",
    "max-height:min(48vh, 372px)",
    "border-radius:18px",
    "border:1px solid rgba(116,167,255,0.16)",
    "background:linear-gradient(180deg, rgba(9,19,37,0.98), rgba(5,12,24,0.98))",
    "box-shadow:0 28px 64px rgba(2,8,18,0.46)",
    "backdrop-filter:blur(16px)",
    "overflow:hidden",
    "cursor:default",
    "pointer-events:auto",
  ].join(";");

  const dragZone = document.createElement("div");
  dragZone.style.cssText = [
    "position:absolute",
    "top:0",
    "left:0",
    "right:0",
    "height:" + String(TOP_DRAG_ZONE_PX) + "px",
    "z-index:1",
    "cursor:grab",
    "background:transparent",
    "pointer-events:auto",
  ].join(";");

  const controls = document.createElement("div");
  controls.style.cssText = [
    "position:absolute",
    "top:22px",
    "right:22px",
    "z-index:2",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "pointer-events:auto",
  ].join(";");

  const clearButton = createButton("Clear");
  clearButton.style.background = "rgba(255,255,255,0.1)";
  clearButton.style.border = "1px solid rgba(255,255,255,0.16)";
  clearButton.style.color = "#eef6ff";
  clearButton.style.minHeight = "30px";
  clearButton.style.padding = "4px 9px";
  clearButton.style.fontSize = "11px";
  clearButton.style.backdropFilter = "blur(8px)";

  const collapseButton = createButton("Hide");
  collapseButton.style.background = "rgba(113, 171, 255, 0.12)";
  collapseButton.style.border = "1px solid rgba(113, 171, 255, 0.2)";
  collapseButton.style.color = "#d9ebff";
  collapseButton.style.minHeight = "30px";
  collapseButton.style.padding = "4px 9px";
  collapseButton.style.fontSize = "11px";
  collapseButton.style.backdropFilter = "blur(8px)";

  const body = document.createElement("div");
  body.style.cssText = [
    "position:relative",
    "display:flex",
    "flex-direction:column",
    "padding:12px",
    "background:linear-gradient(180deg, rgba(4,10,20,0.88), rgba(3,8,18,0.98))",
    "flex:1 1 auto",
    "min-height:0",
  ].join(";");

  const entries = document.createElement("div");
  entries.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:0",
    "overflow:auto",
    "flex:1 1 auto",
    "min-height:96px",
    "max-height:min(36vh, 280px)",
    "padding:0",
    "border:1px solid rgba(115,153,212,0.14)",
    "border-radius:12px",
    "background:rgba(4,10,20,0.82)",
  ].join(";");

  const emptyState = document.createElement("div");
  emptyState.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "flex:1 1 auto",
    "min-height:96px",
    "color:rgba(204,222,250,0.6)",
    "font:500 12px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace",
    "text-align:center",
    "padding:18px",
  ].join(";");
  emptyState.textContent = "Console output will appear here.";

  collapseButton.addEventListener("click", (event) => {
    event.stopPropagation();
    state.expanded = false;
    renderOverlay(state);
  });

  clearButton.addEventListener("click", (event) => {
    event.stopPropagation();
    state.entries = [];
    state.unreadCount = 0;
    renderOverlay(state);
  });

  controls.appendChild(clearButton);
  controls.appendChild(collapseButton);

  entries.appendChild(emptyState);
  body.appendChild(entries);
  body.appendChild(controls);

  panel.appendChild(dragZone);
  panel.appendChild(body);

  attachDragStartListeners(dragZone, state);
  attachPanelResizeListeners(panel, state);
  attachCollapsedToggleListeners(toggleButton, state);

  root.appendChild(panel);
  root.appendChild(toggleButton);

  return {
    body,
    clearButton,
    collapseButton,
    controls,
    dragZone,
    emptyState,
    entries,
    panel,
    root,
    toggleButton,
  };
}

function renderOverlay(state: LogOverlayState): void {
  if (!state.ui) {
    return;
  }

  state.ui.panel.style.display = state.expanded ? "flex" : "none";
  state.ui.toggleButton.style.display = state.expanded ? "none" : "inline-flex";
  state.ui.toggleButton.textContent = "Logs";

  if (state.entries.length === 0) {
    state.ui.entries.style.display = "flex";
    state.ui.emptyState.style.display = "flex";
    state.ui.entries.replaceChildren(state.ui.emptyState);
    applyPanelSize(state);
    applyOverlayPosition(state);
    return;
  }

  state.ui.entries.style.display = "flex";
  state.ui.emptyState.style.display = "none";

  const nextChildren = state.entries.map((entry) => {
    const accent = getLevelAccent(entry.level);

    const row = document.createElement("div");
    row.style.cssText = [
      "display:flex",
      "align-items:flex-start",
      "gap:0",
      "padding:4px 12px",
      "background:" + accent.lineBackground,
    ].join(";");

    const line = document.createElement("div");
    line.textContent =
      formatTimestamp(entry.timestamp) +
      " " +
      entry.level.toUpperCase() +
      " " +
      entry.message;
    line.style.cssText = [
      "color:#ecf4ff",
      "font:500 12px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace",
      "white-space:pre-wrap",
      "word-break:break-word",
      "flex:1 1 auto",
    ].join(";");

    row.appendChild(line);

    return row;
  });

  state.ui.entries.replaceChildren(...nextChildren);
  state.ui.entries.scrollTop = state.ui.entries.scrollHeight;
  applyPanelSize(state);
  applyOverlayPosition(state);
}

function mountOverlay(state: LogOverlayState): void {
  const doc = getDocument();
  if (!doc?.body || state.ui) {
    return;
  }

  state.ui = createOverlayUi(state);
  doc.body.appendChild(state.ui.root);
  applyPanelSize(state);
  applyOverlayPosition(state);
  renderOverlay(state);
}

function enqueueEntry(state: LogOverlayState, level: LogOverlayLevel, args: unknown[]): void {
  state.entries.push(createEntry(level, args, state.nextEntryId));
  state.nextEntryId += 1;

  if (state.entries.length > state.maxEntries) {
    state.entries.splice(0, state.entries.length - state.maxEntries);
  }

  if (!state.expanded) {
    state.unreadCount += 1;
  }

  renderOverlay(state);
}

function restoreConsole(snapshot: ConsoleSnapshot): void {
  for (const method of CONSOLE_METHODS) {
    console[method] = snapshot[method];
  }
}

function patchConsole(state: LogOverlayState): void {
  for (const method of CONSOLE_METHODS) {
    const original = state.originalConsole[method];
    console[method] = (...args: unknown[]) => {
      enqueueEntry(state, method, args);
      original(...args);
    };
  }
}

function cleanupOverlay(browserWindow: LogOverlayWindow, state: LogOverlayState): void {
  restoreConsole(state.originalConsole);
  stopResizing(state);
  stopDragging(state);

  if (state.domReadyHandler) {
    getDocument()?.removeEventListener("DOMContentLoaded", state.domReadyHandler);
    state.domReadyHandler = undefined;
  }

  if (state.resizeHandler && typeof browserWindow.removeEventListener === "function") {
    browserWindow.removeEventListener("resize", state.resizeHandler);
    state.resizeHandler = undefined;
  }

  state.ui?.root.remove();
  state.ui = null;

  delete browserWindow.__oasizLogOverlayController__;
  delete browserWindow.__oasizLogOverlayState__;
}

function createController(
  browserWindow: LogOverlayWindow,
  state: LogOverlayState,
): LogOverlayController {
  return {
    retain() {
      state.refCount += 1;
      this.ensureMounted();
    },
    ensureMounted() {
      const doc = getDocument();
      if (!doc) {
        return;
      }

      if (doc.body) {
        mountOverlay(state);
        applyOverlayPosition(state);
        return;
      }

      if (!state.domReadyHandler) {
        state.domReadyHandler = () => {
          mountOverlay(state);
          state.domReadyHandler = undefined;
        };
        doc.addEventListener("DOMContentLoaded", state.domReadyHandler, {
          once: true,
        });
      }
    },
    clear() {
      state.entries = [];
      state.unreadCount = 0;
      renderOverlay(state);
    },
    show() {
      state.expanded = true;
      state.unreadCount = 0;
      renderOverlay(state);
    },
    hide() {
      state.expanded = false;
      renderOverlay(state);
    },
    isVisible() {
      return state.expanded;
    },
    destroy() {
      state.refCount = Math.max(0, state.refCount - 1);
      if (state.refCount === 0) {
        cleanupOverlay(browserWindow, state);
      }
    },
  };
}

export function enableLogOverlay(options: LogOverlayOptions = {}): LogOverlayHandle {
  if (options.enabled === false) {
    return NOOP_HANDLE;
  }

  const browserWindow = getBrowserWindow();
  const doc = getDocument();
  if (!browserWindow || !doc) {
    return NOOP_HANDLE;
  }

  const existingController = browserWindow.__oasizLogOverlayController__;
  const existingState = browserWindow.__oasizLogOverlayState__;
  if (existingController && existingState) {
    existingController.retain();
    if (typeof options.maxEntries === "number") {
      existingState.maxEntries = clampMaxEntries(options.maxEntries);
      if (existingState.entries.length > existingState.maxEntries) {
        existingState.entries.splice(
          0,
          existingState.entries.length - existingState.maxEntries,
        );
      }
    }
    if (typeof options.collapsed === "boolean") {
      existingState.expanded = !options.collapsed;
      applyPanelSize(existingState);
      if (existingState.expanded) {
        existingState.unreadCount = 0;
      }
    }
    if (typeof options.title === "string" && options.title.trim().length > 0) {
      existingState.title = options.title.trim();
    }
    existingController.ensureMounted();
    renderOverlay(existingState);
    return existingController;
  }

  const state: LogOverlayState = {
    dragMoved: false,
    dragStartPoint: null,
    entries: [],
    expanded: options.collapsed !== true,
    isDragging: false,
    isResizing: false,
    lastDragPoint: null,
    maxEntries: clampMaxEntries(options.maxEntries),
    nextEntryId: 1,
    originalConsole: createConsoleSnapshot(),
    panelSize: null,
    position: null,
    refCount: 1,
    removeDragListeners: null,
    removeResizeListeners: null,
    resizeStartPoint: null,
    resizeStartSize: null,
    suppressToggleClickUntil: 0,
    title:
      typeof options.title === "string" && options.title.trim().length > 0
        ? options.title.trim()
        : DEFAULT_TITLE,
    resizeHandler: undefined,
    ui: null,
    unreadCount: 0,
  };

  const controller = createController(browserWindow, state);
  browserWindow.__oasizLogOverlayState__ = state;
  browserWindow.__oasizLogOverlayController__ = controller;

  patchConsole(state);
  if (typeof browserWindow.addEventListener === "function") {
    state.resizeHandler = () => {
      applyOverlayPosition(state);
    };
    browserWindow.addEventListener("resize", state.resizeHandler);
  }
  controller.ensureMounted();

  return controller;
}
