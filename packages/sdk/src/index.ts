import { getPlayerCharacter } from "./character.ts";
import { requestBots } from "./bots.ts";
import { triggerHaptic } from "./haptics.ts";
import {
  getJibbleAnimationId,
  JIBBLE_ANIMATION,
  JIBBLE_ANIMATION_IDS,
  JIBBLE_DIRECTIONS,
} from "./jibble.ts";
import { enableLogOverlay } from "./log-overlay.ts";
import {
  getGameId,
  getLaunchContext,
  getLocalLaunchPlayer,
  getPlayerAvatar,
  getPlayerId,
  getPlayerName,
  getRoomCode,
  isLaunchHost,
  openInviteModal,
  shareRoomCode,
} from "./multiplayer.ts";
import { submitScore } from "./score.ts";
import { addScore, setScore } from "./score-edit.ts";
import { share } from "./share.ts";
import { flushGameState, loadGameState, saveGameState } from "./state.ts";
import { onPause, onResume } from "./lifecycle.ts";
import { getSafeAreaTop, setLeaderboardVisible } from "./layout.ts";
import { leaveGame, onBackButton, onLeaveGame } from "./navigation.ts";
import {
  getSamplePlayerCharacter,
  getSampleTextureAtlas,
} from "./sample-character.ts";

export { getPlayerCharacter } from "./character.ts";
export type { GetPlayerCharacterOptions } from "./character.ts";
export { requestBots } from "./bots.ts";
export { triggerHaptic } from "./haptics.ts";
export {
  getJibbleAnimationId,
  JIBBLE_ANIMATION,
  JIBBLE_ANIMATION_IDS,
  JIBBLE_DIRECTIONS,
  normalizeJibbleDirection,
} from "./jibble.ts";
export type {
  JibbleAnimationAction,
  JibbleAnimationId,
  JibbleDirectionCode,
  JibbleFacingDirection,
} from "./jibble.ts";
export { enableLogOverlay } from "./log-overlay.ts";
export {
  getGameId,
  getLaunchContext,
  getLocalLaunchPlayer,
  getPlayerAvatar,
  getPlayerId,
  getPlayerName,
  getRoomCode,
  isLaunchHost,
  openInviteModal,
  shareRoomCode,
} from "./multiplayer.ts";
export type { ShareRoomCodeOptions } from "./multiplayer.ts";
export { submitScore } from "./score.ts";
export { addScore, setScore } from "./score-edit.ts";
export { share } from "./share.ts";
export { flushGameState, loadGameState, saveGameState } from "./state.ts";
export { onPause, onResume } from "./lifecycle.ts";
export { getSafeAreaTop, setLeaderboardVisible } from "./layout.ts";
export { leaveGame, onBackButton, onLeaveGame } from "./navigation.ts";
export {
  getSamplePlayerCharacter,
  getSampleTextureAtlas,
} from "./sample-character.ts";
export type { Unsubscribe } from "./lifecycle.ts";
export type {
  BotRequestOptions,
  BotRequestResult,
  FacingFrameMap,
  GameState,
  HapticType,
  LogOverlayEntry,
  LogOverlayHandle,
  LogOverlayLevel,
  LogOverlayOptions,
  PlayerCharacter,
  PlatformBotAppearance,
  PlatformBotDifficulty,
  PlatformBotJsonObject,
  PlatformBotProfile,
  PlatformBotSelectionSource,
  PlatformLobbyDefinition,
  PlatformLobbyLaunchContext,
  PlatformLobbyLaunchPlayer,
  PlatformLobbyModeDefinition,
  PlatformLobbyReadyPolicy,
  PlatformLobbySettingDefinition,
  PlatformLobbySettingsSchema,
  PlatformLobbyTransportType,
  PlatformLobbyVisibility,
  ScoreEditResult,
  ShareRequest,
  TextureAtlas,
  TextureAtlasAnimation,
  TextureAtlasFrame,
} from "./types.ts";

export const oasiz = {
  submitScore,
  getJibbleAnimationId,
  jibbleAnimations: JIBBLE_ANIMATION,
  jibbleAnimationIds: JIBBLE_ANIMATION_IDS,
  jibbleDirections: JIBBLE_DIRECTIONS,
  addScore,
  setScore,
  requestBots,
  getPlayerCharacter,
  getSamplePlayerCharacter,
  getSampleTextureAtlas,
  share,
  triggerHaptic,
  enableLogOverlay,
  loadGameState,
  saveGameState,
  flushGameState,
  shareRoomCode,
  openInviteModal,
  getLaunchContext,
  getLocalLaunchPlayer,
  isLaunchHost,
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
  get launchContext() {
    return getLaunchContext();
  },
  get localLaunchPlayer() {
    return getLocalLaunchPlayer();
  },
  get isHost(): boolean {
    return isLaunchHost();
  },
};
