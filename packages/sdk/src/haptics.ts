import type { HapticType } from "./types.ts";

type HapticBridgeWindow = Window & {
  triggerHaptic?: (type: HapticType) => void;
};

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
}

function getBridgeWindow(): HapticBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as HapticBridgeWindow;
}

export function triggerHaptic(type: HapticType): void {
  const bridge = getBridgeWindow();

  if (typeof bridge?.triggerHaptic === "function") {
    bridge.triggerHaptic(type);
    return;
  }

  if (isDevelopment()) {
    console.warn(
      "[oasiz/sdk] triggerHaptic bridge is unavailable. This is expected in local development.",
    );
  }
}
