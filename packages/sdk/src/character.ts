import type { PlayerCharacter } from "./types.ts";
import { getSamplePlayerCharacter } from "./sample-character.ts";

const DEFAULT_SAMPLE_CHARACTER_URL =
  "https://api.oasiz.ai/api/sdk/sample-character";
const DEFAULT_SAMPLE_FETCH_TIMEOUT_MS = 1500;

type CharacterBridgeWindow = Window & {
  __oasizGetPlayerCharacter?: () => Promise<PlayerCharacter | null>;
};

export interface GetPlayerCharacterOptions {
  /**
   * Controls the SDK sample character returned when the Oasiz app bridge is
   * missing. `"auto"` returns the sample on localhost/file URLs only.
   */
  localFallback?: boolean | "auto";
  /**
   * Public endpoint used for the real platform-generated local sample atlas.
   */
  sampleCharacterUrl?: string;
  /**
   * Timeout for the public sample endpoint before falling back locally.
   */
  sampleFetchTimeoutMs?: number;
  /**
   * When true, a tiny generated atlas is used if the platform sample endpoint
   * is unavailable. Set false for strict platform-sample-only local testing.
   */
  generatedFallback?: boolean;
}

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
}

function getBridgeWindow(): CharacterBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as CharacterBridgeWindow;
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function shouldUseLocalFallback(
  bridge: CharacterBridgeWindow | undefined,
  localFallback: GetPlayerCharacterOptions["localFallback"],
): boolean {
  if (localFallback === true) {
    return true;
  }
  if (localFallback === false) {
    return false;
  }

  const location = bridge?.location;
  if (!location) {
    return false;
  }

  return location.protocol === "file:" || isLocalHostname(location.hostname);
}

function warnMissingBridge(methodName: string, usingFallback: boolean): void {
  if (isDevelopment()) {
    console.warn(
      "[oasiz/sdk] " +
        methodName +
        " bridge is unavailable. " +
        (usingFallback
          ? "Using the SDK sample character atlas for local development."
          : "This is expected in local development."),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextureAtlas(value: unknown): value is PlayerCharacter["textureAtlas"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.imageUrl === "string" &&
    typeof value.imageWidth === "number" &&
    Number.isFinite(value.imageWidth) &&
    typeof value.imageHeight === "number" &&
    Number.isFinite(value.imageHeight) &&
    Array.isArray(value.frames) &&
    Array.isArray(value.animations)
  );
}

function isPlayerCharacter(value: unknown): value is PlayerCharacter {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (typeof value.characterName === "string" || value.characterName === null) &&
    typeof value.baseCharacterId === "string" &&
    typeof value.compositionCode === "string" &&
    isTextureAtlas(value.textureAtlas) &&
    (value.editorTextureAtlas === null ||
      isTextureAtlas(value.editorTextureAtlas))
  );
}

function unwrapSampleCharacterResponse(payload: unknown): PlayerCharacter | null {
  if (isPlayerCharacter(payload)) {
    return payload;
  }
  if (isRecord(payload) && isPlayerCharacter(payload.character)) {
    return payload.character;
  }
  return null;
}

async function fetchPlatformSampleCharacter(
  options: GetPlayerCharacterOptions,
): Promise<PlayerCharacter | null> {
  if (typeof fetch !== "function") {
    return null;
  }

  const timeoutMs =
    options.sampleFetchTimeoutMs ?? DEFAULT_SAMPLE_FETCH_TIMEOUT_MS;
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  const timeout =
    controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

  try {
    const response = await fetch(
      options.sampleCharacterUrl ?? DEFAULT_SAMPLE_CHARACTER_URL,
      {
        signal: controller?.signal,
      },
    );
    if (!response.ok) {
      return null;
    }

    return unwrapSampleCharacterResponse(await response.json());
  } catch {
    return null;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Fetch the authenticated player's character, including a TexturePacker /
 * Phaser-style texture atlas describing the baked sprite image.
 *
 * Returns:
 *   - `null` when the user has no character composition yet, OR
 *   - a sample character atlas when the host bridge is unavailable on a local
 *     browser URL (`localhost` / `file://`), OR
 *   - `null` when the host bridge is unavailable and local fallback is disabled
 *
 * The host transparently caches and proxies to `GET /api/sdk/me/character`,
 * so calling this multiple times in a session is cheap. The returned
 * `imageUrl` is content-addressed (R2 key derives from the composition
 * hash), so games can safely cache the downloaded texture by `compositionCode`.
 *
 * Example (Phaser):
 *
 *   const character = await oasiz.getPlayerCharacter();
 *   if (!character) return;
 *   const atlas = character.textureAtlas;
 *   scene.load.image("player-tex", atlas.imageUrl);
 *   scene.load.atlas("player", atlas.imageUrl, {
 *     frames: Object.fromEntries(
 *       atlas.frames.map((f) => [f.name, { frame: { x: f.x, y: f.y, w: f.width, h: f.height } }]),
 *     ),
 *   });
 */
export async function getPlayerCharacter(
  options: GetPlayerCharacterOptions = {},
): Promise<PlayerCharacter | null> {
  const bridge = getBridgeWindow();
  if (typeof bridge?.__oasizGetPlayerCharacter !== "function") {
    const useLocalFallback = shouldUseLocalFallback(
      bridge,
      options.localFallback ?? "auto",
    );
    warnMissingBridge("getPlayerCharacter", useLocalFallback);
    if (!useLocalFallback) {
      return null;
    }

    const platformSample = await fetchPlatformSampleCharacter(options);
    if (platformSample) {
      return platformSample;
    }

    return options.generatedFallback === false
      ? null
      : getSamplePlayerCharacter();
  }

  try {
    const result = await bridge.__oasizGetPlayerCharacter();
    return result ?? null;
  } catch (error) {
    if (isDevelopment()) {
      console.error("[oasiz/sdk] getPlayerCharacter failed:", error);
    }
    return null;
  }
}
