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

// ============================================================================
// Texture atlas / player character (mirrors GET /api/sdk/me/character)
// ============================================================================

/**
 * One frame in a texture atlas. Coordinates are in pixels, top-left origin
 * (matches HTML canvas / WebGL texture coordinates after Y-flip).
 */
export interface TextureAtlasFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Per-direction frame indexes inside an animation. `left` is either an
 * integer index or the literal string `"mirror"`, indicating the renderer
 * should mirror the right-facing frame instead of using a dedicated one.
 */
export interface FacingFrameMap {
  front: number;
  back: number;
  right: number;
  left: number | "mirror";
}

/**
 * One named animation in a texture atlas. `frames` is the playback-ordered
 * list of frame names; resolve each name against the parent atlas's
 * `frames` array to get pixel coordinates.
 */
export interface TextureAtlasAnimation {
  animationId: string;
  role: string | null;
  group: string | null;
  direction: string | null;
  frameRate: number;
  frames: string[];
  facingFrameMap: FacingFrameMap | null;
}

/**
 * TexturePacker / Phaser-style texture atlas describing a baked sprite
 * image. Drop-in compatible with Phaser via `addAtlas(key, img, atlas)`
 * after a tiny shape transform; usable directly in custom GL renderers.
 */
export interface TextureAtlas {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  frames: TextureAtlasFrame[];
  animations: TextureAtlasAnimation[];
}

/**
 * The authenticated player's character, returned by `getPlayerCharacter()`.
 * `editorTextureAtlas` is the higher-detail variant intended for character
 * previews / customizer UI and may be `null`.
 */
export interface PlayerCharacter {
  characterName: string | null;
  baseCharacterId: string;
  compositionCode: string;
  textureAtlas: TextureAtlas;
  editorTextureAtlas: TextureAtlas | null;
}

// ============================================================================
// Score edit (mirrors POST /api/sdk/games/:id/score/edit)
// ============================================================================

/**
 * Result of `addScore(delta)` / `setScore(score)`. Returns `null` when the
 * host bridge is unavailable (e.g. local development) or when the backend
 * refused the request; production code should treat `null` as "no change
 * was persisted, do not update local UI".
 */
export interface ScoreEditResult {
  playerId: string;
  previousScore: number;
  newScore: number;
  previousWeeklyScore: number;
  newWeeklyScore: number;
  normalizedScore: number | null;
}
