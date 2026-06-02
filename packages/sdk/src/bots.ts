import type {
  BotRequestOptions,
  BotRequestResult,
  PlatformBotDifficulty,
} from "./types.ts";

const BOT_DIFFICULTIES = new Set<PlatformBotDifficulty>([
  "easy",
  "medium",
  "hard",
]);

type BotsBridgeWindow = Window & {
  __oasizRequestBots?: (
    options: BotRequestOptions,
  ) => Promise<BotRequestResult | null>;
};

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
}

function getBridgeWindow(): BotsBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as BotsBridgeWindow;
}

function warn(message: string, value?: unknown): void {
  if (!isDevelopment()) {
    return;
  }
  if (arguments.length > 1) {
    console.warn("[oasiz/sdk] " + message, value);
  } else {
    console.warn("[oasiz/sdk] " + message);
  }
}

function isDifficulty(value: unknown): value is PlatformBotDifficulty {
  return (
    typeof value === "string" &&
    BOT_DIFFICULTIES.has(value as PlatformBotDifficulty)
  );
}

function normalizeBotOptions(
  options: BotRequestOptions = {},
): BotRequestOptions | null {
  const payload: BotRequestOptions = {};

  if (options.count !== undefined) {
    if (!Number.isInteger(options.count) || options.count < 1) {
      warn("requestBots expected count to be a positive integer:", options.count);
      return null;
    }
    payload.count = options.count;
  }

  if (options.difficulty !== undefined) {
    const difficulty = Array.isArray(options.difficulty)
      ? Array.from(new Set(options.difficulty))
      : options.difficulty;
    const difficulties = Array.isArray(difficulty) ? difficulty : [difficulty];
    if (!difficulties.every(isDifficulty)) {
      warn(
        "requestBots expected difficulty to be easy, medium, hard, or an array of those values:",
        options.difficulty,
      );
      return null;
    }
    payload.difficulty = difficulty as BotRequestOptions["difficulty"];
  }

  if (options.poolKey !== undefined) {
    if (typeof options.poolKey !== "string") {
      warn("requestBots expected poolKey to be a string:", options.poolKey);
      return null;
    }
    const poolKey = options.poolKey.trim();
    if (poolKey.length > 0) {
      payload.poolKey = poolKey;
    }
  }

  if (options.seed !== undefined) {
    if (typeof options.seed !== "string") {
      warn("requestBots expected seed to be a string:", options.seed);
      return null;
    }
    const seed = options.seed.trim();
    if (seed.length > 0) {
      payload.seed = seed;
    }
  }

  if (options.includeAppearance !== undefined) {
    if (typeof options.includeAppearance !== "boolean") {
      warn(
        "requestBots expected includeAppearance to be a boolean:",
        options.includeAppearance,
      );
      return null;
    }
    payload.includeAppearance = options.includeAppearance;
  }

  return payload;
}

/**
 * Request platform-managed bot profiles for the current game.
 *
 * The Oasiz host owns the bot catalog and optional per-game pools. The SDK
 * forwards options to `window.__oasizRequestBots(options)` and returns the
 * platform-selected roster, or `null` when the host bridge is unavailable.
 */
export async function requestBots(
  options: BotRequestOptions = {},
): Promise<BotRequestResult | null> {
  const payload = normalizeBotOptions(options);
  if (!payload) {
    return null;
  }

  const bridge = getBridgeWindow();
  if (typeof bridge?.__oasizRequestBots !== "function") {
    warn(
      "requestBots bridge is unavailable. This is expected in local development.",
    );
    return null;
  }

  try {
    const result = await bridge.__oasizRequestBots(payload);
    return result ?? null;
  } catch (error) {
    if (isDevelopment()) {
      console.error("[oasiz/sdk] requestBots failed:", error);
    }
    return null;
  }
}
