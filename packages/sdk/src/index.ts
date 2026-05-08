import { getPlayerCharacter } from "./character.ts";
import { triggerHaptic } from "./haptics.ts";
import { enableLogOverlay } from "./log-overlay.ts";
import {
  getGameId,
  getPlayerAvatar,
  getPlayerId,
  getPlayerName,
  getRoomCode,
  openInviteModal,
  shareRoomCode,
} from "./multiplayer.ts";
import { submitScore } from "./score.ts";
import { addScore, setScore } from "./score-edit.ts";
import { share } from "./share.ts";
import { flushGameState, loadGameState, saveGameState } from "./state.ts";
import { onPause, onResume } from "./lifecycle.ts";
import { getSafeAreaTop, getViewportInsets, setLeaderboardVisible } from "./layout.ts";
import { leaveGame, onBackButton, onLeaveGame } from "./navigation.ts";

export { getPlayerCharacter } from "./character.ts";
export { triggerHaptic } from "./haptics.ts";
export { enableLogOverlay } from "./log-overlay.ts";
export {
  getGameId,
  getPlayerAvatar,
  getPlayerId,
  getPlayerName,
  getRoomCode,
  openInviteModal,
  shareRoomCode,
} from "./multiplayer.ts";
export type { ShareRoomCodeOptions } from "./multiplayer.ts";
export { submitScore } from "./score.ts";
export { addScore, setScore } from "./score-edit.ts";
export { share } from "./share.ts";
export { flushGameState, loadGameState, saveGameState } from "./state.ts";
export { onPause, onResume } from "./lifecycle.ts";
export { getSafeAreaTop, getViewportInsets, setLeaderboardVisible } from "./layout.ts";
export type {
  ViewportInsetEdges,
  ViewportInsets,
  ViewportInsetSide,
} from "./layout.ts";
export { leaveGame, onBackButton, onLeaveGame } from "./navigation.ts";
export type { Unsubscribe } from "./lifecycle.ts";
export type {
  FacingFrameMap,
  GameState,
  HapticType,
  LogOverlayEntry,
  LogOverlayHandle,
  LogOverlayLevel,
  LogOverlayOptions,
  PlayerCharacter,
  ScoreEditResult,
  ShareRequest,
  TextureAtlas,
  TextureAtlasAnimation,
  TextureAtlasFrame,
} from "./types.ts";

export const oasiz = {
  submitScore,
  addScore,
  setScore,
  getPlayerCharacter,
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
  getViewportInsets,
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
  get playerId(): string | undefined {
    return getPlayerId();
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
  get viewportInsets() {
    return getViewportInsets();
  },
};
