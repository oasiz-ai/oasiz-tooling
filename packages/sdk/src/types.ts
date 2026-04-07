export type HapticType = "light" | "medium" | "heavy" | "success" | "error";

export type LogOverlayLevel = "debug" | "log" | "info" | "warn" | "error";

export interface LogOverlayEntry {
  id: number;
  level: LogOverlayLevel;
  message: string;
  timestamp: number;
}

export interface LogOverlayOptions {
  collapsed?: boolean;
  enabled?: boolean;
  maxEntries?: number;
  title?: string;
}

export interface LogOverlayHandle {
  clear: () => void;
  destroy: () => void;
  hide: () => void;
  isVisible: () => boolean;
  show: () => void;
}

export type GameState = Record<string, unknown>;

export interface ShareRequest {
  image?: string;
  score?: number;
  text?: string;
}
