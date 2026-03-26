type MultiplayerBridgeWindow = Window & {
  shareRoomCode?: (
    roomCode: string | null,
    options?: ShareRoomCodeOptions,
  ) => void;
  openInviteModal?: () => void;
  __GAME_ID__?: string;
  __ROOM_CODE__?: string;
  __PLAYER_NAME__?: string;
  __PLAYER_AVATAR__?: string;
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

export function getGameId(): string | undefined {
  const bridge = getBridgeWindow();
  return bridge?.__GAME_ID__;
}

export function getRoomCode(): string | undefined {
  const bridge = getBridgeWindow();
  return bridge?.__ROOM_CODE__;
}

export function getPlayerName(): string | undefined {
  const bridge = getBridgeWindow();
  return bridge?.__PLAYER_NAME__;
}

export function getPlayerAvatar(): string | undefined {
  const bridge = getBridgeWindow();
  return bridge?.__PLAYER_AVATAR__;
}
