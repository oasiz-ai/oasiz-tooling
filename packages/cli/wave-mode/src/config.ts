/**
 * Wave Mode Configuration
 * Game constants and palette definitions
 */

export const CONFIG = {
  // Physics
  WAVE_SIZE: 18,
  // Keep X and Y equal to preserve perfect 45° wave motion
  WAVE_SPEED_X: 420, // px/s (dialed down)
  WAVE_SPEED_Y: 420, // px/s (dialed down)

  // Camera
  CAMERA_SMOOTH: 0.14,
  CAMERA_DEADZONE_PX: 26, // ignore tiny corridor center jitter
  CAMERA_MAX_SPEED: 820, // px/s max camera movement

  // Level geometry
  CHUNK_WIDTH: 900,
  SEG_DX: 90, // corridors are built from 0° or 45° segments only
  WALL_MARGIN: 70, // keep corridor away from extreme edges
  MIN_HEIGHT: 180, // Increased from 150 for more maneuvering room
  MAX_HEIGHT: 340, // Increased from 320 for wider corridors

  // Obstacle clearance - minimum gap above/below floating obstacles
  OBSTACLE_MIN_CLEARANCE: 75, // Minimum passable gap on each side of obstacle
  OBSTACLE_CLEARANCE_X: 120, // Horizontal buffer before/after obstacles (no spikes here)

  // Intro: first N meters are a straight, obstacle-free corridor (fair warmup)
  INTRO_SAFE_METERS: 100,

  // Pixel-art rendering: render to a low-res buffer and scale up with nearest-neighbor.
  // This produces a crisp pixel-art look without rewriting all drawing code.
  // DISABLED: Causes visual glitching/tearing on iOS WebView due to double-buffer upscaling issues.
  PIXEL_ART: false,
  // 16-bit vibe: higher internal res (less chunky), classic color quantization + subtle scanlines.
  PIXEL_STYLE: "16BIT" as "PIXEL" | "16BIT",
  // Keep this low enough that the pixelation is clearly visible (but still smooth performance).
  PIXEL_RENDER_SCALE_DESKTOP: 0.46,
  PIXEL_RENDER_SCALE_MOBILE: 0.42,
  // NOTE: Per-frame RGB565 quantization via getImageData is expensive and can lag on some machines.
  // Keep it off by default; we still get a strong 16-bit vibe via pixel upscaling + scanlines.
  PIXEL_16BIT_QUANTIZE_565: false,
  PIXEL_16BIT_DITHER: false,
  PIXEL_16BIT_SCANLINES: false,
  PIXEL_16BIT_SCANLINE_ALPHA: 0.10,

  // Spikes
  SPIKE_W: 34,
  SPIKE_H: 34,
  SPIKE_SPACING: 34,
  SPIKE_MIN_SPACING: 42, // Minimum distance between spike tips (prevents overlap)
  SPIKE_SCALE_MIN: 0.6,
  SPIKE_SCALE_MAX: 1.4,
  // Spike pattern scales
  SPIKE_SCALE_BIG: 1.3, // Single big spike
  SPIKE_SCALE_FIELD: 0.55, // Small spikes in field pattern

  // Difficulty
  DIFF_START_EASY_METERS: 120,
  DIFF_RAMP_METERS: 3000, // Increased from 2200 for slower difficulty ramp
  SPEED_BASE: 1.0,
  SPEED_MAX: 1.6, // Reduced from 1.8 for more manageable top speed
  // Corridor tightening is now less aggressive (see heightTighten in nextChunk)

  // Visuals (16-bit sci-fi palette)
  BG_TOP: "#070a1a", // deep navy
  BG_BOTTOM: "#1a0830", // violet
  GRID_COLOR: "rgba(180, 255, 236, 0.06)", // mint-teal
  STAR_COUNT: 150,
  PLANET_COUNT: 4,
  // Palette drift: slowly shifts the night-blue theme as you travel.
  // Higher = slower shift.
  PALETTE_SHIFT_METERS: 900,
  // Continuous drift over time (adds subtle motion even when distance changes slowly).
  PALETTE_TIME_SPEED: 0.018, // cycles per second in "keyframe units"
  WALL_FILL: "#140f2a",
  WALL_PATTERN: "rgba(108, 92, 255, 0.12)",
  WALL_OUTLINE: "rgba(220,255,244,0.92)",
  SPIKE_FILL: "#f3f7ff",
  SPIKE_STROKE: "rgba(0,0,0,0.70)",
  WAVE_FILL: "#e8fbff",
  WAVE_GLOW: "rgba(120, 255, 244, 0.55)",
  WAVE_OUTLINE: "rgba(0, 0, 0, 0.85)",
  TRAIL: "rgba(120, 255, 244, 0.30)",
  TRAIL_OUTLINE: "rgba(255, 255, 255, 1.0)", // White outline

  // FX
  SHAKE_MS: 140,
  SHAKE_PX: 10,
  DEATH_FLASH_MS: 120,
  
  // Performance: Glow/Shadow settings
  // shadowBlur is very expensive - use cached glows instead where possible
  USE_CACHED_GLOWS: true, // Use pre-rendered glow sprites instead of shadowBlur
  GLOW_QUALITY_DESKTOP: 1.0, // Glow sprite resolution multiplier
  GLOW_QUALITY_MOBILE: 0.75, // Lower on mobile for better performance
  MAX_SHADOW_BLUR: 30, // Cap shadowBlur radius (expensive above this)
  DISABLE_SHADOW_BLUR: false, // Set true to completely disable shadowBlur (fastest)
  
  // Performance: Framerate settings
  TARGET_FPS_DESKTOP: 60, // Target FPS on desktop
  TARGET_FPS_MOBILE: 30, // Target FPS on mobile (saves battery)
  ADAPTIVE_FPS: true, // Automatically lower FPS if struggling
  ADAPTIVE_FPS_THRESHOLD: 0.8, // If frame time exceeds this ratio of target, lower quality
  
  // Performance: Mobile visual reductions
  STAR_COUNT_DESKTOP: 150,
  STAR_COUNT_MOBILE: 60, // Fewer stars on mobile
  PLANET_COUNT_DESKTOP: 4,
  PLANET_COUNT_MOBILE: 2, // Fewer planets on mobile
};

/**
 * Runtime performance settings (can be adjusted based on device)
 */
export const PERF = {
  useCachedGlows: true,
  shadowBlurEnabled: true,
  maxShadowBlur: 30,
  glowQuality: 1.0,
  targetFPS: 60,
  adaptiveFPS: true,
  // Performance level: 1.0 = full, can be reduced automatically
  qualityLevel: 1.0,
};

export interface PaletteKeyframe {
  bgTop: [number, number, number];
  bgBottom: [number, number, number];
  grid: [number, number, number, number];
  waveGlow: [number, number, number, number];
  trail: [number, number, number, number];
  wallFill: [number, number, number];
  wallPattern: [number, number, number, number];
}

export const PALETTE_KEYFRAMES: PaletteKeyframe[] = [
  // Deep night blue -> violet
  {
    bgTop: [7, 10, 26],
    bgBottom: [26, 8, 48],
    grid: [180, 255, 236, 0.06],
    waveGlow: [120, 255, 244, 0.55],
    trail: [120, 255, 244, 0.30],
    wallFill: [20, 15, 42],
    wallPattern: [108, 92, 255, 0.12],
  },
  // Night blue -> deep teal
  {
    bgTop: [6, 14, 32],
    bgBottom: [8, 44, 58],
    grid: [120, 255, 244, 0.055],
    waveGlow: [90, 220, 255, 0.55],
    trail: [90, 220, 255, 0.28],
    wallFill: [12, 28, 38],
    wallPattern: [80, 200, 255, 0.12],
  },
  // Indigo -> magenta accent
  {
    bgTop: [10, 8, 30],
    bgBottom: [44, 14, 72],
    grid: [230, 190, 255, 0.055],
    waveGlow: [255, 120, 220, 0.50],
    trail: [255, 120, 220, 0.26],
    wallFill: [28, 18, 50],
    wallPattern: [200, 120, 255, 0.12],
  },
  // Midnight green -> blue
  {
    bgTop: [4, 18, 24],
    bgBottom: [10, 26, 52],
    grid: [170, 255, 210, 0.055],
    waveGlow: [120, 255, 180, 0.52],
    trail: [120, 255, 180, 0.28],
    wallFill: [8, 22, 32],
    wallPattern: [100, 220, 200, 0.12],
  },
  // Red-orange -> deep red
  {
    bgTop: [30, 8, 12],
    bgBottom: [72, 18, 24],
    grid: [255, 180, 140, 0.055],
    waveGlow: [255, 140, 100, 0.50],
    trail: [255, 140, 100, 0.26],
    wallFill: [50, 18, 22],
    wallPattern: [255, 120, 100, 0.12],
  },
  // Purple-pink -> hot pink
  {
    bgTop: [24, 6, 28],
    bgBottom: [58, 12, 52],
    grid: [255, 150, 240, 0.055],
    waveGlow: [255, 100, 200, 0.50],
    trail: [255, 100, 200, 0.26],
    wallFill: [42, 12, 48],
    wallPattern: [255, 100, 220, 0.12],
  },
  // Cyan-blue -> electric blue
  {
    bgTop: [4, 20, 32],
    bgBottom: [12, 40, 64],
    grid: [150, 240, 255, 0.055],
    waveGlow: [100, 220, 255, 0.50],
    trail: [100, 220, 255, 0.26],
    wallFill: [8, 32, 48],
    wallPattern: [100, 200, 255, 0.12],
  },
  // Yellow-orange -> amber
  {
    bgTop: [32, 24, 8],
    bgBottom: [64, 48, 16],
    grid: [255, 220, 150, 0.055],
    waveGlow: [255, 200, 100, 0.50],
    trail: [255, 200, 100, 0.26],
    wallFill: [48, 36, 16],
    wallPattern: [255, 180, 100, 0.12],
  },
];
