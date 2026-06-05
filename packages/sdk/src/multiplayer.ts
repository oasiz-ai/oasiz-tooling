import type {
  PlatformLobbyLaunchContext,
  PlatformLobbyLaunchPlayer,
} from "./types.ts";

type MultiplayerBridgeWindow = Window & {
  shareRoomCode?: (
    roomCode: string | null,
    options?: ShareRoomCodeOptions,
  ) => void;
  openInviteModal?: () => void;
  __GAME_ID__?: string;
  __OASIZ_LAUNCH_CONTEXT__?: unknown;
  __ROOM_CODE__?: string;
  __PLAYER_ID__?: string;
  __PLAYER_NAME__?: string;
  __PLAYER_AVATAR__?: string;
  __oasizGetLaunchContext?: () => unknown;
};

export interface ShareRoomCodeOptions {
  inviteOverride?: boolean;
}

function isDevelopment(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv !== "production";
}

function getBridgeWindow(): MultiplayerBridgeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window as MultiplayerBridgeWindow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function cloneJsonObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return { ...value };
  }
}

function normalizeLaunchPlayer(
  value: unknown,
): PlatformLobbyLaunchPlayer | null {
  if (!isRecord(value) || typeof value.memberId !== "string") {
    return null;
  }

  const displayName =
    typeof value.displayName === "string" && value.displayName.trim()
      ? value.displayName
      : "Player";
  const slotIndex =
    typeof value.slotIndex === "number" && Number.isFinite(value.slotIndex)
      ? Math.max(0, Math.floor(value.slotIndex))
      : 0;

  return {
    avatarUrl: stringOrNull(value.avatarUrl),
    botProfile: isRecord(value.botProfile)
      ? cloneJsonObject(value.botProfile)
      : null,
    connected: value.connected !== false,
    displayName,
    isBot: value.isBot === true,
    memberId: value.memberId,
    ready: value.ready === true,
    role: stringOrNull(value.role),
    slotIndex,
    teamId: stringOrNull(value.teamId),
    userId: stringOrNull(value.userId),
  };
}

function normalizeLaunchContext(
  value: unknown,
): PlatformLobbyLaunchContext | null {
  if (
    !isRecord(value) ||
    typeof value.gameId !== "string" ||
    typeof value.hostUserId !== "string" ||
    typeof value.modeId !== "string" ||
    typeof value.roomCode !== "string" ||
    typeof value.roomId !== "string" ||
    typeof value.sessionId !== "string"
  ) {
    return null;
  }

  const players = Array.isArray(value.players)
    ? value.players
        .map(normalizeLaunchPlayer)
        .filter((player): player is PlatformLobbyLaunchPlayer => !!player)
    : [];

  return {
    gameId: value.gameId,
    gameVersionId: stringOrNull(value.gameVersionId),
    hostUserId: value.hostUserId,
    localPlayerId: stringOrNull(value.localPlayerId) ?? undefined,
    modeId: value.modeId,
    players,
    roomCode: value.roomCode,
    roomId: value.roomId,
    sessionId: value.sessionId,
    settings: cloneJsonObject(value.settings),
    transport: cloneJsonObject(value.transport),
  };
}

function readRawLaunchContext(
  bridge: MultiplayerBridgeWindow | undefined,
): unknown {
  if (!bridge) {
    return null;
  }

  if (typeof bridge.__oasizGetLaunchContext === "function") {
    try {
      return bridge.__oasizGetLaunchContext();
    } catch (error) {
      if (isDevelopment()) {
        console.error("[oasiz/sdk] getLaunchContext bridge failed:", error);
      }
      return null;
    }
  }

  return bridge.__OASIZ_LAUNCH_CONTEXT__;
}

function localPlayerFromContext(
  context: PlatformLobbyLaunchContext | null,
  bridge?: MultiplayerBridgeWindow,
): PlatformLobbyLaunchPlayer | null {
  if (!context) {
    return null;
  }

  const localPlayerId = context.localPlayerId || bridge?.__PLAYER_ID__;
  if (!localPlayerId) {
    return null;
  }

  return (
    context.players.find((player) => player.userId === localPlayerId) ?? null
  );
}

/**
 * Notify the platform of the active multiplayer room so friends can join.
 * Pass `{ inviteOverride: true }` when the game wants to hide the platform
 * invite pill and own the invite UI itself.
 */
export function shareRoomCode(
  roomCode: string | null,
  options?: ShareRoomCodeOptions,
): void {
  const bridge = getBridgeWindow();

  if (typeof bridge?.shareRoomCode === "function") {
    bridge.shareRoomCode(roomCode, options);
    return;
  }

  if (isDevelopment()) {
    console.warn(
      "[oasiz/sdk] shareRoomCode bridge is unavailable. This is expected in local development.",
    );
  }
}

/**
 * Ask the platform to open the invite-friends modal for the current game room.
 * Only has effect when the platform has a room code (game has called shareRoomCode).
 * No-op when the bridge is unavailable (e.g. local development).
 */
export function openInviteModal(): void {
  const bridge = getBridgeWindow();
  if (typeof bridge?.openInviteModal === "function") {
    bridge.openInviteModal();
    return;
  }
  if (isDevelopment()) {
    console.warn(
      "[oasiz/sdk] openInviteModal bridge is unavailable. This is expected in local development.",
    );
  }
}

/**
 * Frozen platform-owned room payload injected when the host starts a room.
 *
 * Games should read this after launch for mode, settings, roster, room id/code,
 * session id, and transport config. Room creation, joining, ready state, and
 * start decisions belong to the platform lobby before the game iframe loads.
 */
export function getLaunchContext(): PlatformLobbyLaunchContext | null {
  return normalizeLaunchContext(readRawLaunchContext(getBridgeWindow()));
}

export function getLocalLaunchPlayer(): PlatformLobbyLaunchPlayer | null {
  const bridge = getBridgeWindow();
  return localPlayerFromContext(getLaunchContext(), bridge);
}

export function isLaunchHost(): boolean {
  const context = getLaunchContext();
  if (!context?.localPlayerId) {
    return false;
  }
  return context.localPlayerId === context.hostUserId;
}

export function getGameId(): string | undefined {
  const bridge = getBridgeWindow();
  return bridge?.__GAME_ID__ ?? getLaunchContext()?.gameId;
}

export function getRoomCode(): string | undefined {
  const bridge = getBridgeWindow();
  return bridge?.__ROOM_CODE__ ?? getLaunchContext()?.roomCode;
}

/**
 * Stable, unique, opaque identifier for the authenticated player, injected
 * by the platform. Safe to use as a primary key for save slots, matchmaking,
 * per-player analytics, or anywhere you need a reliable per-user key —
 * unlike `getPlayerName()` (mutable, not unique).
 *
 * Mirrors the backend's `playerId` field returned by `GET /api/sdk/me`
 * (= the Better Auth `user.id`). Returns `undefined` when the platform
 * has not injected an identity (e.g. unauthenticated preview).
 */
export function getPlayerId(): string | undefined {
  const bridge = getBridgeWindow();
  const context = getLaunchContext();
  return bridge?.__PLAYER_ID__ ?? context?.localPlayerId;
}

export function getPlayerName(): string | undefined {
  const bridge = getBridgeWindow();
  return bridge?.__PLAYER_NAME__ ?? getLocalLaunchPlayer()?.displayName;
}

export function getPlayerAvatar(): string | undefined {
  const bridge = getBridgeWindow();
  return bridge?.__PLAYER_AVATAR__ ?? getLocalLaunchPlayer()?.avatarUrl ?? undefined;
}
