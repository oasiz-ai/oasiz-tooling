namespace Oasiz
{
  public enum JibbleAnimationAction
  {
    Idle,
    Walk,
    Backflip
  }

  public enum JibbleDirection
  {
    North,
    NorthEast,
    East,
    SouthEast,
    South,
    SouthWest,
    West,
    NorthWest,
    Front,
    Forward,
    Back,
    Backward,
    Left,
    Right,
    FrontRight,
    ForwardRight,
    FrontLeft,
    ForwardLeft,
    BackRight,
    BackwardRight,
    BackLeft,
    BackwardLeft
  }

  public static class JibbleAnimations
  {
    public static class Idle
    {
      public const string North = "idle_n";
      public const string NorthEast = "idle_ne";
      public const string East = "idle_e";
      public const string SouthEast = "idle_se";
      public const string South = "idle_s";
      public const string SouthWest = "idle_sw";
      public const string West = "idle_w";
      public const string NorthWest = "idle_nw";
    }

    public static class Walk
    {
      public const string North = "walk_n";
      public const string NorthEast = "walk_ne";
      public const string East = "walk_e";
      public const string SouthEast = "walk_se";
      public const string South = "walk_s";
      public const string SouthWest = "walk_sw";
      public const string West = "walk_w";
      public const string NorthWest = "walk_nw";
    }

    public const string Backflip = "backflip";

    public static readonly string[] All =
    {
      Idle.North,
      Idle.NorthEast,
      Idle.East,
      Idle.SouthEast,
      Idle.South,
      Idle.SouthWest,
      Idle.West,
      Idle.NorthWest,
      Walk.North,
      Walk.NorthEast,
      Walk.East,
      Walk.SouthEast,
      Walk.South,
      Walk.SouthWest,
      Walk.West,
      Walk.NorthWest,
      Backflip
    };

    public static string GetId(
      JibbleAnimationAction action,
      JibbleDirection direction = JibbleDirection.Front)
    {
      if (action == JibbleAnimationAction.Backflip)
      {
        return Backflip;
      }

      var prefix = action == JibbleAnimationAction.Walk ? "walk" : "idle";
      return prefix + "_" + GetDirectionCode(direction);
    }

    public static string GetDirectionCode(JibbleDirection direction)
    {
      switch (direction)
      {
        case JibbleDirection.North:
        case JibbleDirection.Back:
        case JibbleDirection.Backward:
          return "n";
        case JibbleDirection.NorthEast:
        case JibbleDirection.BackRight:
        case JibbleDirection.BackwardRight:
          return "ne";
        case JibbleDirection.East:
        case JibbleDirection.Right:
          return "e";
        case JibbleDirection.SouthEast:
        case JibbleDirection.FrontRight:
        case JibbleDirection.ForwardRight:
          return "se";
        case JibbleDirection.South:
        case JibbleDirection.Front:
        case JibbleDirection.Forward:
          return "s";
        case JibbleDirection.SouthWest:
        case JibbleDirection.FrontLeft:
        case JibbleDirection.ForwardLeft:
          return "sw";
        case JibbleDirection.West:
        case JibbleDirection.Left:
          return "w";
        case JibbleDirection.NorthWest:
        case JibbleDirection.BackLeft:
        case JibbleDirection.BackwardLeft:
          return "nw";
        default:
          return "s";
      }
    }
  }
}
