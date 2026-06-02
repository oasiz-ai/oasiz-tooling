export const JIBBLE_DIRECTIONS = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
] as const;

export type JibbleDirectionCode = (typeof JIBBLE_DIRECTIONS)[number];

const JIBBLE_DIRECTION_ALIASES = {
  n: "n",
  ne: "ne",
  e: "e",
  se: "se",
  s: "s",
  sw: "sw",
  w: "w",
  nw: "nw",
  north: "n",
  "north-east": "ne",
  northeast: "ne",
  east: "e",
  "south-east": "se",
  southeast: "se",
  south: "s",
  "south-west": "sw",
  southwest: "sw",
  west: "w",
  "north-west": "nw",
  northwest: "nw",
  front: "s",
  forward: "s",
  forth: "s",
  back: "n",
  backward: "n",
  left: "w",
  right: "e",
  "front-right": "se",
  "forward-right": "se",
  "front-left": "sw",
  "forward-left": "sw",
  "back-right": "ne",
  "backward-right": "ne",
  "back-left": "nw",
  "backward-left": "nw",
} as const satisfies Record<string, JibbleDirectionCode>;

export type JibbleFacingDirection = keyof typeof JIBBLE_DIRECTION_ALIASES;

export type JibbleAnimationAction = "idle" | "walk" | "backflip";

export const JIBBLE_ANIMATION = {
  Idle: {
    North: "idle_n",
    NorthEast: "idle_ne",
    East: "idle_e",
    SouthEast: "idle_se",
    South: "idle_s",
    SouthWest: "idle_sw",
    West: "idle_w",
    NorthWest: "idle_nw",
  },
  Walk: {
    North: "walk_n",
    NorthEast: "walk_ne",
    East: "walk_e",
    SouthEast: "walk_se",
    South: "walk_s",
    SouthWest: "walk_sw",
    West: "walk_w",
    NorthWest: "walk_nw",
  },
  Backflip: "backflip",
} as const;

export const JIBBLE_ANIMATION_IDS = [
  JIBBLE_ANIMATION.Idle.North,
  JIBBLE_ANIMATION.Idle.NorthEast,
  JIBBLE_ANIMATION.Idle.East,
  JIBBLE_ANIMATION.Idle.SouthEast,
  JIBBLE_ANIMATION.Idle.South,
  JIBBLE_ANIMATION.Idle.SouthWest,
  JIBBLE_ANIMATION.Idle.West,
  JIBBLE_ANIMATION.Idle.NorthWest,
  JIBBLE_ANIMATION.Walk.North,
  JIBBLE_ANIMATION.Walk.NorthEast,
  JIBBLE_ANIMATION.Walk.East,
  JIBBLE_ANIMATION.Walk.SouthEast,
  JIBBLE_ANIMATION.Walk.South,
  JIBBLE_ANIMATION.Walk.SouthWest,
  JIBBLE_ANIMATION.Walk.West,
  JIBBLE_ANIMATION.Walk.NorthWest,
  JIBBLE_ANIMATION.Backflip,
] as const;

export type JibbleAnimationId = (typeof JIBBLE_ANIMATION_IDS)[number];

export function normalizeJibbleDirection(
  direction: JibbleFacingDirection,
): JibbleDirectionCode {
  return JIBBLE_DIRECTION_ALIASES[direction];
}

export function getJibbleAnimationId(
  action: JibbleAnimationAction,
  direction: JibbleFacingDirection = "front",
): JibbleAnimationId {
  if (action === "backflip") {
    return JIBBLE_ANIMATION.Backflip;
  }

  return `${action}_${normalizeJibbleDirection(direction)}` as JibbleAnimationId;
}
