type ScoreBridgeWindow = Window & {
  submitScore?: (score: number) => void;
};

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
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

function getBridgeWindow(): ScoreBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as ScoreBridgeWindow;
}

export function submitScore(score: number): void {
  if (!Number.isFinite(score)) {
    if (isDevelopment()) {
      console.warn("[oasiz/sdk] submitScore expected a finite number:", score);
    }
    return;
  }

  const bridge = getBridgeWindow();
  const normalizedScore = Math.max(0, Math.floor(score));

  if (typeof bridge?.submitScore === "function") {
    bridge.submitScore(normalizedScore);
    return;
  }

  warnMissingBridge("submitScore");
}
