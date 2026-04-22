// OasizBridge.jslib
// Exposes all Oasiz platform window.* globals to Unity C# via Emscripten interop.
// This file is only active in WebGL builds; all functions are no-ops in Editor.
//
// DOM log overlay helpers were removed; EnableLogOverlay / AppendLogOverlay are no-ops.
//
// Wrapped in an IIFE for Emscripten mergeInto(LibraryManager.library, ...).

(function () {
  "use strict";

var OasizBridge = {

  // ---------------------------------------------------------------------------
  // Score
  // ---------------------------------------------------------------------------
  OasizSubmitScore: function (score) {
    if (typeof window.submitScore === "function") {
      window.submitScore(score);
    } else {
      console.warn("[OasizSDK] submitScore bridge is unavailable.");
    }
  },

  OasizEmitScoreConfig: function (configJsonPtr) {
    var json = UTF8ToString(configJsonPtr);
    try {
      var config = JSON.parse(json);
      if (typeof window.emitScoreConfig === "function") {
        window.emitScoreConfig(config);
      } else {
        console.warn("[OasizSDK] emitScoreConfig bridge is unavailable.");
      }
    } catch (e) {
      console.error("[OasizSDK] emitScoreConfig failed to parse config JSON:", e);
    }
  },

  // ---------------------------------------------------------------------------
  // Haptics
  // ---------------------------------------------------------------------------

  OasizTriggerHaptic: function (typePtr) {
    var type = UTF8ToString(typePtr);
    if (typeof window.triggerHaptic === "function") {
      window.triggerHaptic(type);
    } else {
      console.warn("[OasizSDK] triggerHaptic bridge is unavailable.");
    }
  },

  // ---------------------------------------------------------------------------
  // Debugging — DOM log overlay disabled (no UI injection).
  // ---------------------------------------------------------------------------

  OasizEnableLogOverlay: function (optionsJsonPtr) {},

  OasizClearLogOverlay: function () {},

  OasizHideLogOverlay: function () {},

  OasizLogOverlayIsVisible: function () {
    return 0;
  },

  OasizShowLogOverlay: function () {},

  OasizDestroyLogOverlay: function () {},

  OasizAppendLogOverlay: function (levelPtr, messagePtr) {},

  // ---------------------------------------------------------------------------
  // Game State Persistence
  // ---------------------------------------------------------------------------

  OasizLoadGameState: function () {
    var result = "{}";
    if (typeof window.loadGameState === "function") {
      try {
        var state = window.loadGameState();
        result = JSON.stringify(state && typeof state === "object" ? state : {});
      } catch (e) {
        console.error("[OasizSDK] loadGameState failed:", e);
      }
    } else {
      console.warn("[OasizSDK] loadGameState bridge is unavailable.");
    }
    var bufferSize = lengthBytesUTF8(result) + 1;
    var buffer = _malloc(bufferSize);
    stringToUTF8(result, buffer, bufferSize);
    return buffer;
  },

  OasizSaveGameState: function (stateJsonPtr) {
    var json = UTF8ToString(stateJsonPtr);
    try {
      var state = JSON.parse(json);
      if (typeof window.saveGameState === "function") {
        window.saveGameState(state);
      } else {
        console.warn("[OasizSDK] saveGameState bridge is unavailable.");
      }
    } catch (e) {
      console.error("[OasizSDK] saveGameState failed to parse state JSON:", e);
    }
  },

  OasizFlushGameState: function () {
    if (typeof window.flushGameState === "function") {
      window.flushGameState();
    } else {
      console.warn("[OasizSDK] flushGameState bridge is unavailable.");
    }
  },

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  OasizGetSafeAreaTop: function () {
    var pct = 0;
    if (typeof window.getSafeAreaTopPercent === "function") {
      try {
        var p = window.getSafeAreaTopPercent();
        if (typeof p === "number" && isFinite(p)) {
          pct = Math.min(100, Math.max(0, p));
        }
      } catch (e) {
        console.error("[OasizSDK] getSafeAreaTopPercent failed:", e);
      }
      return pct;
    }
    if (
      typeof window.__OASIZ_SAFE_AREA_TOP_PERCENT__ !== "undefined" &&
      typeof window.__OASIZ_SAFE_AREA_TOP_PERCENT__ === "number" &&
      isFinite(window.__OASIZ_SAFE_AREA_TOP_PERCENT__)
    ) {
      return Math.min(100, Math.max(0, window.__OASIZ_SAFE_AREA_TOP_PERCENT__));
    }
    var topPx = 0;
    if (typeof window.getSafeAreaTop === "function") {
      try {
        var v = window.getSafeAreaTop();
        if (typeof v === "number" && isFinite(v)) {
          topPx = Math.max(0, v);
        }
      } catch (e) {
        console.error("[OasizSDK] getSafeAreaTop failed:", e);
      }
    } else if (
      typeof window.__OASIZ_SAFE_AREA_TOP__ !== "undefined" &&
      typeof window.__OASIZ_SAFE_AREA_TOP__ === "number" &&
      isFinite(window.__OASIZ_SAFE_AREA_TOP__)
    ) {
      topPx = Math.max(0, window.__OASIZ_SAFE_AREA_TOP__);
    } else {
      console.warn("[OasizSDK] getSafeAreaTop bridge is unavailable.");
      return 0;
    }
    var h = window.innerHeight;
    if (typeof h !== "number" || !isFinite(h) || h <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(0, (topPx / h) * 100));
  },

  OasizSetLeaderboardVisible: function (visible) {
    if (typeof window.__oasizSetLeaderboardVisible === "function") {
      window.__oasizSetLeaderboardVisible(visible !== 0);
    } else {
      console.warn("[OasizSDK] __oasizSetLeaderboardVisible bridge is unavailable.");
    }
  },

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  OasizLeaveGame: function () {
    if (typeof window.__oasizLeaveGame === "function") {
      window.__oasizLeaveGame();
    } else {
      console.warn("[OasizSDK] __oasizLeaveGame bridge is unavailable.");
    }
  },

  OasizSetBackOverride: function (active) {
    if (typeof window.__oasizSetBackOverride === "function") {
      window.__oasizSetBackOverride(active !== 0);
    } else {
      console.warn("[OasizSDK] __oasizSetBackOverride bridge is unavailable.");
    }
  },

  // ---------------------------------------------------------------------------
  // Multiplayer
  // ---------------------------------------------------------------------------

  OasizShareRoomCode: function (roomCodePtr, optionsJsonPtr) {
    var roomCode = roomCodePtr ? UTF8ToString(roomCodePtr) : null;
    if (roomCode === "") roomCode = null;
    var options = undefined;
    if (optionsJsonPtr) {
      try {
        options = JSON.parse(UTF8ToString(optionsJsonPtr));
      } catch (e) {
        console.error("[OasizSDK] shareRoomCode failed to parse options JSON:", e);
      }
    }
    if (typeof window.shareRoomCode === "function") {
      window.shareRoomCode(roomCode, options);
    } else {
      console.warn("[OasizSDK] shareRoomCode bridge is unavailable.");
    }
  },

  OasizOpenInviteModal: function () {
    if (typeof window.openInviteModal === "function") {
      window.openInviteModal();
    } else {
      console.warn("[OasizSDK] openInviteModal bridge is unavailable.");
    }
  },

  OasizShareRequest: function (requestJsonPtr) {
    var json = UTF8ToString(requestJsonPtr);
    var request;
    try {
      request = JSON.parse(json);
    } catch (e) {
      console.error("[OasizSDK] share failed to parse request JSON:", e);
      return;
    }
    if (typeof window.__oasizShareRequest !== "function") {
      console.warn("[OasizSDK] __oasizShareRequest bridge is unavailable.");
      return;
    }
    Promise.resolve(window.__oasizShareRequest(request)).catch(function (err) {
      console.error("[OasizSDK] share request failed:", err);
    });
  },

  OasizGetGameId: function () {
    var val = (window.__GAME_ID__ != null ? String(window.__GAME_ID__) : "");
    var bufferSize = lengthBytesUTF8(val) + 1;
    var buffer = _malloc(bufferSize);
    stringToUTF8(val, buffer, bufferSize);
    return buffer;
  },

  OasizGetRoomCode: function () {
    var val = (window.__ROOM_CODE__ != null ? String(window.__ROOM_CODE__) : "");
    var bufferSize = lengthBytesUTF8(val) + 1;
    var buffer = _malloc(bufferSize);
    stringToUTF8(val, buffer, bufferSize);
    return buffer;
  },

  OasizGetPlayerName: function () {
    var val = (window.__PLAYER_NAME__ != null ? String(window.__PLAYER_NAME__) : "");
    var bufferSize = lengthBytesUTF8(val) + 1;
    var buffer = _malloc(bufferSize);
    stringToUTF8(val, buffer, bufferSize);
    return buffer;
  },

  OasizGetPlayerAvatar: function () {
    var val = (window.__PLAYER_AVATAR__ != null ? String(window.__PLAYER_AVATAR__) : "");
    var bufferSize = lengthBytesUTF8(val) + 1;
    var buffer = _malloc(bufferSize);
    stringToUTF8(val, buffer, bufferSize);
    return buffer;
  },

  // ---------------------------------------------------------------------------
  // Lifecycle & Navigation Event Listeners
  // ---------------------------------------------------------------------------
  // The host platform dispatches custom DOM events into the iframe. This function
  // registers listeners for all four events and routes them back into Unity via
  // SendMessage on the OasizSDK GameObject.

  OasizRegisterEventListeners: function (gameObjectNamePtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);

    window.addEventListener("oasiz:pause", function () {
      SendMessage(gameObjectName, "_OnPauseFromJS");
    });

    window.addEventListener("oasiz:resume", function () {
      SendMessage(gameObjectName, "_OnResumeFromJS");
    });

    window.addEventListener("oasiz:back", function () {
      SendMessage(gameObjectName, "_OnBackButtonFromJS");
    });

    window.addEventListener("oasiz:leave", function () {
      SendMessage(gameObjectName, "_OnLeaveGameFromJS");
    });
  },
};

mergeInto(LibraryManager.library, OasizBridge);
})();
