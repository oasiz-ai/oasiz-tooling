using System;

namespace Oasiz
{
  /// <summary>
  /// Payload for <see cref="OasizSDK.Share"/>. At least one of
  /// <see cref="Text"/>, <see cref="Score"/>, or <see cref="Image"/> must be set.
  /// Matches the HTML5 <c>ShareRequest</c> shape.
  /// </summary>
  public sealed class ShareRequest
  {
    /// <summary>Optional share message (trimmed before send).</summary>
    public string Text { get; set; }

    /// <summary>Optional challenge score; omit by leaving null.</summary>
    public int? Score { get; set; }

    /// <summary>Optional <c>http(s)</c> URL or <c>data:image/...;base64,...</c> payload.</summary>
    public string Image { get; set; }
  }

  /// <summary>
  /// Optional flags for <see cref="OasizSDK.ShareRoomCode"/>.
  /// </summary>
  public sealed class ShareRoomCodeOptions
  {
    /// <summary>
    /// When true, the platform hides its default invite pill so the game can own invite UI.
    /// </summary>
    public bool InviteOverride { get; set; }
  }

  /// <summary>
  /// Haptic feedback intensity type.
  /// </summary>
  public enum HapticType
  {
    Light,
    Medium,
    Heavy,
    Success,
    Error,
  }

  [Serializable]
  public struct ScoreAnchor
  {
    public int raw;
    public int normalized;

    public ScoreAnchor(int raw, int normalized)
    {
      this.raw = raw;
      this.normalized = normalized;
    }
  }

  [Serializable]
  public struct ScoreConfig
  {
    public ScoreAnchor[] anchors;

    public ScoreConfig(ScoreAnchor a1, ScoreAnchor a2, ScoreAnchor a3, ScoreAnchor a4)
    {
      anchors = new[] { a1, a2, a3, a4 };
    }
  }

  // ===========================================================================
  // Texture atlas / player character (mirrors GET /api/sdk/me/character)
  // ===========================================================================

  /// <summary>
  /// One frame in a texture atlas. Coordinates are in pixels relative to the
  /// top-left of the atlas image. Convert to Unity's bottom-left origin when
  /// constructing a <c>UnityEngine.Sprite</c> with
  /// <c>Sprite.Create(tex, new Rect(x, imageHeight - y - height, width, height), ...)</c>.
  /// </summary>
  [Serializable]
  public sealed class TextureAtlasFrame
  {
    public string name;
    public int x;
    public int y;
    public int width;
    public int height;
  }

  /// <summary>
  /// Per-direction frame indexes inside an animation. <c>left</c> is either an
  /// integer string (the frame index) or the literal string <c>"mirror"</c>,
  /// indicating the renderer should mirror the right-facing frame. Kept as a
  /// string so <c>JsonUtility</c> can deserialize it without custom converters.
  /// </summary>
  [Serializable]
  public sealed class FacingFrameMap
  {
    public int front;
    public int back;
    public int right;
    /// <summary>Either an integer index as a string (e.g. <c>"3"</c>) or <c>"mirror"</c>.</summary>
    public string left;
  }

  /// <summary>
  /// One named animation in a texture atlas. <see cref="frames"/> is the
  /// playback-ordered list of frame names; resolve each name against the
  /// atlas's <see cref="TextureAtlas.frames"/> array to get coordinates.
  /// </summary>
  [Serializable]
  public sealed class TextureAtlasAnimation
  {
    public string animationId;
    public string role;
    public string group;
    public string direction;
    public int frameRate;
    public string[] frames;
    public FacingFrameMap facingFrameMap;
  }

  /// <summary>
  /// TexturePacker / Phaser-style texture atlas describing the player's
  /// baked sprite image. Use <see cref="imageUrl"/> as the source for a
  /// <c>UnityWebRequestTexture</c>; iterate <see cref="frames"/> to slice
  /// <c>Sprite</c>s; iterate <see cref="animations"/> to build clips.
  /// </summary>
  [Serializable]
  public sealed class TextureAtlas
  {
    public string imageUrl;
    public int imageWidth;
    public int imageHeight;
    public TextureAtlasFrame[] frames;
    public TextureAtlasAnimation[] animations;
  }

  /// <summary>
  /// The authenticated player's character (returned by
  /// <see cref="OasizSDK.GetPlayerCharacter"/>). <see cref="textureAtlas"/>
  /// is the runtime atlas suitable for in-game rendering;
  /// <see cref="editorTextureAtlas"/> is the higher-detail version intended
  /// for character previews / customizer UI and may be null.
  /// </summary>
  [Serializable]
  public sealed class PlayerCharacter
  {
    public string characterName;
    public string baseCharacterId;
    public string compositionCode;
    public TextureAtlas textureAtlas;
    public TextureAtlas editorTextureAtlas;
  }

  // ===========================================================================
  // Platform bots (mirrors POST /api/sdk/games/:id/bots/request)
  // ===========================================================================

  /// <summary>
  /// Difficulty filter for platform-managed bot profiles.
  /// </summary>
  public enum BotDifficulty
  {
    Easy,
    Medium,
    Hard,
  }

  /// <summary>
  /// Options for <see cref="OasizSDK.RequestBots"/>. Leave fields unset to use
  /// the platform defaults for the current game.
  /// </summary>
  public sealed class BotRequestOptions
  {
    /// <summary>Requested number of bots. Leave 0 to let the platform choose.</summary>
    public int Count { get; set; }

    /// <summary>Optional single difficulty filter.</summary>
    public BotDifficulty? Difficulty { get; set; }

    /// <summary>Optional list of allowed difficulties. Takes precedence over Difficulty.</summary>
    public BotDifficulty[] Difficulties { get; set; }

    /// <summary>Optional game-configured bot pool key.</summary>
    public string PoolKey { get; set; }

    /// <summary>Optional deterministic selection seed.</summary>
    public string Seed { get; set; }

    /// <summary>When true, include each bot's Jibble atlas appearance when available.</summary>
    public bool? IncludeAppearance { get; set; }
  }

  /// <summary>
  /// Jibble atlas appearance for a platform bot. Layer details are preserved as
  /// JSON strings because Unity's JsonUtility cannot deserialize arbitrary
  /// nested objects.
  /// </summary>
  [Serializable]
  public sealed class PlatformBotAppearance
  {
    public string kind;
    public string characterName;
    public string baseCharacterId;
    public string compositionCode;
    public string layerConfigJson;
    public string renderLayersJson;
    public TextureAtlas textureAtlas;
    public TextureAtlas editorTextureAtlas;
  }

  /// <summary>
  /// One platform-managed bot profile selected for the current game.
  /// </summary>
  [Serializable]
  public sealed class PlatformBotProfile
  {
    public string id;
    public string name;
    public string characteristic;
    public string difficulty;
    public string behaviorJson;
    public string personalityJson;
    public PlatformBotAppearance appearance;
  }

  /// <summary>
  /// Result from <see cref="OasizSDK.RequestBots"/>. The Task resolves to null
  /// when the host bridge is unavailable or the backend rejects the request.
  /// </summary>
  [Serializable]
  public sealed class BotRequestResult
  {
    public bool ok;
    public string gameId;
    public string playerId;
    public string poolKey;
    public string source;
    public int requestedCount;
    public int returnedCount;
    public PlatformBotProfile[] bots;
  }

  // ===========================================================================
  // Score edit (mirrors POST /api/sdk/games/:id/score/edit)
  // ===========================================================================

  /// <summary>
  /// Result of an <see cref="OasizSDK.EditScore"/> or
  /// <see cref="OasizSDK.SetScore"/> call. The Task itself resolves to
  /// <c>null</c> when the host bridge is unavailable or the backend
  /// returned an error — callers don't need an `ok` flag.
  /// </summary>
  [Serializable]
  public sealed class ScoreEditResult
  {
    public string playerId;
    public int previousScore;
    public int newScore;
    public int previousWeeklyScore;
    public int newWeeklyScore;
    /// <summary>
    /// Game's configured normalized score (0..N) for <see cref="newScore"/>.
    /// Will be 0 when the game has no score config; check
    /// <c>normalizedScore != 0</c> if you only want configured games.
    /// </summary>
    public int normalizedScore;
  }

  /// <summary>
  /// Configuration for the in-game log overlay.
  /// </summary>
  public sealed class LogOverlayOptions
  {
    public bool Enabled { get; set; } = true;
    public bool Collapsed { get; set; } = false;
    public int MaxEntries { get; set; } = 200;
    public string Title { get; set; } = "SDK Logs";
  }

  /// <summary>
  /// Handle returned by EnableLogOverlay for controlling the overlay lifecycle.
  /// </summary>
  public sealed class LogOverlayHandle
  {
    private readonly bool _available;
    private bool _destroyed;

    internal LogOverlayHandle(bool available)
    {
      _available = available;
    }

    public void Clear()
    {
      if (!_available || _destroyed) return;
      OasizSDK.ClearLogOverlay();
    }

    public void Hide()
    {
      if (!_available || _destroyed) return;
      OasizSDK.HideLogOverlay();
    }

    public bool IsVisible()
    {
      if (!_available || _destroyed) return false;
      return OasizSDK.IsLogOverlayVisible();
    }

    public void Show()
    {
      if (!_available || _destroyed) return;
      OasizSDK.ShowLogOverlay();
    }

    public void Destroy()
    {
      if (!_available || _destroyed) return;
      _destroyed = true;
      OasizSDK.DestroyLogOverlay();
    }
  }
}
