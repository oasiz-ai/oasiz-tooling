import type { ScoreEditResult } from "./types.ts";

type ScoreEditPayload = { delta: number } | { score: number };

type ScoreEditBridgeWindow = Window & {
  __oasizEditScore?: (
    payload: ScoreEditPayload,
  ) => Promise<ScoreEditResult | null>;
};

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
}

function getBridgeWindow(): ScoreEditBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as ScoreEditBridgeWindow;
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

async function editScore(
  payload: ScoreEditPayload,
  methodName: string,
): Promise<ScoreEditResult | null> {
  const bridge = getBridgeWindow();
  if (typeof bridge?.__oasizEditScore !== "function") {
    warnMissingBridge(methodName);
    return null;
  }

  try {
    const result = await bridge.__oasizEditScore(payload);
    return result ?? null;
  } catch (error) {
    if (isDevelopment()) {
      console.error("[oasiz/sdk] " + methodName + " failed:", error);
    }
    return null;
  }
}

/**
 * Add (or subtract) `delta` from the player's current score for this game.
 * The new score is clamped to >= 0 server-side.
 *
 * Unlike `submitScore()` (which is high-water and only ever raises the
 * score), this endpoint always overwrites the row. Use it for game models
 * where the leaderboard tracks an accumulator, balance, or persistent state
 * instead of a single best-run value.
 *
 * Returns the resulting score values, or `null` when the bridge is
 * unavailable. The integer must be a non-zero integer (positive or negative).
 */
export async function addScore(
  delta: number,
): Promise<ScoreEditResult | null> {
  if (!Number.isInteger(delta)) {
    if (isDevelopment()) {
      console.warn("[oasiz/sdk] addScore expected an integer:", delta);
    }
    return null;
  }
  if (delta === 0) {
    return null;
  }
  return editScore({ delta }, "addScore");
}

/**
 * Force the player's score to an absolute value (clamped to >= 0).
 *
 * Same overwrite semantics as `addScore`. Use when the game has computed
 * the authoritative score locally (e.g. after offline play) and wants to
 * sync it back to the leaderboard.
 */
export async function setScore(
  score: number,
): Promise<ScoreEditResult | null> {
  if (!Number.isInteger(score) || score < 0) {
    if (isDevelopment()) {
      console.warn(
        "[oasiz/sdk] setScore expected a non-negative integer:",
        score,
      );
    }
    return null;
  }
  return editScore({ score }, "setScore");
}
