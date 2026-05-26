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
    return OasizBridge.OasizGetViewportInset("top");
  },

  OasizGetViewportInset: function (sidePtr) {
    var side = typeof sidePtr === "string" ? sidePtr : sidePtr ? UTF8ToString(sidePtr) : "";
    if (side !== "top" && side !== "right" && side !== "bottom" && side !== "left") {
      return 0;
    }

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
      return numeric == null ? null : Math.max(0, numeric);
    }

    function normalizePercent(value) {
      var numeric = toFiniteNumber(value);
      return numeric == null ? null : Math.min(100, Math.max(0, numeric));
    }

    function sideSuffix() {
      if (side === "top") return "Top";
      if (side === "right") return "Right";
      if (side === "bottom") return "Bottom";
      return "Left";
    }

    function viewportSize() {
      var vertical = side === "top" || side === "bottom";
      if (
        window.visualViewport &&
        typeof (vertical ? window.visualViewport.height : window.visualViewport.width) === "number" &&
        isFinite(vertical ? window.visualViewport.height : window.visualViewport.width) &&
        (vertical ? window.visualViewport.height : window.visualViewport.width) > 0
      ) {
        return vertical ? window.visualViewport.height : window.visualViewport.width;
      }

      var innerSize = vertical ? window.innerHeight : window.innerWidth;
      if (typeof innerSize === "number" && isFinite(innerSize) && innerSize > 0) {
        return innerSize;
      }

      if (document.documentElement) {
        var documentSize = vertical ? document.documentElement.clientHeight : document.documentElement.clientWidth;
        if (typeof documentSize === "number" && isFinite(documentSize) && documentSize > 0) {
          return documentSize;
        }
      }

      if (document.body) {
        var bodySize = vertical ? document.body.clientHeight : document.body.clientWidth;
        if (typeof bodySize === "number" && isFinite(bodySize) && bodySize > 0) {
          return bodySize;
        }
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
        return clampPixels(window.getComputedStyle(probe).paddingTop) || 0;
      } finally {
        if (typeof probe.remove === "function") {
          probe.remove();
        } else if (probe.parentNode) {
          probe.parentNode.removeChild(probe);
        }
      }
    }

    function cssSafeAreaPixels() {
      var envPixels = readCssSafeAreaValue("env(safe-area-inset-" + side + ")");
      if (envPixels > 0) {
        return envPixels;
      }
      return readCssSafeAreaValue("constant(safe-area-inset-" + side + ")");
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
      if (pixels == null) {
        return null;
      }

      var cssPixels = cssSafeAreaPixels();
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
      var size = viewportSize();
      if (size <= 0) {
        return 0;
      }
      return normalizePercent((pixels / size) * 100) || 0;
    }

    function cssSafeAreaPercent() {
      return pixelsToPercent(cssSafeAreaPixels());
    }

    function percentToPixels(percent) {
      var size = viewportSize();
      if (size <= 0) {
        return 0;
      }
      return (percent / 100) * size;
    }

    function readObjectValue(value, group) {
      if (!value || typeof value !== "object") {
        return undefined;
      }
      if (group) {
        return value[group] && typeof value[group] === "object" ? value[group][side] : undefined;
      }
      return value[side];
    }

    function callFunction(name) {
      if (typeof window[name] !== "function") {
        return undefined;
      }
      try {
        return window[name]();
      } catch (e) {
        console.error("[OasizSDK] " + name + " failed:", e);
        return undefined;
      }
    }

    function firstDefined(values) {
      for (var i = 0; i < values.length; i += 1) {
        if (typeof values[i] !== "undefined") {
          return values[i];
        }
      }
      return undefined;
    }

    function percentCandidate() {
      var methodPercent = callFunction("getViewportInsetsPercent");
      var methodPixels = callFunction("getViewportInsets");
      var suffix = sideSuffix();
      return firstDefined([
        readObjectValue(methodPercent, "percent"),
        readObjectValue(methodPercent),
        readObjectValue(window.__OASIZ_VIEWPORT_INSETS_PERCENT__, "percent"),
        readObjectValue(window.__OASIZ_VIEWPORT_INSETS_PERCENT__),
        readObjectValue(methodPixels, "percent"),
        readObjectValue(window.__OASIZ_VIEWPORT_INSETS__, "percent"),
        callFunction("getSafeArea" + suffix + "Percent"),
        window["__OASIZ_SAFE_AREA_" + side.toUpperCase() + "_PERCENT__"],
      ]);
    }

    function pixelCandidate() {
      var methodPixels = callFunction("getViewportInsets");
      var suffix = sideSuffix();
      return firstDefined([
        readObjectValue(methodPixels, "pixels"),
        readObjectValue(methodPixels),
        readObjectValue(window.__OASIZ_VIEWPORT_INSETS__, "pixels"),
        readObjectValue(window.__OASIZ_VIEWPORT_INSETS__),
        callFunction("getSafeArea" + suffix),
        window["__OASIZ_SAFE_AREA_" + side.toUpperCase() + "__"],
      ]);
    }

    var percent = normalizePercent(percentCandidate());
    if (percent != null) {
      return percent > 0 ? percent : cssSafeAreaPercent();
    }

    var pixels = normalizePixels(pixelCandidate());
    if (pixels != null) {
      return pixelsToPercent(pixels);
    }

    var cssPercent = cssSafeAreaPercent();
    if (cssPercent > 0) {
      return cssPercent;
    }

    return pixelsToPercent(percentToPixels(0));
  },

  OasizSetLeaderboardVisible: function (visible) {
    if (typeof window.__oasizSetLeaderboardVisible === "function") {
      window.__oasizSetLeaderboardVisible(visible !== 0);
    } else {
      console.warn("[OasizSDK] __oasizSetLeaderboardVisible bridge is unavailable.");
    }
  },

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------

  OasizGetGraphicsPerformance: function () {
    function toFiniteNumber(value) {
      if (typeof value === "number" && isFinite(value)) return value;
      if (typeof value === "string") {
        var parsed = parseFloat(value.trim());
        if (isFinite(parsed)) return parsed;
      }
      return null;
    }

    function clampScore(value) {
      return Math.min(100, Math.max(0, Math.round(value)));
    }

    function clampFps(value) {
      return Math.min(240, Math.max(1, Math.round(value)));
    }

    function tierFromScore(score) {
      if (score < 25) return "minimal";
      if (score < 40) return "low";
      if (score < 70) return "medium";
      return "high";
    }

    function tierFromFps(fps) {
      if (fps < 30) return "minimal";
      if (fps < 45) return "low";
      if (fps < 58) return "medium";
      return "high";
    }

    function fpsFromScore(score) {
      return tierDefaultFps(tierFromScore(score));
    }

    function tierDefaultFps(tier) {
      if (tier === "high") return 60;
      if (tier === "minimal") return 24;
      if (tier === "low") return 30;
      return 45;
    }

    function normalizeTier(value) {
      if (typeof value !== "string") return null;
      var tier = value.trim().toLowerCase();
      if (tier === "minimal" || tier === "safe") return "minimal";
      if (tier === "high" || tier === "medium") return tier;
      if (tier === "low") return "low";
      return null;
    }

    function firstDefined(values) {
      for (var i = 0; i < values.length; i += 1) {
        if (typeof values[i] !== "undefined") return values[i];
      }
      return undefined;
    }

    function normalizeMetric(value) {
      if (value == null) return null;
      if (typeof value === "number" || typeof value === "string") {
        var numericValue = toFiniteNumber(value);
        if (numericValue != null) {
          var numericFps = clampFps(numericValue);
          return { fps: numericFps, tier: tierFromFps(numericFps) };
        }
        var stringTier = normalizeTier(value);
        return stringTier ? { fps: tierDefaultFps(stringTier), tier: stringTier } : null;
      }
      if (typeof value !== "object") return null;

      var fpsCandidate = firstDefined([
        value.fps,
        value.targetFps,
        value.frameRate,
        value.framesPerSecond,
      ]);
      var legacyScoreCandidate = firstDefined([
        value.score,
        value.metric,
        value.value,
        value.performance,
        value.performanceScore,
        value.graphicsScore,
      ]);
      var tierCandidate = firstDefined([
        value.tier,
        value.graphicsTier,
        value.performanceTier,
        value.qualityTier,
        value.recommendedTier,
      ]);
      var tier = normalizeTier(tierCandidate);
      var fpsNumeric = toFiniteNumber(fpsCandidate);
      var scoreNumeric = toFiniteNumber(legacyScoreCandidate);
      if (fpsNumeric == null && scoreNumeric == null && !tier) return null;

      var fps = clampFps(
        fpsNumeric != null
          ? fpsNumeric
          : scoreNumeric != null
            ? fpsFromScore(clampScore(scoreNumeric))
            : tierDefaultFps(tier)
      );
      return { fps: fps, tier: tier || tierFromFps(fps) };
    }

    function callMetricFunction(name) {
      if (typeof window[name] !== "function") return undefined;
      try {
        return window[name]();
      } catch (e) {
        console.error("[OasizSDK] " + name + " failed:", e);
        return undefined;
      }
    }

    function readHostMetric() {
      var candidates = [
        callMetricFunction("getGraphicsPerformance"),
        callMetricFunction("getGraphicsPerformanceMetric"),
        callMetricFunction("getPerformanceMetric"),
        window.__OASIZ_GRAPHICS_PERFORMANCE__,
        window.__OASIZ_PERFORMANCE_METRIC__,
      ];
      for (var i = 0; i < candidates.length; i += 1) {
        var metric = normalizeMetric(candidates[i]);
        if (metric) return metric;
      }
      return null;
    }

    function devicePixelRatio() {
      return typeof window.devicePixelRatio === "number" && isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
    }

    function isCoarsePointer() {
      try {
        return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches === true;
      } catch (e) {
        return false;
      }
    }

    function isAppleMobileDevice() {
      var ua = (navigator && navigator.userAgent) || "";
      return /iP(hone|ad|od)/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    }

    function parseIosMajorVersion() {
      var ua = (navigator && navigator.userAgent) || "";
      var match = /\bOS (\d+)_/i.exec(ua);
      if (!match) return null;
      var parsed = parseInt(match[1], 10);
      return isFinite(parsed) ? parsed : null;
    }

    function longestScreenEdge() {
      return Math.max(
        screen && typeof screen.width === "number" ? screen.width : 0,
        screen && typeof screen.height === "number" ? screen.height : 0,
        typeof window.innerWidth === "number" ? window.innerWidth : 0,
        typeof window.innerHeight === "number" ? window.innerHeight : 0
      );
    }

    function webglInfo() {
      if (!document || typeof document.createElement !== "function") {
        return { webglVersion: 0 };
      }
      var canvas = document.createElement("canvas");
      if (!canvas || typeof canvas.getContext !== "function") {
        return { webglVersion: 0 };
      }
      var gl2 = null;
      var gl = null;
      try {
        gl2 = canvas.getContext("webgl2");
        gl = gl2 || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      } catch (e) {
        return { webglVersion: 0 };
      }
      if (!gl) return { webglVersion: 0 };

      var maxTextureSize;
      var renderer;
      try {
        var textureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (typeof textureSize === "number" && isFinite(textureSize)) {
          maxTextureSize = textureSize;
        }
      } catch (e) {}
      try {
        var debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        var rendererParam = debugInfo && debugInfo.UNMASKED_RENDERER_WEBGL ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        var rendererValue = gl.getParameter(rendererParam);
        if (typeof rendererValue === "string") renderer = rendererValue;
      } catch (e) {}

      return {
        maxTextureSize: maxTextureSize,
        renderer: renderer,
        webglVersion: gl2 ? 2 : 1,
      };
    }

    function estimateMetric() {
      var nav = navigator || {};
      var score = 45;
      var memory = toFiniteNumber(nav.deviceMemory);
      if (memory != null) {
        if (memory <= 1) score -= 18;
        else if (memory <= 2) score -= 10;
        else if (memory >= 8) score += 16;
        else if (memory >= 6) score += 10;
      }

      var cores = toFiniteNumber(nav.hardwareConcurrency);
      if (cores != null) {
        if (cores <= 2) score -= 12;
        else if (cores >= 8) score += 12;
        else if (cores >= 6) score += 8;
      }

      var gl = webglInfo();
      if (gl.webglVersion === 2) score += 16;
      else if (gl.webglVersion === 1) score += 6;
      else score -= 25;

      if (typeof gl.maxTextureSize === "number") {
        if (gl.maxTextureSize >= 8192) score += 10;
        else if (gl.maxTextureSize >= 4096) score += 3;
        else score -= 8;
      }

      var renderer = (gl.renderer || "").toLowerCase();
      if (/swiftshader|llvmpipe|software/.test(renderer)) {
        score = Math.min(score, 35);
      } else if (/\bm[1-9]\b|apple gpu|a1[6-9]|rtx|radeon|adreno 7|adreno 8/.test(renderer)) {
        score += 8;
      }

      if (isCoarsePointer()) {
        var width = screen && typeof screen.width === "number" ? screen.width : window.innerWidth || 0;
        var height = screen && typeof screen.height === "number" ? screen.height : window.innerHeight || 0;
        if (width * height * devicePixelRatio() * devicePixelRatio() > 4000000) {
          score -= 5;
        }
      }

      if (isAppleMobileDevice()) {
        var ios = parseIosMajorVersion();
        var highDensityDisplay = devicePixelRatio() >= 3;
        var longestEdge = longestScreenEdge();
        if (ios != null && ios < 15) {
          score = Math.min(score, 35);
        } else if (highDensityDisplay && longestEdge >= 430 && (ios == null || ios >= 17)) {
          score = Math.max(score, 78);
        } else if (highDensityDisplay && longestEdge >= 414 && (ios == null || ios >= 16)) {
          score = Math.max(score, 62);
        } else {
          score = Math.min(score, 48);
        }
      }

      score = clampScore(score);
      return { fps: fpsFromScore(score), tier: tierFromScore(score) };
    }

    var metric = readHostMetric();
    if (!metric) {
      metric = normalizeMetric(window.__OASIZ_GRAPHICS_PERFORMANCE_ESTIMATE__);
      if (!metric) {
        metric = estimateMetric();
        window.__OASIZ_GRAPHICS_PERFORMANCE_ESTIMATE__ = metric;
      }
    }
    var json = JSON.stringify(metric);
    var bufferSize = lengthBytesUTF8(json) + 1;
    var buffer = _malloc(bufferSize);
    stringToUTF8(json, buffer, bufferSize);
    return buffer;
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

  OasizEnableBackButtonTesting: function (keyboard, browserHistory, log) {
    var useKeyboard = keyboard !== 0;
    var useBrowserHistory = browserHistory !== 0;
    var logEnabled = log !== 0;
    var stateKey = "__oasizBackButtonTest";

    if (
      window.__oasizBackButtonTestingHandle &&
      typeof window.__oasizBackButtonTestingHandle.destroy === "function"
    ) {
      window.__oasizBackButtonTestingHandle.destroy();
    }

    var previousSetBackOverride = window.__oasizSetBackOverride;
    var previousLeaveGame = window.__oasizLeaveGame;
    var backOverrideActive = false;
    var historyTrapArmed = false;
    var destroyed = false;

    function maybeLog(message) {
      if (logEnabled) {
        console.info("[OasizSDK] " + message);
      }
    }

    function createNavigationEvent(eventName) {
      if (typeof Event === "function") {
        return new Event(eventName);
      }
      var event = document.createEvent("Event");
      event.initEvent(eventName, false, false);
      return event;
    }

    function dispatchNavigationEvent(eventName) {
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(createNavigationEvent(eventName));
      }
    }

    function canUseHistoryTrap() {
      return (
        useBrowserHistory &&
        window.history &&
        typeof window.history.pushState === "function" &&
        typeof window.history.replaceState === "function" &&
        window.location &&
        typeof window.location.href === "string"
      );
    }

    function copyState(value) {
      var copy = {};
      if (!value || typeof value !== "object") {
        return copy;
      }
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          copy[key] = value[key];
        }
      }
      return copy;
    }

    function ensureHistoryTrap() {
      if (!backOverrideActive || historyTrapArmed || !canUseHistoryTrap()) {
        return;
      }

      try {
        var baseState = copyState(window.history.state);
        var trapState = {};
        baseState[stateKey] = "base";
        trapState[stateKey] = "trap";
        window.history.replaceState(baseState, "", window.location.href);
        window.history.pushState(trapState, "", window.location.href);
        historyTrapArmed = true;
        maybeLog("Local browser Back testing is armed.");
      } catch (e) {
        historyTrapArmed = false;
        if (logEnabled) {
          console.warn("[OasizSDK] Failed to arm browser Back testing:", e);
        }
      }
    }

    function triggerBack() {
      dispatchNavigationEvent("oasiz:back");
    }

    function triggerLeave() {
      dispatchNavigationEvent("oasiz:leave");
    }

    function setBackOverride(active) {
      backOverrideActive = !!active;
      if (backOverrideActive) {
        ensureHistoryTrap();
      }
      if (typeof previousSetBackOverride === "function") {
        previousSetBackOverride(backOverrideActive);
      }
      maybeLog("Back override " + (backOverrideActive ? "enabled" : "disabled") + ".");
    }

    function stopBackEvent(event) {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      if (event && typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }

    function handleKeyDown(event) {
      if (!backOverrideActive || (event.key !== "Escape" && event.keyCode !== 27)) {
        return;
      }
      stopBackEvent(event);
      triggerBack();
    }

    function handlePopState(event) {
      if (!backOverrideActive) {
        historyTrapArmed = false;
        return;
      }

      stopBackEvent(event);
      triggerBack();
      historyTrapArmed = false;
      ensureHistoryTrap();
    }

    function testLeaveGame() {
      triggerLeave();
      if (typeof previousLeaveGame === "function") {
        previousLeaveGame();
      }
    }

    window.__oasizSetBackOverride = setBackOverride;
    window.__oasizLeaveGame = testLeaveGame;

    if (useKeyboard) {
      window.addEventListener("keydown", handleKeyDown);
    }
    if (useBrowserHistory) {
      window.addEventListener("popstate", handlePopState);
    }

    var testingHandle = {
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (useKeyboard) {
          window.removeEventListener("keydown", handleKeyDown);
        }
        if (useBrowserHistory) {
          window.removeEventListener("popstate", handlePopState);
        }
        if (window.__oasizSetBackOverride === setBackOverride) {
          window.__oasizSetBackOverride = previousSetBackOverride;
        }
        if (window.__oasizLeaveGame === testLeaveGame) {
          window.__oasizLeaveGame = previousLeaveGame;
        }
        if (window.__oasizBackButtonTestingHandle === testingHandle) {
          window.__oasizBackButtonTestingHandle = null;
        }
        maybeLog("Back button testing bridge removed.");
      },
      triggerBack: triggerBack,
      triggerLeave: triggerLeave,
      isBackOverrideActive: function () {
        return backOverrideActive;
      },
    };

    window.__oasizBackButtonTestingHandle = testingHandle;

    maybeLog("Back button testing bridge installed.");
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
