using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Scripting;

namespace Oasiz
{
  /// <summary>
  /// Effective viewport insets that game UI should avoid.
  /// Values are normalized percentages (0–100) of the matching viewport axis:
  /// top/bottom use viewport height, left/right use viewport width.
  /// </summary>
  public struct ViewportInsets
  {
    public float Top;
    public float Right;
    public float Bottom;
    public float Left;

    public ViewportInsets(float top, float right, float bottom, float left)
    {
      Top = top;
      Right = right;
      Bottom = bottom;
      Left = left;
    }
  }

  /// <summary>
  /// Oasiz platform SDK for Unity WebGL games.
  ///
  /// Add one instance of this component to a persistent GameObject early in your
  /// game's lifecycle (e.g. a Bootstrap scene). It will survive scene loads.
  ///
  /// Usage:
  ///   OasizSDK.SubmitScore(1500);
  ///   OasizSDK.TriggerHaptic(HapticType.Medium);
  ///   OasizSDK.OpenInviteModal();
  ///   OasizSDK.EnableLogOverlay(new LogOverlayOptions { Collapsed = true });
  ///   ViewportInsets insets = OasizSDK.GetViewportInsets();
  ///   float safeTop = OasizSDK.GetSafeAreaTop();
  ///   OasizSDK.SetLeaderboardVisible(false);
  ///   OasizSDK.Share(new ShareRequest { Text = "Beat this!", Score = 42 });
  ///   OasizSDK.OnPause += HandlePause;
  /// </summary>
  public class OasizSDK : MonoBehaviour
  {
    // -------------------------------------------------------------------------
    // Singleton
    // -------------------------------------------------------------------------

    private static OasizSDK _instance;

    public static OasizSDK Instance
    {
      get
      {
        if (_instance == null)
        {
          var go = new GameObject("OasizSDK");
          _instance = go.AddComponent<OasizSDK>();
          DontDestroyOnLoad(go);
        }
        return _instance;
      }
    }

    // -------------------------------------------------------------------------
    // Events (subscribe from your game code)
    // -------------------------------------------------------------------------

    /// <summary>Fired when the host app is backgrounded or paused.</summary>
    public static event Action OnPause;

    /// <summary>Fired when the host app is foregrounded or resumed.</summary>
    public static event Action OnResume;

    /// <summary>
    /// Fired when the platform routes a back action (Android back button,
    /// web Escape key) to the game. While any listener is subscribed the
    /// platform will NOT close the game on back — your game owns that action.
    /// If a handler throws, <see cref="LeaveGame"/> is invoked and the exception
    /// is rethrown (same behavior as <c>@oasiz/sdk</c> <c>onBackButton</c>).
    /// </summary>
    public static event Action OnBackButton;

    /// <summary>Fired when the host platform initiates closing the game.</summary>
    public static event Action OnLeaveGame;

    // -------------------------------------------------------------------------
    // Back override reference counting (mirrors JS SDK behaviour)
    // -------------------------------------------------------------------------

    private static int _backListenerCount = 0;

    /// <summary>
    /// Subscribe to back-button events. While any listeners are registered,
    /// back actions are routed to the game instead of immediately exiting.
    /// Returns an Action you can call to unsubscribe. If the handler throws,
    /// the SDK requests the host to close the game and rethrows the exception.
    /// </summary>
    public static Action SubscribeBackButton(Action handler)
    {
      OnBackButton += handler;
      _backListenerCount++;

      if (_backListenerCount == 1)
      {
        SetBackOverride(true);
      }

      return () =>
      {
        OnBackButton -= handler;
        _backListenerCount = Math.Max(0, _backListenerCount - 1);
        if (_backListenerCount == 0)
        {
          SetBackOverride(false);
        }
      };
    }

    // -------------------------------------------------------------------------
    // Unity lifecycle
    // -------------------------------------------------------------------------

    private void Awake()
    {
      if (_instance != null && _instance != this)
      {
        Destroy(gameObject);
        return;
      }

      _instance = this;
      var rootObject = transform.root != null ? transform.root.gameObject : gameObject;
      DontDestroyOnLoad(rootObject);

#if UNITY_WEBGL && !UNITY_EDITOR
      OasizRegisterEventListeners(gameObject.name);
#endif
    }

    // -------------------------------------------------------------------------
    // JS callbacks — called by OasizBridge.jslib via SendMessage
    // -------------------------------------------------------------------------

    // ReSharper disable UnusedMember.Local
    [Preserve]
    private void _OnPauseFromJS() => OnPause?.Invoke();
    [Preserve]
    private void _OnResumeFromJS() => OnResume?.Invoke();
    [Preserve]
    private void _OnBackButtonFromJS()
    {
      if (OnBackButton == null)
      {
        return;
      }

      try
      {
        OnBackButton.Invoke();
      }
      catch (Exception)
      {
        LeaveGame();
        throw;
      }
    }
    [Preserve]
    private void _OnLeaveGameFromJS() => OnLeaveGame?.Invoke();

    // -------------------------------------------------------------------------
    // Async response plumbing — used by GetPlayerCharacter, EditScore, SetScore
    // -------------------------------------------------------------------------
    //
    // Unity WebGL P/Invoke functions cannot return JS Promises. Instead, the
    // C# side allocates a request id, the .jslib bridge resolves the host
    // Promise, and then SendMessages the JSON payload back to this GameObject.
    // We resolve the matching TaskCompletionSource here.
    //
    // Wire format (single string arg, since SendMessage only takes one):
    //   "<requestId>|<jsonPayload>"
    // where jsonPayload is "" when the host returned null.

    private static int _nextRequestId = 0;
    private static readonly Dictionary<string, TaskCompletionSource<string>> _pendingAsyncRequests
      = new Dictionary<string, TaskCompletionSource<string>>();

    private static (string requestId, Task<string> task) RegisterAsyncRequest()
    {
      var id = System.Threading.Interlocked.Increment(ref _nextRequestId).ToString();
      var tcs = new TaskCompletionSource<string>();
      _pendingAsyncRequests[id] = tcs;
      return (id, tcs.Task);
    }

    [Preserve]
    private void _OnAsyncResponseFromJS(string payload)
    {
      if (string.IsNullOrEmpty(payload))
      {
        return;
      }

      int sep = payload.IndexOf('|');
      if (sep < 0)
      {
        Debug.LogWarning("[OasizSDK] _OnAsyncResponseFromJS received malformed payload (no separator).");
        return;
      }

      var id = payload.Substring(0, sep);
      var json = payload.Substring(sep + 1);

      if (!_pendingAsyncRequests.TryGetValue(id, out var tcs))
      {
        Debug.LogWarning("[OasizSDK] _OnAsyncResponseFromJS got response for unknown id: " + id);
        return;
      }

      _pendingAsyncRequests.Remove(id);
      tcs.TrySetResult(json);
    }
    // ReSharper restore UnusedMember.Local

    // -------------------------------------------------------------------------
    // Score
    // -------------------------------------------------------------------------

    /// <summary>
    /// Submit the player's final score at game over. Call exactly once per
    /// session when the game ends. The platform handles leaderboard persistence.
    /// </summary>
    public static void SubmitScore(int score)
    {
      if (score < 0)
      {
        Debug.LogWarning("[OasizSDK] SubmitScore called with negative value. Clamping to 0.");
        score = 0;
      }

#if UNITY_WEBGL && !UNITY_EDITOR
      OasizSubmitScore(score);
#else
      Debug.Log($"[OasizSDK] SubmitScore({score}) — bridge unavailable in Editor.");
#endif
    }

    /// <summary>
    /// Add (or subtract) <paramref name="delta"/> from the player's current
    /// leaderboard score for this game. Unlike <see cref="SubmitScore"/>
    /// (high-water mark), this overwrites the row, so use it for game models
    /// where the leaderboard tracks a balance/accumulator/persistent state
    /// instead of a single best-run value.
    ///
    /// Resolves to null when the host bridge is unavailable (e.g. Editor) or
    /// when the backend rejected the request. Resolves with the resulting
    /// row data on success.
    /// </summary>
    public static Task<ScoreEditResult> EditScore(int delta)
    {
      if (delta == 0)
      {
        return Task.FromResult<ScoreEditResult>(null);
      }

#if UNITY_WEBGL && !UNITY_EDITOR
      var (id, task) = RegisterAsyncRequest();
      OasizEditScore(id, "{\"delta\":" + delta + "}");
      return task.ContinueWith(t => DeserializeScoreEditResult(t.Result),
        TaskContinuationOptions.ExecuteSynchronously);
#else
      Debug.Log($"[OasizSDK] EditScore({delta}) — bridge unavailable in Editor.");
      return Task.FromResult<ScoreEditResult>(null);
#endif
    }

    /// <summary>
    /// Force the player's score for this game to an absolute value (clamped
    /// to >= 0 server-side). Same overwrite semantics as <see cref="EditScore"/>.
    /// Use when the game has computed the authoritative score locally and
    /// wants to sync it back to the leaderboard.
    /// </summary>
    public static Task<ScoreEditResult> SetScore(int score)
    {
      if (score < 0)
      {
        Debug.LogWarning("[OasizSDK] SetScore called with negative value. Clamping to 0.");
        score = 0;
      }

#if UNITY_WEBGL && !UNITY_EDITOR
      var (id, task) = RegisterAsyncRequest();
      OasizEditScore(id, "{\"score\":" + score + "}");
      return task.ContinueWith(t => DeserializeScoreEditResult(t.Result),
        TaskContinuationOptions.ExecuteSynchronously);
#else
      Debug.Log($"[OasizSDK] SetScore({score}) — bridge unavailable in Editor.");
      return Task.FromResult<ScoreEditResult>(null);
#endif
    }

    /// <summary>
    /// Emit score normalization anchors so platform UI can map raw score to
    /// normalized leaderboard value.
    /// </summary>
    public static void EmitScoreConfig(ScoreConfig config)
    {
      if (config.anchors == null || config.anchors.Length != 4)
      {
        Debug.LogError("[OasizSDK] EmitScoreConfig requires exactly 4 anchors.");
        return;
      }

      string json = ScoreConfigToJson(config);

#if UNITY_WEBGL && !UNITY_EDITOR
      OasizEmitScoreConfig(json);
#else
      Debug.Log("[OasizSDK] EmitScoreConfig(" + json + ") - bridge unavailable in Editor.");
#endif
    }

    // -------------------------------------------------------------------------
    // Haptics
    // -------------------------------------------------------------------------

    /// <summary>
    /// Trigger native haptic feedback. Guard with the user's haptics preference.
    /// </summary>
    public static void TriggerHaptic(HapticType type)
    {
      string typeStr = HapticTypeToString(type);

#if UNITY_WEBGL && !UNITY_EDITOR
      OasizTriggerHaptic(typeStr);
#else
      Debug.Log($"[OasizSDK] TriggerHaptic({typeStr}) — bridge unavailable in Editor.");
#endif
    }

    // -------------------------------------------------------------------------
    // Debugging
    // -------------------------------------------------------------------------

    /// <summary>
    /// Enable an in-game console overlay for local debugging and QA sessions.
    /// The returned handle can show, hide, clear, inspect, or destroy the overlay.
    /// </summary>
    public static LogOverlayHandle EnableLogOverlay(LogOverlayOptions options = null)
    {
      options ??= new LogOverlayOptions();

      if (!options.Enabled)
      {
        return new LogOverlayHandle(false);
      }

      string optionsJson = LogOverlayOptionsToJson(options);

#if UNITY_WEBGL && !UNITY_EDITOR
      OasizEnableLogOverlay(optionsJson);
      return new LogOverlayHandle(true);
#else
      Debug.Log($"[OasizSDK] EnableLogOverlay({optionsJson}) — bridge unavailable in Editor.");
      return new LogOverlayHandle(false);
#endif
    }

    /// <summary>
    /// Append one line to the in-game log overlay (WebGL only). Use this for Unity
    /// <see cref="Debug.Log"/> output: many embedded WebViews do not route player logs
    /// through <c>console.log</c>, so the overlay's console hooks would stay empty.
    /// </summary>
    /// <param name="level">One of: debug, log, info, warn, error (same as console methods).</param>
    /// <param name="message">Primary message text.</param>
    /// <param name="stackTrace">Optional stack trace (appended after the message).</param>
    public static void AppendLogOverlay(string level, string message, string stackTrace = null)
    {
      if (string.IsNullOrEmpty(message) && string.IsNullOrEmpty(stackTrace))
      {
        return;
      }

      var combined = message ?? string.Empty;
      if (!string.IsNullOrEmpty(stackTrace))
      {
        combined = string.IsNullOrEmpty(combined) ? stackTrace : combined + "\n" + stackTrace;
      }

      level = string.IsNullOrEmpty(level) ? "log" : level;

#if UNITY_WEBGL && !UNITY_EDITOR
      OasizAppendLogOverlay(level, combined);
#else
      Debug.Log("[OasizSDK] AppendLogOverlay(" + level + "): " + combined);
#endif
    }

    // -------------------------------------------------------------------------
    // Game State Persistence
    // -------------------------------------------------------------------------

    /// <summary>
    /// Load persisted cross-session state. Returns a dictionary parsed from
    /// JSON. Returns an empty dictionary on first play or when unavailable.
    /// Call once at the start of the game.
    /// </summary>
    public static Dictionary<string, object> LoadGameState()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      string json = OasizLoadGameState();
      return ParseJsonObject(json);
#else
      Debug.Log("[OasizSDK] LoadGameState() — bridge unavailable in Editor. Returning empty state.");
      return new Dictionary<string, object>();
#endif
    }

    /// <summary>
    /// Persist cross-session state. The platform debounces writes automatically —
    /// call freely at checkpoints without worrying about request spam.
    /// State must be JSON-serializable.
    /// </summary>
    public static void SaveGameState(Dictionary<string, object> state)
    {
      string json = DictionaryToJson(state);

#if UNITY_WEBGL && !UNITY_EDITOR
      OasizSaveGameState(json);
#else
      Debug.Log($"[OasizSDK] SaveGameState({json}) — bridge unavailable in Editor.");
#endif
    }

    /// <summary>
    /// Force an immediate state write, bypassing the debounce. Call at game
    /// over or before the page unloads to ensure state is not lost.
    /// </summary>
    public static void FlushGameState()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      OasizFlushGameState();
#else
      Debug.Log("[OasizSDK] FlushGameState() — bridge unavailable in Editor.");
#endif
    }

    // -------------------------------------------------------------------------
    // Layout (host chrome — safe area, leaderboard visibility)
    // -------------------------------------------------------------------------

    /// <summary>
    /// Effective viewport insets that game UI should avoid.
    /// The top inset preserves the existing Oasiz game-safe top behavior,
    /// including host chrome / invite / leaderboard clearance when present.
    /// Left, right, and bottom use device safe-area insets today.
    /// Values are percentages (0–100) of the matching viewport axis.
    /// </summary>
    public static ViewportInsets GetViewportInsets()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      return new ViewportInsets(
        OasizGetViewportInset("top"),
        OasizGetViewportInset("right"),
        OasizGetViewportInset("bottom"),
        OasizGetViewportInset("left")
      );
#else
      return new ViewportInsets(0f, 0f, 0f, 0f);
#endif
    }

    /// <summary>
    /// Legacy alias for <c>GetViewportInsets().Top</c>.
    /// </summary>
    public static float GetSafeAreaTop()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      return OasizGetViewportInset("top");
#else
      return 0f;
#endif
    }

    /// <summary>Alias for <see cref="GetSafeAreaTop"/>.</summary>
    public static float SafeAreaTop => GetSafeAreaTop();

    /// <summary>
    /// Show or hide the host leaderboard UI. Back and social controls stay visible.
    /// No-op when the platform bridge is not injected.
    /// </summary>
    public static void SetLeaderboardVisible(bool visible)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      OasizSetLeaderboardVisible(visible ? 1 : 0);
#else
      Debug.Log($"[OasizSDK] SetLeaderboardVisible({visible}) — bridge unavailable in Editor.");
#endif
    }

    // -------------------------------------------------------------------------
    // Navigation
    // -------------------------------------------------------------------------

    /// <summary>
    /// Programmatically request the host to close the current game.
    /// </summary>
    public static void LeaveGame()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      OasizLeaveGame();
#else
      Debug.Log("[OasizSDK] LeaveGame() — bridge unavailable in Editor.");
#endif
    }

    private static void SetBackOverride(bool active)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      OasizSetBackOverride(active ? 1 : 0);
#else
      Debug.Log($"[OasizSDK] SetBackOverride({active}) — bridge unavailable in Editor.");
#endif
    }

    // -------------------------------------------------------------------------
    // Multiplayer
    // -------------------------------------------------------------------------

    /// <summary>
    /// Notify the platform of the active multiplayer room code. Pass null
    /// or empty string when leaving a room.
    /// </summary>
    public static void ShareRoomCode(string roomCode, ShareRoomCodeOptions options = null)
    {
      string optionsJson = null;
      if (options != null && options.InviteOverride)
      {
        optionsJson = "{\"inviteOverride\":true}";
      }

#if UNITY_WEBGL && !UNITY_EDITOR
      OasizShareRoomCode(string.IsNullOrEmpty(roomCode) ? null : roomCode, optionsJson);
#else
      Debug.Log($"[OasizSDK] ShareRoomCode({roomCode}, inviteOverride={options?.InviteOverride ?? false}) — bridge unavailable in Editor.");
#endif
    }

    /// <summary>
    /// Ask the platform to open the invite-friends modal (same as JS <c>openInviteModal</c>).
    /// Typically call after <see cref="ShareRoomCode"/> with an active room.
    /// </summary>
    public static void OpenInviteModal()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      OasizOpenInviteModal();
#else
      Debug.Log("[OasizSDK] OpenInviteModal() — bridge unavailable in Editor.");
#endif
    }

    /// <summary>
    /// Ask the host to open the Oasiz share flow (same as <c>oasiz.share</c> in
    /// <c>@oasiz/sdk</c>). Validates input and forwards JSON to
    /// <c>window.__oasizShareRequest</c>. The host call may be async; failures on
    /// the JavaScript side are logged to the browser console.
    /// </summary>
    /// <exception cref="ArgumentNullException"><paramref name="request"/> is null.</exception>
    /// <exception cref="ArgumentException">Request is empty or fields are invalid.</exception>
    public static void Share(ShareRequest request)
    {
      if (request == null)
      {
        throw new ArgumentNullException(nameof(request));
      }

      string json = ValidateAndSerializeShareRequest(request);

#if UNITY_WEBGL && !UNITY_EDITOR
      OasizShareRequest(json);
#else
      Debug.Log("[OasizSDK] Share(" + json + ") — bridge unavailable in Editor.");
#endif
    }

    /// <summary>The platform's internal game ID. Null when not injected.</summary>
    public static string GameId
    {
      get
      {
#if UNITY_WEBGL && !UNITY_EDITOR
        string val = OasizGetGameId();
        return string.IsNullOrEmpty(val) ? null : val;
#else
        return null;
#endif
      }
    }

    /// <summary>Pre-filled room code for auto-joining a friend's session. Null when not set.</summary>
    public static string RoomCode
    {
      get
      {
#if UNITY_WEBGL && !UNITY_EDITOR
        string val = OasizGetRoomCode();
        return string.IsNullOrEmpty(val) ? null : val;
#else
        return null;
#endif
      }
    }

    /// <summary>
    /// Stable, unique, opaque player identifier injected by the platform.
    /// Safe to use as a primary key for save slots, matchmaking, per-player
    /// analytics, or anywhere you need a reliable per-user key — unlike
    /// <see cref="PlayerName"/> (mutable, not unique). Mirrors the backend's
    /// <c>playerId</c> field returned by <c>GET /api/sdk/me</c>. Returns null
    /// when the platform has not injected an identity.
    /// </summary>
    public static string PlayerId
    {
      get
      {
#if UNITY_WEBGL && !UNITY_EDITOR
        string val = OasizGetPlayerId();
        return string.IsNullOrEmpty(val) ? null : val;
#else
        return null;
#endif
      }
    }

    /// <summary>
    /// Fetch the authenticated player's character, including a TexturePacker /
    /// Phaser-style texture atlas describing the baked sprite image. Returns
    /// null when the user has no character composition or when the bridge is
    /// unavailable. The host transparently caches and proxies to
    /// <c>GET /api/sdk/me/character</c>, so calling multiple times is cheap.
    /// </summary>
    public static Task<PlayerCharacter> GetPlayerCharacter()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      var (id, task) = RegisterAsyncRequest();
      OasizGetPlayerCharacter(id);
      return task.ContinueWith(t => DeserializePlayerCharacter(t.Result),
        TaskContinuationOptions.ExecuteSynchronously);
#else
      Debug.Log("[OasizSDK] GetPlayerCharacter() — bridge unavailable in Editor.");
      return Task.FromResult<PlayerCharacter>(null);
#endif
    }

    /// <summary>Player display name injected by the platform. Null when not set.</summary>
    public static string PlayerName
    {
      get
      {
#if UNITY_WEBGL && !UNITY_EDITOR
        string val = OasizGetPlayerName();
        return string.IsNullOrEmpty(val) ? null : val;
#else
        return null;
#endif
      }
    }

    /// <summary>Player avatar URL injected by the platform. Null when not set.</summary>
    public static string PlayerAvatar
    {
      get
      {
#if UNITY_WEBGL && !UNITY_EDITOR
        string val = OasizGetPlayerAvatar();
        return string.IsNullOrEmpty(val) ? null : val;
#else
        return null;
#endif
      }
    }

    internal static void ClearLogOverlay()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      OasizClearLogOverlay();
#else
      Debug.Log("[OasizSDK] ClearLogOverlay() — bridge unavailable in Editor.");
#endif
    }

    internal static void HideLogOverlay()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      OasizHideLogOverlay();
#else
      Debug.Log("[OasizSDK] HideLogOverlay() — bridge unavailable in Editor.");
#endif
    }

    internal static bool IsLogOverlayVisible()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      return OasizLogOverlayIsVisible() != 0;
#else
      return false;
#endif
    }

    internal static void ShowLogOverlay()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      OasizShowLogOverlay();
#else
      Debug.Log("[OasizSDK] ShowLogOverlay() — bridge unavailable in Editor.");
#endif
    }

    internal static void DestroyLogOverlay()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
      OasizDestroyLogOverlay();
#else
      Debug.Log("[OasizSDK] DestroyLogOverlay() — bridge unavailable in Editor.");
#endif
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    private static string HapticTypeToString(HapticType type)
    {
      return type switch
      {
        HapticType.Light   => "light",
        HapticType.Medium  => "medium",
        HapticType.Heavy   => "heavy",
        HapticType.Success => "success",
        HapticType.Error   => "error",
        _                  => "medium",
      };
    }

    private static string LogOverlayOptionsToJson(LogOverlayOptions options)
    {
      var payload = new Dictionary<string, object>
      {
        ["enabled"] = options.Enabled,
        ["collapsed"] = options.Collapsed,
        ["maxEntries"] = options.MaxEntries,
      };

      if (!string.IsNullOrEmpty(options.Title))
      {
        payload["title"] = options.Title;
      }

      return DictionaryToJson(payload);
    }

    private static bool IsValidShareImageReference(string image)
    {
      if (string.IsNullOrEmpty(image))
      {
        return false;
      }

      if (Regex.IsMatch(image, @"^data:image/[a-zA-Z0-9.+-]+;base64,", RegexOptions.CultureInvariant))
      {
        return true;
      }

      if (!Uri.TryCreate(image, UriKind.Absolute, out var uri))
      {
        return false;
      }

      return uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps;
    }

    private static string ValidateAndSerializeShareRequest(ShareRequest options)
    {
      var text = string.IsNullOrEmpty(options.Text) ? string.Empty : options.Text.Trim();
      bool hasText = text.Length > 0;
      bool hasScore = options.Score.HasValue;
      bool hasImage = !string.IsNullOrEmpty(options.Image);

      if (!hasText && !hasScore && !hasImage)
      {
        throw new ArgumentException("Share request requires text, score, or image.");
      }

      if (hasScore)
      {
        int s = options.Score.Value;
        if (s < 0)
        {
          throw new ArgumentException("Share score must be a non-negative integer.");
        }
      }

      if (hasImage && !IsValidShareImageReference(options.Image))
      {
        throw new ArgumentException(
          "Share image must be an http(s) URL or a data:image/... base64 string.");
      }

      var payload = new Dictionary<string, object>();
      if (hasText)
      {
        payload["text"] = text;
      }

      if (hasScore)
      {
        payload["score"] = options.Score.Value;
      }

      if (hasImage)
      {
        payload["image"] = options.Image;
      }

      return DictionaryToJson(payload);
    }

    private static string ScoreConfigToJson(ScoreConfig config)
    {
      var anchors = new System.Text.StringBuilder();
      anchors.Append("[");
      for (int i = 0; i < config.anchors.Length; i++)
      {
        if (i > 0) anchors.Append(",");
        anchors.Append("{\"raw\":");
        anchors.Append(config.anchors[i].raw);
        anchors.Append(",\"normalized\":");
        anchors.Append(config.anchors[i].normalized);
        anchors.Append("}");
      }
      anchors.Append("]");
      return "{\"anchors\":" + anchors + "}";
    }

    private static string DictionaryToJson(Dictionary<string, object> dict)
    {
      if (dict == null || dict.Count == 0) return "{}";

      var sb = new System.Text.StringBuilder();
      sb.Append("{");
      bool first = true;
      foreach (var kvp in dict)
      {
        if (!first) sb.Append(",");
        first = false;
        sb.Append($"\"{EscapeJson(kvp.Key)}\":{ValueToJson(kvp.Value)}");
      }
      sb.Append("}");
      return sb.ToString();
    }

    private static string ValueToJson(object value)
    {
      if (value == null) return "null";
      if (value is bool b) return b ? "true" : "false";
      if (value is int i) return i.ToString();
      if (value is long l) return l.ToString();
      if (value is float f) return f.ToString(System.Globalization.CultureInfo.InvariantCulture);
      if (value is double d) return d.ToString(System.Globalization.CultureInfo.InvariantCulture);
      if (value is string s) return $"\"{EscapeJson(s)}\"";
      if (value is Dictionary<string, object> nested) return DictionaryToJson(nested);
      return $"\"{EscapeJson(value.ToString())}\"";
    }

    private static string EscapeJson(string s)
    {
      return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
    }

    private static PlayerCharacter DeserializePlayerCharacter(string json)
    {
      if (string.IsNullOrEmpty(json))
      {
        return null;
      }
      try
      {
        return JsonUtility.FromJson<PlayerCharacter>(json);
      }
      catch (Exception e)
      {
        Debug.LogError("[OasizSDK] Failed to deserialize PlayerCharacter: " + e.Message);
        return null;
      }
    }

    private static ScoreEditResult DeserializeScoreEditResult(string json)
    {
      if (string.IsNullOrEmpty(json))
      {
        return null;
      }
      try
      {
        return JsonUtility.FromJson<ScoreEditResult>(json);
      }
      catch (Exception e)
      {
        Debug.LogError("[OasizSDK] Failed to deserialize ScoreEditResult: " + e.Message);
        return null;
      }
    }

    private static Dictionary<string, object> ParseJsonObject(string json)
    {
      // Minimal JSON object parser — handles flat key/value pairs.
      // For nested state, use JsonUtility or a third-party parser like Newtonsoft.
      var result = new Dictionary<string, object>();
      if (string.IsNullOrWhiteSpace(json) || json.Trim() == "{}") return result;

      try
      {
        // Strip outer braces
        json = json.Trim();
        if (json.StartsWith("{")) json = json.Substring(1);
        if (json.EndsWith("}")) json = json.Substring(0, json.Length - 1);

        // Use Unity's JsonUtility isn't suitable for arbitrary dicts, so we
        // return the raw JSON string under the special key "__json" for games
        // that need the full state and will parse it themselves.
        result["__json"] = "{" + json + "}";
      }
      catch (Exception e)
      {
        Debug.LogWarning($"[OasizSDK] Failed to parse game state JSON: {e.Message}");
      }

      return result;
    }

    // -------------------------------------------------------------------------
    // P/Invoke declarations (WebGL .jslib bridge)
    // -------------------------------------------------------------------------

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] private static extern void OasizSubmitScore(int score);
    [DllImport("__Internal")] private static extern void OasizEmitScoreConfig(string configJson);
    [DllImport("__Internal")] private static extern void OasizTriggerHaptic(string type);
    [DllImport("__Internal")] private static extern void OasizEnableLogOverlay(string optionsJson);
    [DllImport("__Internal")] private static extern void OasizAppendLogOverlay(string level, string message);
    [DllImport("__Internal")] private static extern void OasizClearLogOverlay();
    [DllImport("__Internal")] private static extern void OasizHideLogOverlay();
    [DllImport("__Internal")] private static extern int OasizLogOverlayIsVisible();
    [DllImport("__Internal")] private static extern void OasizShowLogOverlay();
    [DllImport("__Internal")] private static extern void OasizDestroyLogOverlay();
    [DllImport("__Internal")] private static extern string OasizLoadGameState();
    [DllImport("__Internal")] private static extern void OasizSaveGameState(string stateJson);
    [DllImport("__Internal")] private static extern void OasizFlushGameState();
    [DllImport("__Internal")] private static extern float OasizGetViewportInset(string side);
    [DllImport("__Internal")] private static extern void OasizSetLeaderboardVisible(int visible);
    [DllImport("__Internal")] private static extern void OasizLeaveGame();
    [DllImport("__Internal")] private static extern void OasizSetBackOverride(int active);
    [DllImport("__Internal")] private static extern void OasizShareRoomCode(string roomCode, string optionsJson);
    [DllImport("__Internal")] private static extern void OasizOpenInviteModal();
    [DllImport("__Internal")] private static extern void OasizShareRequest(string requestJson);
    [DllImport("__Internal")] private static extern string OasizGetGameId();
    [DllImport("__Internal")] private static extern string OasizGetRoomCode();
    [DllImport("__Internal")] private static extern string OasizGetPlayerId();
    [DllImport("__Internal")] private static extern string OasizGetPlayerName();
    [DllImport("__Internal")] private static extern string OasizGetPlayerAvatar();
    [DllImport("__Internal")] private static extern void OasizGetPlayerCharacter(string requestId);
    [DllImport("__Internal")] private static extern void OasizEditScore(string requestId, string payloadJson);
    [DllImport("__Internal")] private static extern void OasizRegisterEventListeners(string gameObjectName);
#endif
  }
}
