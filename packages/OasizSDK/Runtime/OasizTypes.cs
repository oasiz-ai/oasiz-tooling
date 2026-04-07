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
