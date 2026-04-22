import type { PlayerCharacter } from "./types.ts";

type CharacterBridgeWindow = Window & {
  __oasizGetPlayerCharacter?: () => Promise<PlayerCharacter | null>;
};

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

function warnMissingBridge(methodName: string): void {
  if (isDevelopment()) {
    console.warn(
      "[oasiz/sdk] " +
        methodName +
        " bridge is unavailable. This is expected in local development.",
    );
  }
}

/**
 * Fetch the authenticated player's character, including a TexturePacker /
 * Phaser-style texture atlas describing the baked sprite image.
 *
 * Returns:
 *   - `null` when the user has no character composition yet, OR
 *   - `null` when the host bridge is unavailable (local dev / unauthenticated)
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
export async function getPlayerCharacter(): Promise<PlayerCharacter | null> {
  const bridge = getBridgeWindow();
  if (typeof bridge?.__oasizGetPlayerCharacter !== "function") {
    warnMissingBridge("getPlayerCharacter");
    return null;
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
