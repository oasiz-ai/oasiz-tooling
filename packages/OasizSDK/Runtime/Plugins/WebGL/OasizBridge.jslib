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
  $oasizUnityBridgeState: {
    gameObjectName: null,
  },

  $oasizSendAsyncResponse__deps: ["$oasizUnityBridgeState"],
  $oasizSendAsyncResponse: function (requestId, result) {
    if (!oasizUnityBridgeState.gameObjectName) {
      console.warn("[OasizSDK] async response bridge is unavailable; OasizSDK was not initialized.");
      return;
    }

    var json = "";
    if (result != null) {
      try {
        json = JSON.stringify(result);
      } catch (e) {
        console.error("[OasizSDK] async response failed to serialize:", e);
      }
    }

    SendMessage(oasizUnityBridgeState.gameObjectName, "_OnAsyncResponseFromJS", requestId + "|" + json);
  },

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
    function toFiniteNumber(value) {
      if (typeof value === "number" && isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        var parsed = parseFloat(value.trim());
        if (isFinite(parsed)) {
          return parsed;
        }
      }
      return null;
    }

    function clampPixels(value) {
      var numeric = toFiniteNumber(value);
      return numeric == null ? 0 : Math.max(0, numeric);
    }

    function normalizePercent(value) {
      var numeric = toFiniteNumber(value);
      return numeric == null ? null : Math.min(100, Math.max(0, numeric));
    }

    function viewportHeight() {
      if (
        window.visualViewport &&
        typeof window.visualViewport.height === "number" &&
        isFinite(window.visualViewport.height) &&
        window.visualViewport.height > 0
      ) {
        return window.visualViewport.height;
      }
      if (typeof window.innerHeight === "number" && isFinite(window.innerHeight) && window.innerHeight > 0) {
        return window.innerHeight;
      }
      if (
        document.documentElement &&
        typeof document.documentElement.clientHeight === "number" &&
        isFinite(document.documentElement.clientHeight) &&
        document.documentElement.clientHeight > 0
      ) {
        return document.documentElement.clientHeight;
      }
      if (
        document.body &&
        typeof document.body.clientHeight === "number" &&
        isFinite(document.body.clientHeight) &&
        document.body.clientHeight > 0
      ) {
        return document.body.clientHeight;
      }
      return 0;
    }

    function readCssSafeAreaValue(cssValue) {
      var root = document.body || document.documentElement;
      if (!root || typeof window.getComputedStyle !== "function") {
        return 0;
      }

      var probe = document.createElement("div");
      probe.style.position = "fixed";
      probe.style.top = "0";
      probe.style.left = "0";
      probe.style.width = "0";
      probe.style.height = "0";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      probe.style.paddingTop = cssValue;

      root.appendChild(probe);
      try {
        return clampPixels(window.getComputedStyle(probe).paddingTop);
      } finally {
        if (typeof probe.remove === "function") {
          probe.remove();
        } else if (probe.parentNode) {
          probe.parentNode.removeChild(probe);
        }
      }
    }

    function cssSafeAreaTopPixels() {
      var envPixels = readCssSafeAreaValue("env(safe-area-inset-top)");
      if (envPixels > 0) {
        return envPixels;
      }
      return readCssSafeAreaValue("constant(safe-area-inset-top)");
    }

    function devicePixelRatio() {
      if (typeof window.devicePixelRatio !== "number" || !isFinite(window.devicePixelRatio) || window.devicePixelRatio <= 0) {
        return 1;
      }
      return window.devicePixelRatio;
    }

    function roughlyEqualPixels(a, b) {
      return Math.abs(a - b) <= 2;
    }

    function normalizePixels(value) {
      var pixels = clampPixels(value);
      var cssPixels = cssSafeAreaTopPixels();
      if (pixels <= 0) {
        return cssPixels;
      }

      var dpr = devicePixelRatio();
      if (cssPixels > 0 && dpr > 1 && roughlyEqualPixels(pixels / dpr, cssPixels)) {
        return cssPixels;
      }

      return pixels;
    }

    function pixelsToPercent(pixels) {
      var h = viewportHeight();
      if (h <= 0) {
        return 0;
      }
      return normalizePercent((pixels / h) * 100) || 0;
    }

    function cssSafeAreaTopPercent() {
      return pixelsToPercent(cssSafeAreaTopPixels());
    }

    function resolvePercent(value) {
      var percent = normalizePercent(value);
      if (percent == null) {
        return null;
      }
      return percent > 0 ? percent : cssSafeAreaTopPercent();
    }

    function resolvePixels(value) {
      var numeric = toFiniteNumber(value);
      if (numeric == null) {
        return null;
      }
      return pixelsToPercent(normalizePixels(numeric));
    }

    if (typeof window.getSafeAreaTopPercent === "function") {
      try {
        var percent = resolvePercent(window.getSafeAreaTopPercent());
        if (percent != null) {
          return percent;
        }
      } catch (e) {
        console.error("[OasizSDK] getSafeAreaTopPercent failed:", e);
      }
    }
    if (typeof window.__OASIZ_SAFE_AREA_TOP_PERCENT__ !== "undefined") {
      var globalPercent = resolvePercent(window.__OASIZ_SAFE_AREA_TOP_PERCENT__);
      if (globalPercent != null) {
        return globalPercent;
      }
    }
    if (typeof window.getSafeAreaTop === "function") {
      try {
        var pixelPercent = resolvePixels(window.getSafeAreaTop());
        if (pixelPercent != null) {
          return pixelPercent;
        }
      } catch (e) {
        console.error("[OasizSDK] getSafeAreaTop failed:", e);
      }
    }
    if (typeof window.__OASIZ_SAFE_AREA_TOP__ !== "undefined") {
      var globalPixelPercent = resolvePixels(window.__OASIZ_SAFE_AREA_TOP__);
      if (globalPixelPercent != null) {
        return globalPixelPercent;
      }
    }

    var cssPercent = cssSafeAreaTopPercent();
    if (cssPercent > 0) {
      return cssPercent;
    }

    console.warn("[OasizSDK] getSafeAreaTop bridge is unavailable.");
    return 0;
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

  OasizGetPlayerId: function () {
    var val = (window.__PLAYER_ID__ != null ? String(window.__PLAYER_ID__) : "");
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

  OasizGetPlayerCharacter__deps: ["$oasizSendAsyncResponse"],
  OasizGetPlayerCharacter: function (requestIdPtr) {
    var requestId = UTF8ToString(requestIdPtr);
    if (typeof window.__oasizGetPlayerCharacter !== "function") {
      console.warn("[OasizSDK] __oasizGetPlayerCharacter bridge is unavailable.");
      oasizSendAsyncResponse(requestId, null);
      return;
    }

    Promise.resolve(window.__oasizGetPlayerCharacter())
      .then(function (result) {
        oasizSendAsyncResponse(requestId, result);
      })
      .catch(function (err) {
        console.error("[OasizSDK] getPlayerCharacter request failed:", err);
        oasizSendAsyncResponse(requestId, null);
      });
  },

  OasizEditScore__deps: ["$oasizSendAsyncResponse"],
  OasizEditScore: function (requestIdPtr, payloadJsonPtr) {
    var requestId = UTF8ToString(requestIdPtr);
    var payloadJson = UTF8ToString(payloadJsonPtr);
    var payload;
    try {
      payload = JSON.parse(payloadJson);
    } catch (e) {
      console.error("[OasizSDK] editScore failed to parse payload JSON:", e);
      oasizSendAsyncResponse(requestId, null);
      return;
    }

    if (typeof window.__oasizEditScore !== "function") {
      console.warn("[OasizSDK] __oasizEditScore bridge is unavailable.");
      oasizSendAsyncResponse(requestId, null);
      return;
    }

    Promise.resolve(window.__oasizEditScore(payload))
      .then(function (result) {
        oasizSendAsyncResponse(requestId, result);
      })
      .catch(function (err) {
        console.error("[OasizSDK] editScore request failed:", err);
        oasizSendAsyncResponse(requestId, null);
      });
  },

  // ---------------------------------------------------------------------------
  // Lifecycle & Navigation Event Listeners
  // ---------------------------------------------------------------------------
  // The host platform dispatches custom DOM events into the iframe. This function
  // registers listeners for all four events and routes them back into Unity via
  // SendMessage on the OasizSDK GameObject.

  OasizRegisterEventListeners__deps: ["$oasizUnityBridgeState"],
  OasizRegisterEventListeners: function (gameObjectNamePtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr);
    oasizUnityBridgeState.gameObjectName = gameObjectName;

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
