/**
 * Wave Mode Type Definitions
 * All interfaces and types used throughout the game
 */

export type GameState = "START" | "PLAYING" | "PAUSED" | "DYING" | "GAME_OVER";

export interface Settings {
  music: boolean;
  fx: boolean;
  haptics: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Wheel {
  x: number;
  y: number;
  radius: number;
  kind?: "blackhole" | "galaxy" | "supernova";
}

export interface SpikeTri {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  scale: number; // For overlap calculation
  kind: "crystal" | "plasma" | "void" | "asteroid"; // Visual variety
}

// Spike Field - a unified cluster of spikes drawn as one shape
export interface SpikeField {
  x: number;       // Center X position
  baseY: number;   // Y position on surface
  width: number;   // Total width of the field
  height: number;  // Max height of the tallest spike
  isTop: boolean;  // true = on ceiling, false = on floor
  kind: "crystal" | "plasma" | "void" | "asteroid";
  seed: number;    // For consistent random generation
  peakCount: number; // Number of jagged peaks (5-9)
}

export interface Block {
  x: number; // world center
  y: number; // world top
  w: number;
  h: number;
  seed: number; // stable visual variety (avoid Math.random() in render)
  spikes: SpikeTri[];
  kind?: "ship" | "nebula" | "asteroid";
}

// Nebula Cloud - semi-transparent swirling hazard zone
export interface NebulaCloud {
  x: number;       // Center X position
  y: number;       // Center Y position
  width: number;   // Horizontal extent
  height: number;  // Vertical extent
  seed: number;    // For consistent swirl pattern
  intensity: number; // 0-1, affects opacity and lightning frequency
  color: "purple" | "pink" | "cyan"; // Base color theme
}

// Pulsar Energy Beam - rotating beam that sweeps periodically
export interface Pulsar {
  x: number;       // Center X position
  y: number;       // Center Y position
  radius: number;  // Beam length
  angle: number;   // Current angle in radians
  speed: number;   // Rotation speed (radians per second)
  beamWidth: number; // Width of the beam
  color: "cyan" | "magenta" | "white";
}

// Comet - moving obstacle with glowing trail
export interface Comet {
  x: number;       // Current X position
  y: number;       // Current Y position
  startX: number;  // Starting X position
  startY: number;  // Starting Y position
  endX: number;    // Ending X position
  endY: number;    // Ending Y position
  speed: number;   // Movement speed
  size: number;    // Core size
  progress: number; // 0-1 position along path
  tailLength: number; // Trail length
  color: "blue" | "orange" | "green";
}

export interface Chunk {
  xStart: number;
  xEnd: number;
  top: Point[];
  bottom: Point[];
  spikes: SpikeTri[];
  spikeFields: SpikeField[];  // Unified spike clusters
  blocks: Block[];
  wheels: Wheel[];
  nebulas: NebulaCloud[];     // Swirling hazard zones
  pulsars: Pulsar[];          // Rotating energy beams
  comets: Comet[];            // Moving obstacles with trails
}

export interface TrailPoint {
  x: number; // world
  y: number; // world
  a: number;
}

export interface DeathShard {
  x: number; // screen space
  y: number; // screen space
  vx: number;
  vy: number;
  rot: number;
  rotV: number;
  size: number;
  life: number; // seconds remaining
  ttl: number; // initial life
  hue: "cyan" | "white";
}

export interface BgPlanet {
  x: number;
  y: number;
  r: number;
  speed: number; // parallax factor vs scrollX
  alpha: number;
  base: string;
  shade: string;
  ring: boolean;
  ringTilt: number;
  bandPhase: number;
}

export interface RuntimePalette {
  bgTop: string;
  bgBottom: string;
  grid: string;
  waveGlow: string;
  trail: string;
  wallFill: string;
  wallPattern: string;
}

// Spike kind type for reuse
export type SpikeKind = "crystal" | "plasma" | "void" | "asteroid";

// Flat segment info for spike placement
export interface FlatSegment {
  a: Point;
  b: Point;
  isTop: boolean;
  hasSpikes: boolean;
}

// Collision impact info for trail extension
export type CollisionObstacleType = 
  | "wall" 
  | "block" 
  | "spike" 
  | "spikeField" 
  | "wheel" 
  | "nebula" 
  | "pulsar" 
  | "comet";

export interface CollisionInfo {
  type: CollisionObstacleType;
  impactX: number;  // Visual impact point X (on obstacle's visual boundary)
  impactY: number;  // Visual impact point Y (on obstacle's visual boundary)
}
