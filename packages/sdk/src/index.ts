import { triggerHaptic } from "./haptics.ts";
import { enableLogOverlay } from "./log-overlay.ts";
import {
  getGameId,
  getPlayerAvatar,
  getPlayerName,
  getRoomCode,
  openInviteModal,
  shareRoomCode,
} from "./multiplayer.ts";
import { submitScore } from "./score.ts";
import { share } from "./share.ts";
import { flushGameState, loadGameState, saveGameState } from "./state.ts";
import { onPause, onResume } from "./lifecycle.ts";
import { getSafeAreaTop, setLeaderboardVisible } from "./layout.ts";
import { leaveGame, onBackButton, onLeaveGame } from "./navigation.ts";

export { triggerHaptic } from "./haptics.ts";
export { enableLogOverlay } from "./log-overlay.ts";
export {
  getGameId,
  getPlayerAvatar,
  getPlayerName,
  getRoomCode,
  openInviteModal,
  shareRoomCode,
} from "./multiplayer.ts";
export type { ShareRoomCodeOptions } from "./multiplayer.ts";
export { submitScore } from "./score.ts";
export { share } from "./share.ts";
export { flushGameState, loadGameState, saveGameState } from "./state.ts";
export { onPause, onResume } from "./lifecycle.ts";
export { getSafeAreaTop, setLeaderboardVisible } from "./layout.ts";
export { leaveGame, onBackButton, onLeaveGame } from "./navigation.ts";
export type { Unsubscribe } from "./lifecycle.ts";
export type {
  GameState,
  HapticType,
  LogOverlayEntry,
  LogOverlayHandle,
  LogOverlayLevel,
  LogOverlayOptions,
  ShareRequest,
} from "./types.ts";

export const oasiz = {
  submitScore,
  share,
  triggerHaptic,
  enableLogOverlay,
  loadGameState,
  saveGameState,
  flushGameState,
  shareRoomCode,
  openInviteModal,
  onPause,
  onResume,
  getSafeAreaTop,
  setLeaderboardVisible,
  onBackButton,
  onLeaveGame,
  leaveGame,
  get gameId(): string | undefined {
    return getGameId();
  },
  get roomCode(): string | undefined {
    return getRoomCode();
  },
  get playerName(): string | undefined {
    return getPlayerName();
  },
  get playerAvatar(): string | undefined {
    return getPlayerAvatar();
  },
  get safeAreaTop(): number {
    return getSafeAreaTop();
  },
};
