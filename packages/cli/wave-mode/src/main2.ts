/**
 * WAVE MODE (Geometry Dash inspired)
 * - Hold (mouse/touch/space) = move up at 45°
 * - Release = move down at 45°
 * - Auto-scrolls endlessly
 * - Collision is computed from rendered geometry (walls + spikes + blocks)
 *
 * Notes:
 * - Settings are persisted (music/fx/haptics).
 * - We do NOT persist or track high scores locally (platform owns leaderboards).
 *
 * MAP GENERATION RULES:
 * See MAP_GENERATION_RULES.md for comprehensive rules based on frame analysis.
 * Key principles: 45° angles only, spikes on flat segments, difficulty scaling,
 * color theme switching (purple→red), geometric obstacle patterns.
 */
 
// Vite-bundled background music (looped)
import bgmUrl from "./music/Neon Drift Systems.mp3";

type GameState = "START" | "PLAYING" | "PAUSED" | "DYING" | "GAME_OVER";

interface Settings {
  music: boolean;
  fx: boolean;
  haptics: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface Wheel {
  x: number;
  y: number;
  radius: number;
}

interface Chunk {
  xStart: number;
  xEnd: number;
  top: Point[];
  bottom: Point[];
  spikes: SpikeTri[];
  blocks: Block[];
  wheels: Wheel[];
}

interface SpikeTri {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
}

interface Block {
  x: number; // world center
  y: number; // world top
  w: number;
  h: number;
  seed: number; // stable visual variety (avoid Math.random() in render)
  spikes: SpikeTri[];
}


interface TrailPoint {
  x: number; // world
  y: number; // world
  a: number;
}

interface DeathShard {
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

interface BgPlanet {
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

interface RuntimePalette {
  bgTop: string;
  bgBottom: string;
  grid: string;
  waveGlow: string;
  trail: string;
}

const CONFIG = {
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
  MIN_HEIGHT: 150,
  MAX_HEIGHT: 320,

  // Intro: first N meters are a straight, obstacle-free corridor (fair warmup)
  INTRO_SAFE_METERS: 100,

  // Pixel-art rendering: render to a low-res buffer and scale up with nearest-neighbor.
  // This produces a crisp pixel-art look without rewriting all drawing code.
  PIXEL_ART: true,
  // 16-bit vibe: higher internal res (less chunky), classic color quantization + subtle scanlines.
  PIXEL_STYLE: "16BIT" as "PIXEL" | "16BIT",
  // Keep this low enough that the pixelation is clearly visible (but still smooth performance).
  PIXEL_RENDER_SCALE_DESKTOP: 0.46,
  PIXEL_RENDER_SCALE_MOBILE: 0.42,
  // NOTE: Per-frame RGB565 quantization via getImageData is expensive and can lag on some machines.
  // Keep it off by default; we still get a strong 16-bit vibe via pixel upscaling + scanlines.
  PIXEL_16BIT_QUANTIZE_565: false,
  PIXEL_16BIT_DITHER: false,
  PIXEL_16BIT_SCANLINES: true,
  PIXEL_16BIT_SCANLINE_ALPHA: 0.10,

  // Spikes
  SPIKE_W: 34,
  SPIKE_H: 34,
  SPIKE_SPACING: 34,
  SPIKE_SCALE_MIN: 0.6,
  SPIKE_SCALE_MAX: 1.4,

  // Difficulty
  DIFF_START_EASY_METERS: 120,
  DIFF_RAMP_METERS: 2200,
  SPEED_BASE: 1.0,
  SPEED_MAX: 1.8,

  // Visuals (16-bit sci-fi palette)
  BG_TOP: "#070a1a", // deep navy
  BG_BOTTOM: "#1a0830", // violet
  GRID_COLOR: "rgba(180, 255, 236, 0.06)", // mint-teal
  STAR_COUNT: 150,
  PLANET_COUNT: 4,
  // Palette drift: slowly shifts the night-blue theme as you travel.
  // Higher = slower shift.
  PALETTE_SHIFT_METERS: 900,
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
};

const PALETTE_KEYFRAMES: Array<{
  bgTop: [number, number, number];
  bgBottom: [number, number, number];
  grid: [number, number, number, number];
  waveGlow: [number, number, number, number];
  trail: [number, number, number, number];
}> = [
  // Deep night blue -> violet
  {
    bgTop: [7, 10, 26],
    bgBottom: [26, 8, 48],
    grid: [180, 255, 236, 0.06],
    waveGlow: [120, 255, 244, 0.55],
    trail: [120, 255, 244, 0.30],
  },
  // Night blue -> deep teal
  {
    bgTop: [6, 14, 32],
    bgBottom: [8, 44, 58],
    grid: [120, 255, 244, 0.055],
    waveGlow: [90, 220, 255, 0.55],
    trail: [90, 220, 255, 0.28],
  },
  // Indigo -> magenta accent
  {
    bgTop: [10, 8, 30],
    bgBottom: [44, 14, 72],
    grid: [230, 190, 255, 0.055],
    waveGlow: [255, 120, 220, 0.50],
    trail: [255, 120, 220, 0.26],
  },
  // Midnight green -> blue
  {
    bgTop: [4, 18, 24],
    bgBottom: [10, 26, 52],
    grid: [170, 255, 210, 0.055],
    waveGlow: [120, 255, 180, 0.52],
    trail: [120, 255, 180, 0.28],
  },
];

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function lerp4(a: [number, number, number, number], b: [number, number, number, number], t: number): [number, number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
}

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp(a, 0, 1).toFixed(3)})`;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function pointInTri(px: number, py: number, t: SpikeTri): boolean {
  // Barycentric technique
  const v0x = t.cx - t.ax;
  const v0y = t.cy - t.ay;
  const v1x = t.bx - t.ax;
  const v1y = t.by - t.ay;
  const v2x = px - t.ax;
  const v2y = py - t.ay;

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;

  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-6) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function pointSegDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  if (abLen2 <= 1e-6) return dist2(px, py, ax, ay);
  const t = clamp((apx * abx + apy * aby) / abLen2, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return dist2(px, py, cx, cy);
}

function circleIntersectsTri(cx: number, cy: number, r: number, t: SpikeTri): boolean {
  if (pointInTri(cx, cy, t)) return true;
  const r2 = r * r;
  if (pointSegDistSq(cx, cy, t.ax, t.ay, t.bx, t.by) <= r2) return true;
  if (pointSegDistSq(cx, cy, t.bx, t.by, t.cx, t.cy) <= r2) return true;
  if (pointSegDistSq(cx, cy, t.cx, t.cy, t.ax, t.ay) <= r2) return true;
  return false;
}

function circleIntersectsRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number): boolean {
  // rect is top-left (x,y)
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  return dist2(cx, cy, nx, ny) <= r * r;
}

function triggerHaptic(settings: Settings, type: "light" | "medium" | "heavy" | "success" | "error"): void {
  if (!settings.haptics) return;
  if (typeof (window as any).triggerHaptic === "function") {
    (window as any).triggerHaptic(type);
  }
}

class AudioFx {
  private fxCtx: AudioContext | null = null;
  private fxEnabled = true;
  private noiseBuf: AudioBuffer | null = null;

  private musicEnabled = true;
  private bgm: HTMLAudioElement | null = null;

  // Back-compat (older code called setEnabled for music)
  public setEnabled(enabled: boolean): void {
    this.setMusicEnabled(enabled);
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (!enabled) this.stopHum();
  }

  public setFxEnabled(enabled: boolean): void {
    this.fxEnabled = enabled;
  }

  private ensureFx(): AudioContext | null {
    if (!this.fxEnabled) return null;
    if (!this.fxCtx) {
      this.fxCtx = new AudioContext();
    }
    return this.fxCtx;
  }

  private ensureNoise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    // short burst of white noise (created once)
    const dur = 0.22;
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // quickly taper ends to avoid clicks in the buffer itself
      const t = i / (length - 1);
      const win = Math.sin(Math.PI * t);
      data[i] = (Math.random() * 2 - 1) * win;
    }
    this.noiseBuf = buf;
    return buf;
  }

  // We keep the method names startHum/stopHum so the rest of the game stays unchanged,
  // but the implementation is now a proper looping BGM track.
  public startHum(): void {
    if (!this.musicEnabled) return;
    if (!this.bgm) {
      const a = new Audio(bgmUrl);
      a.loop = true;
      a.preload = "auto";
      a.volume = 0.35;
      this.bgm = a;
    }
    // Play must happen from a user gesture; calls are made from Start/Resume/toggles.
    const p = this.bgm.play();
    if (p) {
      p.catch(() => {
        // ignore autoplay blocks; next user gesture will succeed
      });
    }
  }

  public stopHum(): void {
    if (!this.bgm) return;
    try {
      this.bgm.pause();
    } catch {
      // ignore
    }
  }

  public click(type: "death" | "ui"): void {
    const ctx = this.ensureFx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = type === "death" ? 210 : 420;
    gain.gain.value = 0.0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.linearRampToValueAtTime(type === "death" ? 0.11 : 0.07, ctx.currentTime + 0.01);
    gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.07);
    osc.stop(ctx.currentTime + 0.09);
  }

  public shatter(): void {
    const ctx = this.ensureFx();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Noise burst (glass-ish)
    const src = ctx.createBufferSource();
    src.buffer = this.ensureNoise(ctx);

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2200;
    bp.Q.value = 0.9;

    const ng = ctx.createGain();
    ng.gain.value = 0.0;

    src.connect(hp);
    hp.connect(bp);
    bp.connect(ng);
    ng.connect(ctx.destination);

    ng.gain.linearRampToValueAtTime(0.18, now + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    // Crack oscillator layer
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);

    const og = ctx.createGain();
    og.gain.value = 0.0;
    osc.connect(og);
    og.connect(ctx.destination);

    og.gain.linearRampToValueAtTime(0.10, now + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);

    src.start(now);
    src.stop(now + 0.22);

    osc.start(now);
    osc.stop(now + 0.12);
  }

  public tick(): void {
    const ctx = this.ensureFx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const hp = ctx.createBiquadFilter();

    hp.type = "highpass";
    hp.frequency.value = 1800;

    osc.type = "square";
    osc.frequency.value = 980;
    gain.gain.value = 0.0;

    osc.connect(hp);
    hp.connect(gain);
    gain.connect(ctx.destination);

    gain.gain.linearRampToValueAtTime(0.05, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    osc.start(now);
    osc.stop(now + 0.055);
  }
}

class LevelGen {
  private topY = 0;
  private botY = 0;
  private lastForcedUp = false;

  public reset(width: number, height: number): void {
    const h = clamp(height * 0.58, CONFIG.MIN_HEIGHT + 40, CONFIG.MAX_HEIGHT);
    this.topY = height * 0.5 - h * 0.5;
    this.botY = this.topY + h;
    this.lastForcedUp = false;
  }

  public nextChunk(
    xStart: number,
    canvasW: number,
    canvasH: number,
    meters: number,
    isEmpty: boolean,
    straightSteps?: number,
    chunkWidthPx?: number
  ): Chunk {
    const dx = CONFIG.SEG_DX;
    const widthPx = chunkWidthPx ?? CONFIG.CHUNK_WIDTH;
    const xEnd = xStart + widthPx;
    // Use ceil so we always reach xEnd exactly (important for the 100m intro which isn't divisible by SEG_DX).
    const steps = Math.ceil(widthPx / dx);
    const top: Point[] = [{ x: xStart, y: this.topY }];
    const bottom: Point[] = [{ x: xStart, y: this.botY }];

    const diff = this.difficulty01(meters);

    // Chunks alternate between "hazard-heavy" (more spikes/obstacles) and "corridor-heavy" (more zig-zag motion)
    // so we don't get empty straight roads when spikes are sparse.
    const hazardHeavy = !isEmpty && Math.random() < lerp(0.55, 0.70, diff);

    const maxStepChance = hazardHeavy ? lerp(0.30, 0.58, diff) : lerp(0.55, 0.92, diff);
    const heightTighten = lerp(0, 1, diff);

    const minH = lerp(CONFIG.MAX_HEIGHT, CONFIG.MIN_HEIGHT, heightTighten);
    const maxH = lerp(CONFIG.MAX_HEIGHT, CONFIG.MIN_HEIGHT + 110, heightTighten);

    const marginTop = CONFIG.WALL_MARGIN;
    const marginBot = canvasH - CONFIG.WALL_MARGIN;

    let x = xStart;

    // Phase-based generation: creates readable zig-zags + widen/narrow moments (still 45°/flat only)
    type Phase = "flat" | "slopeUp" | "slopeDown" | "widen" | "narrow";
    let phase: Phase = "flat";
    let phaseLeft = 0;
    let flatRun = 0;
    let lastSlopeUp = false;
    let straightRun = 0;

    const straightCount = isEmpty ? clamp(straightSteps ?? steps, 0, steps) : 0;

    for (let i = 0; i < steps; i++) {
      const x2 = Math.min(x + dx, xEnd);

      let dyTop = 0;
      let dyBot = 0;

      // Opening run: force a straight corridor for a short portion of the first chunk.
      // This guarantees a clean start, but does not stay straight for too long.
      if (isEmpty && i < straightCount) {
        this.topY = this.topY;
        this.botY = this.botY;
        top.push({ x: x2, y: this.topY });
        bottom.push({ x: x2, y: this.botY });
        x = x2;
        // Prevent duplicating the final point when widthPx isn't divisible by dx.
        if (x >= xEnd - 0.001) break;
        continue;
      }

      // Choose/refresh a short phase every few segments
      if (phaseLeft <= 0) {
        const r = Math.random();
        // Early game: more flat; later: more slopes and width changes
        const widenMul = hazardHeavy ? 1.0 : 1.55;
        const slopeMul = hazardHeavy ? 1.0 : 1.65;
        const pWiden = clamp(lerp(0.10, 0.18, diff) * widenMul, 0, 0.38);
        const pNarrow = clamp(lerp(0.08, 0.16, diff) * widenMul, 0, 0.34);
        const pSlope = clamp(lerp(0.22, 0.40, diff) * slopeMul, 0, 0.70);
        if (r < pWiden) phase = "widen";
        else if (r < pWiden + pNarrow) phase = "narrow";
        else if (r < pWiden + pNarrow + pSlope) {
          // Corridor-heavy: force an obvious zig-zag by alternating slope direction.
          if (!hazardHeavy) {
            lastSlopeUp = !lastSlopeUp;
            phase = lastSlopeUp ? "slopeUp" : "slopeDown";
          } else {
            phase = Math.random() < 0.5 ? "slopeUp" : "slopeDown";
          }
        }
        else phase = "flat";

        // Short, punchy patterns; corridor-heavy chunks get longer motion phases
        phaseLeft = hazardHeavy ? Math.floor(lerp(2, 4, diff) + Math.random() * 2) : Math.floor(lerp(3, 6, diff) + Math.random() * 2);
      }
      phaseLeft--;

      // Apply phase (still may be overridden by randomness below)
      if (phase === "slopeUp") {
        dyTop = -dx;
        dyBot = -dx;
      } else if (phase === "slopeDown") {
        dyTop = dx;
        dyBot = dx;
      } else if (phase === "widen") {
        dyTop = -dx;
        dyBot = dx;
      } else if (phase === "narrow") {
        dyTop = dx;
        dyBot = -dx;
      }

      // Add some extra micro-variation inside the phase (keeps it from feeling scripted)
      // Choose changes in {-dx,0,dx} so edges are 0° or 45° only
      if (Math.random() < maxStepChance * 0.55) {
        dyTop += this.pickDy(dx, diff);
      }
      if (Math.random() < maxStepChance * 0.55) {
        dyBot += this.pickDy(dx, diff);
      }

      // Keep deltas within one 45° step.
      dyTop = clamp(dyTop, -dx, dx);
      dyBot = clamp(dyBot, -dx, dx);

      // Prevent long "do nothing" straight runs (no slope + no widen/narrow).
      // Even if hazards are sparse, we want gentle action.
      if (dyTop === 0 && dyBot === 0) straightRun++;
      else straightRun = 0;

      const maxStraight = hazardHeavy ? Math.floor(lerp(2, 3, diff)) : Math.floor(lerp(1, 2, diff));
      if (straightRun > maxStraight) {
        // Force a gentle zig-zag or widen/narrow (still 45° only)
        const up = this.lastForcedUp ? false : true;
        this.lastForcedUp = up;

        // Prefer a mild slope move more often than a width change (less extreme)
        const doWidth = Math.random() < lerp(0.25, 0.40, diff);
        if (doWidth) {
          dyTop = up ? -dx : dx;
          dyBot = up ? dx : -dx;
        } else {
          dyTop = up ? -dx : dx;
          dyBot = up ? -dx : dx;
        }
        straightRun = 0;
        flatRun = 0;
      }

      // Corridor-heavy chunks: prevent long flat runs so it doesn't feel like a straight road.
      if (!hazardHeavy) {
        if (dyTop === 0 && dyBot === 0) flatRun++;
        else flatRun = 0;
        if (flatRun >= 2) {
          const up = (i & 1) === 0;
          dyTop = up ? -dx : dx;
          dyBot = up ? -dx : dx;
          flatRun = 0;
        }
      }

      let t2 = this.topY + dyTop;
      let b2 = this.botY + dyBot;

      // Enforce bounds
      t2 = clamp(t2, marginTop, marginBot - minH);
      b2 = clamp(b2, marginTop + minH, marginBot);

      // Enforce corridor height window
      let h = b2 - t2;
      if (h < minH) {
        const push = (minH - h) * 0.5;
        t2 = clamp(t2 - push, marginTop, marginBot - minH);
        b2 = clamp(b2 + push, marginTop + minH, marginBot);
        h = b2 - t2;
      }
      if (h > maxH) {
        const pull = (h - maxH) * 0.5;
        t2 = clamp(t2 + pull, marginTop, marginBot - minH);
        b2 = clamp(b2 - pull, marginTop + minH, marginBot);
      }

      // Re-quantize to keep 45°/flat: make deltas exactly -dx/0/+dx relative to previous
      t2 = this.quantizeStep(this.topY, t2, dx);
      b2 = this.quantizeStep(this.botY, b2, dx);

      // Final safety for min height after quantization
      if (b2 - t2 < minH) {
        // prefer moving bottom away from top
        const need = minH - (b2 - t2);
        b2 = clamp(b2 + need, marginTop + minH, marginBot);
        b2 = this.quantizeStep(this.botY, b2, dx);
        if (b2 - t2 < minH) {
          // fallback: flatten both
          t2 = this.topY;
          b2 = this.botY;
        }
      }

      this.topY = t2;
      this.botY = b2;
      top.push({ x: x2, y: this.topY });
      bottom.push({ x: x2, y: this.botY });
      x = x2;
    }

    const chunk: Chunk = {
      xStart,
      xEnd: xStart + widthPx,
      top,
      bottom,
      spikes: [],
      blocks: [],
      wheels: [],
    };

    if (!isEmpty) {
      this.addSurfaceSpikes(chunk, meters);
      this.addBlocks(chunk, meters, canvasH, minH);
      this.addWheels(chunk, meters, canvasH, minH);

      // Guarantee: never leave a chunk "empty". If hazards are too sparse, force a small ground/ceiling spike cluster.
      this.ensureChunkHasAction(chunk, meters);
    }

    return chunk;
  }

  private ensureChunkHasAction(chunk: Chunk, meters: number): void {
    // "Something" means: any spikes, any block, or any wheel.
    // If we end up with nothing (or basically nothing), force a small surface spike cluster on a safe flat.
    const diff = this.difficulty01(meters);
    const hazardCount = chunk.spikes.length + chunk.blocks.length + chunk.wheels.length;

    // As difficulty ramps, we want most chunks to contain at least a few spikes
    // (even if there's also a block/wheel), to keep pressure consistent.
    const targetSpikes = clamp(Math.floor(lerp(2, 6, diff)), 2, 6);
    if (hazardCount >= 1 && chunk.spikes.length >= targetSpikes) return;

    // If we already have a wheel or a block, that's usually enough to avoid emptiness.
    // But if the chunk is otherwise very quiet, add a tiny surface cluster anyway.
    const shouldAddCluster =
      hazardCount === 0 ||
      chunk.spikes.length < targetSpikes && Math.random() < lerp(0.55, 0.80, diff);
    if (!shouldAddCluster) return;

    const placeCluster = (useTop: boolean): boolean => {
      const path = useTop ? chunk.top : chunk.bottom;

      // Find flat segments that are NOT right next to slopes (corner flats).
      const candidates: Array<{ i: number; a: Point; b: Point }> = [];
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const isFlat = Math.abs(b.y - a.y) < 0.1;
        if (!isFlat) continue;

        const prevIsSlope = i > 0 ? Math.abs(path[i].y - path[i - 1].y) > 0.1 : true;
        const nextIsSlope = i + 2 < path.length ? Math.abs(path[i + 2].y - path[i + 1].y) > 0.1 : true;
        const isCornerFlat = prevIsSlope || nextIsSlope;
        if (isCornerFlat) continue;

        candidates.push({ i, a, b });
      }

      if (candidates.length === 0) return false;

      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const segLen = pick.b.x - pick.a.x;
      const maxCount = Math.max(2, Math.floor((segLen - CONFIG.SPIKE_W) / CONFIG.SPIKE_SPACING));
      if (maxCount <= 0) return false;

      const clusterCount = clamp(Math.floor(lerp(3, 6, diff)), 3, 6);
      const count = Math.min(maxCount, clusterCount);

      const inset = CONFIG.SPIKE_W * 0.7;
      const centerX = (pick.a.x + pick.b.x) * 0.5;
      const startX = centerX - ((count - 1) * CONFIG.SPIKE_SPACING) * 0.5;

      for (let j = 0; j < count; j++) {
        const cx = clamp(startX + j * CONFIG.SPIKE_SPACING, pick.a.x + inset, pick.b.x - inset);
        chunk.spikes.push(this.makeSpike(cx, pick.a.y, useTop));
      }
      return true;
    };

    // Choose top vs bottom, bias bottom slightly for readability.
    const useTop = Math.random() < 0.42;
    const did1 = placeCluster(useTop);

    // Later-game: occasionally add a second cluster on the opposite surface for more spike presence.
    if (did1 && diff > 0.70 && chunk.spikes.length < targetSpikes && Math.random() < 0.35) {
      placeCluster(!useTop);
    }
  }

  private difficulty01(meters: number): number {
    if (meters <= CONFIG.DIFF_START_EASY_METERS) return 0;
    return clamp((meters - CONFIG.DIFF_START_EASY_METERS) / CONFIG.DIFF_RAMP_METERS, 0, 1);
  }

  private pickDy(dx: number, diff: number): number {
    // Early game: more flats; later: more up/down turns
    const r = Math.random();
    const turnBias = lerp(0.18, 0.45, diff);
    if (r < 1 - turnBias) return 0;
    return Math.random() < 0.5 ? -dx : dx;
  }

  private quantizeStep(prevY: number, targetY: number, dx: number): number {
    const dy = targetY - prevY;
    if (dy > dx * 0.5) return prevY + dx;
    if (dy < -dx * 0.5) return prevY - dx;
    return prevY;
  }

  private addSurfaceSpikes(chunk: Chunk, meters: number): void {
    const diff = this.difficulty01(meters);
    // Spikes should be present often (especially later), but still fair/readable.
    const pStrip = lerp(0.24, 0.62, diff);
    const density = lerp(0.44, 0.74, diff); // within a chosen strip, how many spikes to actually place
    const maxSpikesPerChunk = clamp(Math.floor(lerp(16, 34, diff)), 14, 40);

    // spikes only on flat segments (matches frames readability)
    const addStrip = (a: Point, b: Point, isTop: boolean): void => {
      if (chunk.spikes.length >= maxSpikesPerChunk) return;
      const len = b.x - a.x;
      const count = Math.floor((len - CONFIG.SPIKE_W) / CONFIG.SPIKE_SPACING);
      if (count <= 0) return;
      const inset = CONFIG.SPIKE_W * 0.7;

      // Choose a smaller window inside this flat segment, so it's not a full carpet.
      const windowCount = Math.max(1, Math.floor(count * lerp(0.48, 0.78, diff)));
      const start = Math.floor(Math.random() * Math.max(1, count - windowCount + 1));

      for (let i = start; i < start + windowCount; i++) {
        if (chunk.spikes.length >= maxSpikesPerChunk) break;
        if (Math.random() > density) continue;
        const cx = a.x + inset + i * CONFIG.SPIKE_SPACING;
        const baseY = isTop ? a.y : a.y;
        chunk.spikes.push(this.makeSpike(cx, baseY, isTop));
      }
    };

    for (let i = 0; i < chunk.top.length - 1; i++) {
      const a = chunk.top[i];
      const b = chunk.top[i + 1];
      // Never place spikes on "corner flats" right next to slopes.
      // This prevents the player from dying when sliding onto a slope.
      const isFlat = Math.abs(b.y - a.y) < 0.1;
      const prevIsSlope = i > 0 ? Math.abs(chunk.top[i].y - chunk.top[i - 1].y) > 0.1 : true;
      const nextIsSlope = i + 2 < chunk.top.length ? Math.abs(chunk.top[i + 2].y - chunk.top[i + 1].y) > 0.1 : true;
      const isCornerFlat = prevIsSlope || nextIsSlope;

      if (isFlat && !isCornerFlat && Math.random() < pStrip) {
        addStrip(a, b, true);
      }
    }

    for (let i = 0; i < chunk.bottom.length - 1; i++) {
      const a = chunk.bottom[i];
      const b = chunk.bottom[i + 1];
      const isFlat = Math.abs(b.y - a.y) < 0.1;
      const prevIsSlope = i > 0 ? Math.abs(chunk.bottom[i].y - chunk.bottom[i - 1].y) > 0.1 : true;
      const nextIsSlope = i + 2 < chunk.bottom.length ? Math.abs(chunk.bottom[i + 2].y - chunk.bottom[i + 1].y) > 0.1 : true;
      const isCornerFlat = prevIsSlope || nextIsSlope;

      if (isFlat && !isCornerFlat && Math.random() < pStrip) {
        addStrip(a, b, false);
      }
    }
  }

  private addBlocks(chunk: Chunk, meters: number, canvasH: number, minH: number): void {
    const diff = this.difficulty01(meters);
    const pBlock = lerp(0.35, 0.75, diff);

    // Allow up to 2 blocks per chunk (well spaced) for more consistent action.
    const maxBlocks = diff < 0.30 ? 2 : diff < 0.70 ? 2 : 3;
    const minSpacingX = 240;

    const tooClose = (x: number): boolean => {
      for (const b of chunk.blocks) if (Math.abs(b.x - x) < minSpacingX) return true;
      for (const w of chunk.wheels) if (Math.abs(w.x - x) < minSpacingX) return true;
      return false;
    };

    // Candidate lanes (left->right) so obstacles are distributed instead of clumped.
    const placements = [0.26, 0.44, 0.62, 0.80];
    for (let pi = 0; pi < placements.length && chunk.blocks.length < maxBlocks; pi++) {
      if (Math.random() > pBlock) continue;
      const jitter = (Math.random() * 2 - 1) * 0.06;
      const x = chunk.xStart + CONFIG.CHUNK_WIDTH * clamp(placements[pi] + jitter, 0.18, 0.90);
      if (tooClose(x)) continue;

      const c = this.corridorAtX(chunk, x);
      const corridorH = c.bottomY - c.topY;
      const maxBlockH = corridorH - minH * 0.55;
      if (maxBlockH < 70) continue;

      // Smaller than before (avoid huge rectangles)
      const w = lerp(76, 126, Math.random());
      const h = clamp(lerp(64, maxBlockH * 0.75, Math.random()), 56, 160);
      // Always center floating obstacles in the corridor (clean + fair)
      const y = c.topY + corridorH * 0.5 - h * 0.5;

      // Safety: keep block within corridor
      if (y < c.topY + 10) continue;
      if (y + h > c.bottomY - 10) continue;
      if (x - w * 0.5 < chunk.xStart + 40) continue;
      if (x + w * 0.5 > chunk.xEnd - 40) continue;

      const block: Block = { x, y, w, h, seed: Math.random(), spikes: [] };
      // NOTE: Spikes are ground/ceiling only. Floating obstacles never add spikes.
      chunk.blocks.push(block);
    }
  }

  // Rolling spike wheels (static in world, visually rotating)
  private addWheels(chunk: Chunk, meters: number, canvasH: number, minH: number): void {
    // Low chance early, higher chance later
    const diff = this.difficulty01(meters);
    const pWheel = lerp(0.12, 0.30, diff);

    // Wheels: max 1 early, max 2 later; keep spacing from other obstacles.
    const maxWheels = diff < 0.65 ? 1 : 2;
    const minSpacingX = 240;
    const pickX = (): number => {
      const base = Math.random() < 0.5 ? 0.45 : 0.72;
      const jitter = (Math.random() * 2 - 1) * 0.06;
      return chunk.xStart + CONFIG.CHUNK_WIDTH * clamp(base + jitter, 0.22, 0.88);
    };

    const canPlaceAtX = (x: number): boolean => {
      for (const b of chunk.blocks) if (Math.abs(b.x - x) < minSpacingX) return false;
      for (const w of chunk.wheels) if (Math.abs(w.x - x) < minSpacingX) return false;
      return true;
    };

    const tryPlaceWheel = (): void => {
      if (Math.random() > pWheel) return;
      if (chunk.wheels.length >= maxWheels) return;

      // Try a couple candidate spots so we don't frequently fail due to spacing.
      for (let attempt = 0; attempt < 3; attempt++) {
        const x = pickX();
        if (!canPlaceAtX(x)) continue;

        const c = this.corridorAtX(chunk, x);
        const corridorH = c.bottomY - c.topY;

        // Radius based on corridor height (leave margin)
        const maxRadius = (corridorH - minH * 0.4) * 0.5;
        if (maxRadius < 24) continue;
        const radius = lerp(26, Math.min(60, maxRadius), Math.random());

        const y = c.topY + corridorH * 0.5;

        // Safety margins
        if (y - radius < c.topY + 10) continue;
        if (y + radius > c.bottomY - 10) continue;

        chunk.wheels.push({ x, y, radius });
        return;
      }
    };

    tryPlaceWheel();
    tryPlaceWheel();
  }

  private corridorAtX(chunk: Chunk, x: number): { topY: number; bottomY: number } {
    const sample = (path: Point[]): number => {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        if (x >= a.x && x <= b.x) {
          const t = (x - a.x) / (b.x - a.x || 1);
          return lerp(a.y, b.y, t);
        }
      }
      return path[path.length - 1].y;
    };
    return { topY: sample(chunk.top), bottomY: sample(chunk.bottom) };
  }

  private makeSpike(cx: number, baseY: number, fromTop: boolean): SpikeTri {
    const scale = CONFIG.SPIKE_SCALE_MIN + Math.random() * (CONFIG.SPIKE_SCALE_MAX - CONFIG.SPIKE_SCALE_MIN);
    const w = CONFIG.SPIKE_W * scale;
    const h = CONFIG.SPIKE_H * scale;
    if (fromTop) {
      // base on top surface, tip down into corridor
      return {
        ax: cx,
        ay: baseY + h,
        bx: cx - w * 0.5,
        by: baseY,
        cx: cx + w * 0.5,
        cy: baseY,
      };
    }
    // base on bottom surface, tip up into corridor
    return {
      ax: cx,
      ay: baseY - h,
      bx: cx - w * 0.5,
      by: baseY,
      cx: cx + w * 0.5,
      cy: baseY,
    };
  }
}

class WaveModeGame {
  private gameContainer = document.getElementById("game-container") as HTMLElement;
  private canvas: HTMLCanvasElement;
  // Display canvas context (final blit target)
  private displayCtx: CanvasRenderingContext2D;
  // Render context (either displayCtx, or a low-res offscreen buffer in pixel-art mode)
  private ctx: CanvasRenderingContext2D;
  private renderCanvas: HTMLCanvasElement | null = null;
  private renderCtx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private renderScale = 1;
  private scanlinePattern: CanvasPattern | null = null;

  private state: GameState = "START";
  private lastT = performance.now();

  private settings: Settings = { music: true, fx: true, haptics: true };

  private audio = new AudioFx();

  private waveX = 0;
  private waveY = 0; // screen-space (derived from waveWorldY - camY)
  private waveWorldY = 0; // world-space (physics position; camera must not affect this)
  private holding = false;
  private scrollX = 0;
  private meters = 0;
  private sessionBestMeters = 0;
  private speedMul = 1;
  private isSlidingOnSurface = false; // true when clamped to roof/ground

  private camY = 0;
  private shakeT = 0;
  private shakeX = 0;
  private shakeY = 0;
  private deathFlashT = 0;
  private deathDelayT = 0; // seconds before showing Game Over UI

  private trail: TrailPoint[] = [];
  private deathShards: DeathShard[] = [];
  private stars: Array<{
    x: number;
    y: number;
    size: number;
    twinkle: number;
    speed: number;
    baseAlpha: number;
  }> = [];
  private planets: BgPlanet[] = [];
  private runtimePalette: RuntimePalette = {
    bgTop: CONFIG.BG_TOP,
    bgBottom: CONFIG.BG_BOTTOM,
    grid: CONFIG.GRID_COLOR,
    waveGlow: CONFIG.WAVE_GLOW,
    trail: CONFIG.TRAIL,
  };

  // Cached wall pattern (huge perf win vs drawing thousands of tiny shapes every frame)
  private wallPattern: CanvasPattern | null = null;
  private wallPatternTile: HTMLCanvasElement | null = null;

  // Chunk generation queue (keeps generation work away from critical frames)
  private pendingChunkStarts: number[] = [];
  private plannedXEnd = 0;

  private gen = new LevelGen();
  private chunks: Chunk[] = [];

  // UI
  private startOverlay = document.getElementById("startOverlay") as HTMLElement;
  private gameOverOverlay = document.getElementById("gameOverOverlay") as HTMLElement;
  private pauseOverlay = document.getElementById("pauseOverlay") as HTMLElement;
  private hudEl = document.getElementById("hud") as HTMLElement;
  private distanceEl = document.getElementById("distance") as HTMLElement;
  private highScoreEl = document.getElementById("highScore") as HTMLElement;
  private finalDistanceEl = document.getElementById("finalDistance") as HTMLElement;
  private bestDistanceEl = document.getElementById("bestDistance") as HTMLElement;
  private newRecordEl = document.getElementById("newRecord") as HTMLElement;
  private pauseBtn = document.getElementById("pauseBtn") as HTMLElement;
  private settingsBtn = document.getElementById("settingsBtn") as HTMLElement;
  private settingsPanel = document.getElementById("settingsPanel") as HTMLElement;
  private settingsBackdrop = document.getElementById("settingsBackdrop") as HTMLElement;
  private settingsCloseBtn = document.getElementById("settingsCloseBtn") as HTMLElement;
  private toggleMusic = document.getElementById("toggleMusic") as HTMLElement;
  private toggleFx = document.getElementById("toggleFx") as HTMLElement;
  private toggleHaptics = document.getElementById("toggleHaptics") as HTMLElement;

  // Settings modal pauses gameplay; remember if we should resume after closing.
  private wasPlayingBeforeSettings = false;

  private counterAnimRaf = 0;

  // Logical view size (supports "force landscape" by rotating the container on mobile portrait)
  private _viewW = window.innerWidth;
  private _viewH = window.innerHeight;

  constructor() {
    this.canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const dctx = this.canvas.getContext("2d");
    if (!dctx) throw new Error("Canvas 2D context not available");
    this.displayCtx = dctx;
    this.ctx = dctx;

    this.loadSettings();
    this.applySettingsToUI();

    this.onResize();
    this.generateStars();
    window.addEventListener("resize", () => this.onResize());

    this.setupInput();
    this.setupUI();

    this.resetRun();
    requestAnimationFrame(() => this.loop());
  }

  private viewW(): number {
    return this._viewW;
  }

  private viewH(): number {
    return this._viewH;
  }


  private onResize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;

    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    const isPortrait = window.innerHeight > window.innerWidth;
    const forceLandscape = isMobile && isPortrait;

    // Rotate the entire game container in mobile-portrait so gameplay is landscape.
    // This works even in browser "mobile mode" where orientation.lock is unavailable.
    if (forceLandscape) {
      this._viewW = window.innerHeight;
      this._viewH = window.innerWidth;
      this.gameContainer.style.position = "fixed";
      this.gameContainer.style.left = "50%";
      this.gameContainer.style.top = "50%";
      this.gameContainer.style.width = `${window.innerHeight}px`;
      this.gameContainer.style.height = `${window.innerWidth}px`;
      this.gameContainer.style.transform = "translate(-50%, -50%) rotate(90deg)";
      this.gameContainer.style.transformOrigin = "center center";
    } else {
      this._viewW = window.innerWidth;
      this._viewH = window.innerHeight;
      this.gameContainer.style.position = "relative";
      this.gameContainer.style.left = "0";
      this.gameContainer.style.top = "0";
      this.gameContainer.style.width = "100%";
      this.gameContainer.style.height = "100%";
      this.gameContainer.style.transform = "none";
      this.gameContainer.style.transformOrigin = "center center";
    }

    this.canvas.width = Math.floor(this._viewW * dpr);
    this.canvas.height = Math.floor(this._viewH * dpr);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";

    // Pixel-art mode renders to a smaller offscreen canvas and scales it up with nearest-neighbor.
    if (CONFIG.PIXEL_ART) {
      this.renderScale = isMobile ? CONFIG.PIXEL_RENDER_SCALE_MOBILE : CONFIG.PIXEL_RENDER_SCALE_DESKTOP;
      if (!this.renderCanvas) {
        this.renderCanvas = document.createElement("canvas");
        const rctx = this.renderCanvas.getContext("2d");
        if (!rctx) throw new Error("Render Canvas 2D context not available");
        this.renderCtx = rctx;
      }

      const rc = this.renderCanvas;
      const rctx = this.renderCtx as CanvasRenderingContext2D;
      // IMPORTANT: Do NOT multiply by DPR here. We want an intentionally lower-res internal buffer.
      // Keep game coordinates in CSS pixels via a scale transform.
      rc.width = Math.max(1, Math.floor(this._viewW * this.renderScale));
      rc.height = Math.max(1, Math.floor(this._viewH * this.renderScale));
      rctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
      this.ctx = rctx;

      // Display context is used only for the final upscale blit.
      this.displayCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.displayCtx.imageSmoothingEnabled = false;
      this.scanlinePattern = null;
    } else {
      this.ctx = this.displayCtx;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Regenerate stars for new viewport size
    this.generateStars();
    this.generatePlanets();
    this.rebuildWallPattern();

    if (this.chunks.length === 0) {
      this.resetRun();
    }
  }

  private resetRun(): void {
    this.scrollX = 0;
    this.meters = 0;
    this.speedMul = CONFIG.SPEED_BASE;
    this.waveX = this.viewW() * 0.22;
    this.camY = 0;
    this.waveWorldY = this.viewH() * 0.52;
    this.waveY = this.waveWorldY - this.camY;
    this.trail = [];
    this.holding = false;

    this.gen.reset(this.viewW(), this.viewH());
    this.chunks = [];
    this.pendingChunkStarts = [];

    // Intro: always start with a straight corridor and no obstacles for the first 100m.
    const introPx = CONFIG.INTRO_SAFE_METERS * 10; // meters are worldX/10
    const introChunk = this.gen.nextChunk(0, this.viewW(), this.viewH(), 0, true, undefined, introPx);
    this.chunks.push(introChunk);

    // Then prebuild a few normal chunks.
    let x = introPx;
    for (let i = 0; i < 5; i++) {
      const m = x / 10;
      const c = this.gen.nextChunk(x, this.viewW(), this.viewH(), m, false);
      this.chunks.push(c);
      x += CONFIG.CHUNK_WIDTH;
    }
    this.plannedXEnd = x;
  }

  // Create a star field for the background (twinkling, slight parallax).
  private generateStars(): void {
    const w = this.viewW();
    const h = this.viewH();
    this.stars = [];
    for (let i = 0; i < CONFIG.STAR_COUNT; i++) {
      this.stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: Math.random() * 1.6 + 0.4, // small dots
        twinkle: Math.random() * Math.PI * 2,
        speed: 0.03 + Math.random() * 0.05, // slow parallax
        baseAlpha: 0.25 + Math.random() * 0.35,
      });
    }
  }

  private generatePlanets(): void {
    const w = this.viewW();
    const h = this.viewH();
    this.planets = [];

    // A small curated palette for "16-bit space"
    const palettes: Array<{ base: string; shade: string }> = [
      { base: "#6e4cff", shade: "#2c1a75" }, // purple
      { base: "#28d7c7", shade: "#0a4f57" }, // teal
      { base: "#ff4fd1", shade: "#6b104a" }, // magenta
      { base: "#ffd166", shade: "#6b3a0a" }, // warm gold
    ];

    const count = CONFIG.PLANET_COUNT;
    for (let i = 0; i < count; i++) {
      const p = palettes[i % palettes.length];
      const r = lerp(h * 0.08, h * 0.20, Math.random());
      const x = Math.random() * w;
      const y = lerp(h * 0.10, h * 0.55, Math.random());
      this.planets.push({
        x,
        y,
        r,
        speed: 0.012 + Math.random() * 0.022,
        alpha: 0.18 + Math.random() * 0.16,
        base: p.base,
        shade: p.shade,
        ring: Math.random() < 0.55,
        ringTilt: (Math.random() * 2 - 1) * 0.55,
        bandPhase: Math.random() * Math.PI * 2,
      });
    }

    // Big "hero" planet offscreen-ish so it peeks in (adds depth)
    this.planets.push({
      x: w * 0.88,
      y: h * 0.22,
      r: h * 0.28,
      speed: 0.008,
      alpha: 0.14,
      base: "#2de2ff",
      shade: "#0b2b6b",
      ring: true,
      ringTilt: -0.22,
      bandPhase: 1.2,
    });
  }

  private updateRuntimePalette(): void {
    // Drift palette primarily during gameplay, keyed off distance traveled.
    // Outside gameplay, keep the base palette stable.
    const keys = PALETTE_KEYFRAMES;
    if (keys.length === 0) return;

    const meters = this.state === "PLAYING" ? this.meters : 0;
    const phase = meters / Math.max(1, CONFIG.PALETTE_SHIFT_METERS);
    const i0 = ((Math.floor(phase) % keys.length) + keys.length) % keys.length;
    const i1 = (i0 + 1) % keys.length;
    const t = smoothstep(phase - Math.floor(phase));

    const a = keys[i0];
    const b = keys[i1];

    const bgTop = lerp3(a.bgTop, b.bgTop, t);
    const bgBottom = lerp3(a.bgBottom, b.bgBottom, t);
    const grid = lerp4(a.grid, b.grid, t);
    const glow = lerp4(a.waveGlow, b.waveGlow, t);
    const trail = lerp4(a.trail, b.trail, t);

    this.runtimePalette.bgTop = rgb(bgTop[0], bgTop[1], bgTop[2]);
    this.runtimePalette.bgBottom = rgb(bgBottom[0], bgBottom[1], bgBottom[2]);
    this.runtimePalette.grid = rgba(grid[0], grid[1], grid[2], grid[3]);
    this.runtimePalette.waveGlow = rgba(glow[0], glow[1], glow[2], glow[3]);
    this.runtimePalette.trail = rgba(trail[0], trail[1], trail[2], trail[3]);
  }

  private setupUI(): void {
    const playBtn = document.getElementById("playBtn");
    const optionsBtn = document.getElementById("optionsBtn");
    const restartBtn = document.getElementById("restartBtn");
    const menuBtn = document.getElementById("menuBtn");
    const resumeBtn = document.getElementById("resumeBtn");

    playBtn?.addEventListener("click", () => {
      this.uiClick();
      this.start();
    });

    optionsBtn?.addEventListener("click", () => {
      this.uiClick();
      this.toggleSettings();
      triggerHaptic(this.settings, "light");
    });
    restartBtn?.addEventListener("click", () => {
      this.uiClick();
      this.restart();
    });

    menuBtn?.addEventListener("click", () => {
      this.uiClick();
      this.showMenu();
      triggerHaptic(this.settings, "light");
    });
    resumeBtn?.addEventListener("click", () => {
      this.uiClick();
      this.resume();
    });

    this.pauseBtn.addEventListener("click", () => {
      this.uiClick();
      if (this.state === "PLAYING") this.pause();
      else if (this.state === "PAUSED") this.resume();
    });

    this.settingsBtn.addEventListener("click", () => {
      this.uiClick();
      this.toggleSettings();
    });

    this.settingsCloseBtn.addEventListener("click", () => {
      this.uiClick();
      this.setSettingsOpen(false);
      triggerHaptic(this.settings, "light");
    });

    this.settingsBackdrop.addEventListener("click", () => {
      this.uiClick();
      this.setSettingsOpen(false);
      triggerHaptic(this.settings, "light");
    });

    const toggle = (el: HTMLElement, key: keyof Settings) => {
      el.addEventListener("click", () => {
        (this.settings as any)[key] = !this.settings[key];
        this.saveSettings();
        this.applySettingsToUI();
        triggerHaptic(this.settings, "light");
        if (key === "music") {
          this.audio.setMusicEnabled(this.settings.music);
          if (this.state === "PLAYING" && this.settings.music) this.audio.startHum();
          if (!this.settings.music) this.audio.stopHum();
        }
        if (key === "fx") {
          this.audio.setFxEnabled(this.settings.fx);
        }
      });
    };
    toggle(this.toggleMusic, "music");
    toggle(this.toggleFx, "fx");
    toggle(this.toggleHaptics, "haptics");
  }

  private uiClick(): void {
    if (this.settings.fx) this.audio.click("ui");
  }

  private toggleSettings(): void {
    const isOpen = this.settingsPanel.classList.contains("open");
    this.setSettingsOpen(!isOpen);
  }

  private setSettingsOpen(open: boolean): void {
    if (open) {
      // Pause the game while the modal is open (do NOT show pause overlay)
      this.wasPlayingBeforeSettings = this.state === "PLAYING";
      if (this.wasPlayingBeforeSettings) {
        this.state = "PAUSED";
        this.pauseOverlay.classList.add("hidden");
      }
      this.settingsPanel.classList.add("open");
      this.settingsPanel.setAttribute("aria-hidden", "false");
    } else {
      this.settingsPanel.classList.remove("open");
      this.settingsPanel.setAttribute("aria-hidden", "true");
      if (this.wasPlayingBeforeSettings) {
        this.wasPlayingBeforeSettings = false;
        this.state = "PLAYING";
      }
    }
  }

  private applySettingsToUI(): void {
    this.toggleMusic.classList.toggle("active", this.settings.music);
    this.toggleFx.classList.toggle("active", this.settings.fx);
    this.toggleHaptics.classList.toggle("active", this.settings.haptics);
    this.highScoreEl.textContent = `Best: ${Math.floor(this.sessionBestMeters)}m`;
  }

  private loadSettings(): void {
    try {
      const s = localStorage.getItem("waveModeSettings");
      if (s) this.settings = { ...this.settings, ...JSON.parse(s) };
    } catch {
      // ignore
    }
    this.audio.setMusicEnabled(this.settings.music);
    this.audio.setFxEnabled(this.settings.fx);
  }

  private saveSettings(): void {
    localStorage.setItem("waveModeSettings", JSON.stringify(this.settings));
  }

  private setupInput(): void {
    // More reliable “previous” style controls:
    // - Pointer + Space are tracked independently
    // - Press on START begins the run immediately
    // - Press on GAME_OVER restarts immediately (no extra click)
    // - Press on PAUSED resumes immediately
    let pointerDown = false;
    let spaceDown = false;

    const syncHolding = (): void => {
      this.holding = pointerDown || spaceDown;
    };

    const handlePress = (e: Event): void => {
      // If options are open, do NOT resume/restart on press. Close the modal first.
      if (this.settingsPanel.classList.contains("open")) {
        e.preventDefault();
        this.setSettingsOpen(false);
        triggerHaptic(this.settings, "light");
        return;
      }
      // During death shatter, ignore press (prevents skipping the VFX)
      if (this.state === "DYING") {
        e.preventDefault();
        return;
      }
      // Start should ONLY happen via the Start Game button (no tap-anywhere start).
      if (this.state === "START") {
        e.preventDefault();
        return;
      }
      // Restart/resume are still tap-anywhere for responsiveness.
      if (this.state === "GAME_OVER") {
        this.restart();
      } else if (this.state === "PAUSED") {
        this.resume();
      }
      e.preventDefault();
    };

    const shouldIgnoreGlobalPress = (e: Event): boolean => {
      const t = e.target;
      if (!(t instanceof Element)) return false;

      // If the press began on a UI control or inside a modal/overlay, do NOT treat it as a
      // "tap anywhere to restart/resume" press. Otherwise UI buttons (Menu/Restart/etc)
      // get overridden by the global handler.
      if (t.closest("button")) return true;
      if (t.closest("#settingsPanel")) return true;
      if (t.closest("#startOverlay")) return true;
      if (t.closest("#gameOverOverlay")) return false; // allow tapping empty gameover to restart
      if (t.closest("#pauseOverlay")) return false; // allow tapping empty pause overlay to resume
      return false;
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (shouldIgnoreGlobalPress(e)) {
        e.preventDefault();
        return;
      }
      pointerDown = true;
      handlePress(e);
      syncHolding();
    };
    const onPointerUp = (e: PointerEvent): void => {
      pointerDown = false;
      e.preventDefault();
      syncHolding();
    };

    // Pointer events cover mouse + touch + pen and handle multi-device better.
    window.addEventListener("pointerdown", onPointerDown, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        spaceDown = true;
        // Do not start from menu with Space; only via Start Game button.
        if (this.state !== "START") handlePress(e);
        syncHolding();
        return;
      }
      if (e.code === "Escape") {
        // Close options first (modal has priority over pause)
        if (this.settingsPanel.classList.contains("open")) {
          e.preventDefault();
          this.setSettingsOpen(false);
          triggerHaptic(this.settings, "light");
          return;
        }
        e.preventDefault();
        if (this.state === "PLAYING") this.pause();
        else if (this.state === "PAUSED") this.resume();
      }
    });

    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        spaceDown = false;
        e.preventDefault();
        syncHolding();
      }
      if (e.code === "Escape") {
        // No-op: Escape is handled on keydown (so the close feels instant)
      }
    });

    window.addEventListener("blur", () => {
      pointerDown = false;
      spaceDown = false;
      syncHolding();
    });
  }

  private start(): void {
    this.state = "PLAYING";

    // Animate menu -> play
    if (!this.startOverlay.classList.contains("hidden")) {
      this.startOverlay.classList.add("leaving");
      window.setTimeout(() => {
        this.startOverlay.classList.add("hidden");
        this.startOverlay.classList.remove("leaving");
      }, 360);
    }
    this.gameOverOverlay.classList.add("hidden");
    this.pauseOverlay.classList.add("hidden");

    // Bring gameplay UI in (animated via CSS)
    this.hudEl.classList.remove("uiHidden");
    this.pauseBtn.classList.remove("uiHidden");
    this.settingsBtn.classList.remove("uiHidden");

    if (this.settings.music) this.audio.startHum();
    triggerHaptic(this.settings, "light");
  }

  private showMenu(): void {
    // Cancel any running counter animation
    if (this.counterAnimRaf) {
      cancelAnimationFrame(this.counterAnimRaf);
      this.counterAnimRaf = 0;
    }

    // Reset run state so the menu preview is always clean
    this.resetRun();

    // Close overlays/modals and return to start
    this.state = "START";
    this.setSettingsOpen(false);
    this.pauseOverlay.classList.add("hidden");
    this.gameOverOverlay.classList.add("hidden");

    // Show menu overlay (ensure no lingering transition class)
    this.startOverlay.classList.remove("hidden");
    this.startOverlay.classList.remove("leaving");

    // Hide gameplay UI
    this.hudEl.classList.add("uiHidden");
    this.pauseBtn.classList.add("uiHidden");
    this.settingsBtn.classList.add("uiHidden");
  }

  private restart(): void {
    this.resetRun();
    this.start();
  }

  private pause(): void {
    if (this.state !== "PLAYING") return;
    this.state = "PAUSED";
    this.pauseOverlay.classList.remove("hidden");
    this.audio.stopHum();
    triggerHaptic(this.settings, "light");
  }

  private resume(): void {
    if (this.state !== "PAUSED") return;
    this.state = "PLAYING";
    this.pauseOverlay.classList.add("hidden");
    if (this.settings.music) this.audio.startHum();
    triggerHaptic(this.settings, "light");
  }

  private beginDeath(): void {
    if (this.state === "DYING" || this.state === "GAME_OVER") return;
    this.state = "DYING";
    this.deathDelayT = 0.45;

    this.audio.stopHum();
    if (this.settings.fx) {
      this.audio.click("death");
      this.audio.shatter();
    }
    triggerHaptic(this.settings, "error");

    // Spawn breaking shards from the dart position (screen space)
    this.spawnDeathShatter(this.waveX, this.waveWorldY - this.camY);

    // Close options and hide gameplay UI immediately (so the VFX reads cleanly)
    this.setSettingsOpen(false);
    this.hudEl.classList.add("uiHidden");
    this.pauseBtn.classList.add("uiHidden");
    this.settingsBtn.classList.add("uiHidden");
  }

  private finalizeGameOver(): void {
    if (this.state === "GAME_OVER") return;
    this.state = "GAME_OVER";

    const final = Math.max(0, Math.floor(this.meters));
    const prevBest = Math.max(0, Math.floor(this.sessionBestMeters));
    const nextBest = Math.max(prevBest, final);
    const isNew = final > prevBest;
    this.sessionBestMeters = nextBest;

    console.log("[WaveModeGame] Game over. Distance:", final);
    // Animate counters (distance + best)
    this.newRecordEl.style.display = isNew ? "block" : "none";
    this.animateGameOverCounters(final, nextBest);

    // Update HUD best (session-only)
    this.highScoreEl.textContent = `Best: ${nextBest}m`;
    this.gameOverOverlay.classList.remove("hidden");
    this.pauseOverlay.classList.add("hidden");

    // Submit score to platform (no local highscore tracking)
    if (typeof (window as any).submitScore === "function") {
      (window as any).submitScore(final);
    }
  }

  private animateGameOverCounters(finalMeters: number, bestMeters: number): void {
    if (this.counterAnimRaf) cancelAnimationFrame(this.counterAnimRaf);

    const start = performance.now();
    const dur = 1500; // slower count-up

    // Rate-limited ticking so it feels good and never spams
    let lastTickValue = 0;
    const step = finalMeters <= 90 ? 1 : finalMeters <= 220 ? 2 : finalMeters <= 520 ? 5 : 10;

    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
    const tick = (): void => {
      const now = performance.now();
      const t = clamp((now - start) / dur, 0, 1);
      const e = easeOutCubic(t);

      const d = Math.floor(finalMeters * e);
      const b = Math.floor(bestMeters * e);

      this.finalDistanceEl.textContent = `Distance: ${d}m`;
      this.bestDistanceEl.textContent = `Best: ${b}m`;

      if (this.settings.fx) {
        const v = Math.max(d, b);
        if (v >= lastTickValue + step && v < Math.max(finalMeters, bestMeters)) {
          lastTickValue = v;
          this.audio.tick();
        }
      }

      if (t < 1) this.counterAnimRaf = requestAnimationFrame(tick);
    };

    // reset labels instantly so it always counts up cleanly
    this.finalDistanceEl.textContent = "Distance: 0m";
    this.bestDistanceEl.textContent = "Best: 0m";
    this.counterAnimRaf = requestAnimationFrame(tick);
  }

  private loop(): void {
    const now = performance.now();
    const dt = Math.min(0.033, (now - this.lastT) / 1000);
    this.lastT = now;

    this.update(dt);
    this.render();
    requestAnimationFrame(() => this.loop());
  }

  private update(dt: number): void {
    if (this.deathFlashT > 0) this.deathFlashT -= dt * 1000;
    this.updateDeathVfx(dt);

    if (this.state === "DYING") {
      this.deathDelayT -= dt;
      this.updateShake(dt);
      if (this.deathDelayT <= 0) {
        this.finalizeGameOver();
      }
      return;
    }

    if (this.state !== "PLAYING") {
      this.updateShake(dt);
      this.updateRuntimePalette();
      return;
    }

    this.meters = this.scrollX / 10;
    this.updateRuntimePalette();
    const diff = clamp((this.meters - CONFIG.DIFF_START_EASY_METERS) / CONFIG.DIFF_RAMP_METERS, 0, 1);
    this.speedMul = lerp(CONFIG.SPEED_BASE, CONFIG.SPEED_MAX, diff);

    const vx = CONFIG.WAVE_SPEED_X * this.speedMul;
    const vy = (this.holding ? -1 : 1) * CONFIG.WAVE_SPEED_Y * this.speedMul;

    this.scrollX += vx * dt;
    // IMPORTANT: vertical motion is in world-space so camera motion never changes the movement angle.
    this.waveWorldY += vy * dt;

    // Keep chunks far ahead and generate them with a tiny time budget per frame
    this.enqueueChunksAhead();
    this.processChunkQueue(1.2);

    // Camera follows corridor center vertically (so path stays centered as it slopes)
    const worldX = this.scrollX + this.waveX;
    const currentChunk = this.findChunk(worldX);
    if (currentChunk) {
      const bounds = this.corridorAtX(currentChunk, worldX);
      const corridorCenter = (bounds.topY + bounds.bottomY) * 0.5;
      const targetCamY = corridorCenter - this.viewH() * 0.5;
      const dy = targetCamY - this.camY;
      const dead = CONFIG.CAMERA_DEADZONE_PX;
      const dyAdj = Math.abs(dy) <= dead ? 0 : (Math.abs(dy) - dead) * Math.sign(dy);
      const desired = dyAdj * CONFIG.CAMERA_SMOOTH;
      const maxStep = CONFIG.CAMERA_MAX_SPEED * dt;
      this.camY += clamp(desired, -maxStep, maxStep);
    }

    // Sliding rules:
    // - Flat segments: allow sliding (roof/ground).
    // - Slopes: allow sliding ONLY when moving DOWN (release) and the segment slopes DOWN (or flat).
    //   This prevents "climbing" slopes while still allowing sliding down them.
    let worldY = this.waveWorldY;
    this.isSlidingOnSurface = false;
    if (currentChunk) {
      const info = this.corridorAtXInfo(currentChunk, worldX);
      // On 45° slopes the perpendicular distance to the wall is ~verticalDelta / sqrt(2),
      // so we increase the vertical margin on sloped segments to avoid dying while "sliding down".
      const r = CONFIG.WAVE_SIZE * 0.55;
      const baseMargin = r + 2.5;
      const topSlopeFactor = info.topFlat ? 1 : Math.SQRT2;
      const bottomSlopeFactor = info.bottomFlat ? 1 : Math.SQRT2;
      const minY = info.topY + baseMargin * topSlopeFactor;
      const maxY = info.bottomY - baseMargin * bottomSlopeFactor;
      const movingDown = !this.holding;

      if (worldY < minY) {
        const topAllowsSlide = info.topFlat || (movingDown && info.topDy >= -0.1);
        if (topAllowsSlide) {
          worldY = minY;
          this.waveWorldY = worldY;
          this.isSlidingOnSurface = true;
        }
      } else if (worldY > maxY) {
        const bottomAllowsSlide = info.bottomFlat || (movingDown && info.bottomDy >= -0.1);
        if (bottomAllowsSlide) {
          worldY = maxY;
          this.waveWorldY = worldY;
          this.isSlidingOnSurface = true;
        }
      }
    }

    // Derive screen-space Y for rendering only.
    this.waveY = this.waveWorldY - this.camY;

    // Trail uses world X (forward motion) and screen Y (dart Y) so the path
    // is anchored to the corridor path in world-space (so camera motion does not "drag" it).
    const trailX = worldX;
    const trailY = worldY;
    this.trail.push({ x: trailX, y: trailY, a: 1 });
    if (this.trail.length > 46) this.trail.shift();
    for (const p of this.trail) p.a *= 0.92;

    this.updateShake(dt);

    if (this.checkCollision(worldX, worldY)) {
      this.shakeT = CONFIG.SHAKE_MS;
      this.deathFlashT = CONFIG.DEATH_FLASH_MS;
      this.beginDeath();
    }

    this.distanceEl.textContent = `${Math.floor(this.meters)}m`;
  }

  private updateShake(dt: number): void {
    if (this.shakeT > 0) {
      this.shakeT -= dt * 1000;
      const t = clamp(this.shakeT / CONFIG.SHAKE_MS, 0, 1);
      const amp = CONFIG.SHAKE_PX * t;
      this.shakeX = (Math.random() - 0.5) * amp;
      this.shakeY = (Math.random() - 0.5) * amp;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  private enqueueChunksAhead(): void {
    // Keep a generous buffer so generation happens before the player reaches it.
    // Larger buffer = less likely a chunk build happens on a "tight" frame.
    const lookahead = this.viewW() * 3.0;
    const needX = this.scrollX + lookahead;

    // Ensure plannedXEnd starts at current last chunk end (covers edge cases)
    if (this.chunks.length > 0) {
      const last = this.chunks[this.chunks.length - 1];
      this.plannedXEnd = Math.max(this.plannedXEnd, last.xEnd);
    }

    // Queue up chunk starts until we have enough planned distance.
    // (We only ever build a couple per second, so this array stays tiny.)
    while (needX > this.plannedXEnd - 200) {
      this.pendingChunkStarts.push(this.plannedXEnd);
      this.plannedXEnd += CONFIG.CHUNK_WIDTH;
      if (this.pendingChunkStarts.length > 6) break; // safety
    }
  }

  private processChunkQueue(budgetMs: number): void {
    if (this.pendingChunkStarts.length === 0) return;

    const start = performance.now();
    while (this.pendingChunkStarts.length > 0) {
      const xStart = this.pendingChunkStarts.shift();
      if (xStart === undefined) break;

      const meters = xStart / 10;
      const c = this.gen.nextChunk(xStart, this.viewW(), this.viewH(), meters, false);
      this.chunks.push(c);

      // Keep memory bounded
      while (this.chunks.length > 10) this.chunks.shift();

      // Time budget: stop once we've spent enough time this frame.
      if (performance.now() - start >= budgetMs) break;
    }
  }

  private findChunk(worldX: number): Chunk | null {
    for (const c of this.chunks) {
      if (worldX >= c.xStart && worldX <= c.xEnd) return c;
    }
    return null;
  }

  private checkCollision(worldX: number, worldY: number): boolean {
    const chunk = this.findChunk(worldX);
    if (!chunk) return false;

    const r = CONFIG.WAVE_SIZE * 0.55;

    // Walls (top & bottom polylines) are lethal (no sliding).
    if (this.hitPolyline(worldX, worldY, r, chunk.top)) return true;
    if (this.hitPolyline(worldX, worldY, r, chunk.bottom)) return true;

    // Blocks (solid rectangular obstacles)
    for (const b of chunk.blocks) {
      const x0 = b.x - b.w * 0.5;
      const y0 = b.y;
      if (circleIntersectsRect(worldX, worldY, r, x0, y0, b.w, b.h)) return true;
    }

    // Spikes (including block spikes)
    for (const s of chunk.spikes) {
      if (circleIntersectsTri(worldX, worldY, r, s)) return true;
    }

    // Rolling wheels (circular hazard)
    for (const w of chunk.wheels) {
      if (dist2(worldX, worldY, w.x, w.y) <= (w.radius + r) * (w.radius + r)) return true;
    }

    return false;
  }

  private hitPolyline(worldX: number, worldY: number, r: number, path: Point[]): boolean {
    const r2 = r * r;
    // only check nearby segments
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (worldX < a.x - 120 || worldX > b.x + 120) continue;
      if (pointSegDistSq(worldX, worldY, a.x, a.y, b.x, b.y) <= r2) return true;
    }
    return false;
  }

  // Sample corridor bounds (top & bottom Y) at a given world X.
  // Duplicates LevelGen.corridorAtX so we can clamp the player to slide along walls.
  private corridorAtX(chunk: Chunk, x: number): { topY: number; bottomY: number } {
    const sample = (path: Point[]): number => {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        if (x >= a.x && x <= b.x) {
          const t = (x - a.x) / (b.x - a.x || 1);
          return lerp(a.y, b.y, t);
        }
      }
      return path[path.length - 1].y;
    };
    return { topY: sample(chunk.top), bottomY: sample(chunk.bottom) };
  }

  private corridorAtXInfo(
    chunk: Chunk,
    x: number
  ): { topY: number; bottomY: number; topFlat: boolean; bottomFlat: boolean; topDy: number; bottomDy: number } {
    const sample = (path: Point[]): { y: number; flat: boolean; dy: number } => {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        if (x >= a.x && x <= b.x) {
          const t = (x - a.x) / (b.x - a.x || 1);
          const y = lerp(a.y, b.y, t);
          const flat = Math.abs(b.y - a.y) < 0.1;
          return { y, flat, dy: b.y - a.y };
        }
      }
      return { y: path[path.length - 1].y, flat: true, dy: 0 };
    };

    const top = sample(chunk.top);
    const bot = sample(chunk.bottom);
    return { topY: top.y, bottomY: bot.y, topFlat: top.flat, bottomFlat: bot.flat, topDy: top.dy, bottomDy: bot.dy };
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.shakeX, this.shakeY);
    this.drawBackground();
    this.drawWorld();
    this.drawWave();
    this.drawDeathVfx();
    this.drawDeathFlash();
    ctx.restore();

    // In pixel-art mode, upscale the offscreen render buffer to the display canvas.
    if (CONFIG.PIXEL_ART && this.renderCanvas) {
      if (CONFIG.PIXEL_STYLE === "16BIT") {
        this.apply16BitPostFx();
      }

      const dctx = this.displayCtx;
      dctx.save();
      dctx.setTransform(1, 0, 0, 1, 0, 0);
      dctx.imageSmoothingEnabled = false;
      dctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      // Integer upscale so pixels are *actually* visible and crisp (no fractional scaling blur).
      const srcW = this.renderCanvas.width;
      const srcH = this.renderCanvas.height;
      const scale = Math.max(1, Math.floor(Math.min(this.canvas.width / srcW, this.canvas.height / srcH)));
      const dstW = srcW * scale;
      const dstH = srcH * scale;
      const ox = Math.floor((this.canvas.width - dstW) * 0.5);
      const oy = Math.floor((this.canvas.height - dstH) * 0.5);
      dctx.drawImage(this.renderCanvas, 0, 0, srcW, srcH, ox, oy, dstW, dstH);
      if (CONFIG.PIXEL_STYLE === "16BIT" && CONFIG.PIXEL_16BIT_SCANLINES) {
        this.drawScanlines(dctx);
      }
      dctx.restore();
    }
  }

  private apply16BitPostFx(): void {
    if (!this.renderCanvas || !this.renderCtx) return;
    if (!CONFIG.PIXEL_16BIT_QUANTIZE_565) return;

    const w = this.renderCanvas.width;
    const h = this.renderCanvas.height;
    if (w <= 0 || h <= 0) return;

    // Quantize to a 16-bit-ish RGB565 palette (classic console feel).
    const img = this.renderCtx.getImageData(0, 0, w, h);
    const d = img.data;

    // 4x4 ordered dither table (subtle amplitudes; keeps it from looking noisy).
    const bayer4 = [-6, 2, -4, 4, 6, -2, 4, -4, -2, 4, -6, 2, 4, -4, 2, -2];

    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      const by = (y & 3) << 2;
      for (let x = 0; x < w; x++) {
        const i = row + x * 4;
        let r = d[i];
        let g = d[i + 1];
        let b = d[i + 2];

        if (CONFIG.PIXEL_16BIT_DITHER) {
          const t = bayer4[by + (x & 3)];
          r = clamp(r + t, 0, 255);
          g = clamp(g + t, 0, 255);
          b = clamp(b + t, 0, 255);
        }

        // RGB565-ish masking (5/6/5 bits)
        d[i] = r & 0xf8;
        d[i + 1] = g & 0xfc;
        d[i + 2] = b & 0xf8;
      }
    }

    this.renderCtx.putImageData(img, 0, 0);
  }

  private ensureScanlinePattern(ctx: CanvasRenderingContext2D): void {
    if (this.scanlinePattern) return;
    const tile = document.createElement("canvas");
    tile.width = 2;
    tile.height = 4;
    const tctx = tile.getContext("2d");
    if (!tctx) return;
    tctx.clearRect(0, 0, tile.width, tile.height);
    // Dark scanlines (2 lines per 4px tile)
    tctx.fillStyle = "rgba(0,0,0,0.55)";
    tctx.fillRect(0, 1, tile.width, 1);
    tctx.fillRect(0, 3, tile.width, 1);
    this.scanlinePattern = ctx.createPattern(tile, "repeat");
  }

  private drawScanlines(dctx: CanvasRenderingContext2D): void {
    this.ensureScanlinePattern(dctx);
    if (!this.scanlinePattern) return;
    dctx.save();
    dctx.globalCompositeOperation = "multiply";
    dctx.globalAlpha = CONFIG.PIXEL_16BIT_SCANLINE_ALPHA;
    dctx.fillStyle = this.scanlinePattern;
    dctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    dctx.restore();
  }

  private spawnDeathShatter(x: number, y: number): void {
    this.deathShards = [];

    const count = 18;
    for (let i = 0; i < count; i++) {
      // Forward-biased spray (dart moves right)
      const a = (Math.random() * 1.2 - 0.6) * Math.PI; // [-0.6π..0.6π]
      const bias = 0.85; // push forward
      const dirX = Math.cos(a) * 0.55 + bias;
      const dirY = Math.sin(a) * 0.85;
      const len = Math.hypot(dirX, dirY) || 1;
      const nx = dirX / len;
      const ny = dirY / len;

      const speed = 220 + Math.random() * 520;
      const life = 0.35 + Math.random() * 0.30;
      const size = 4 + Math.random() * 10;
      const rot = Math.random() * Math.PI * 2;
      const rotV = (Math.random() * 2 - 1) * 9.0;

      this.deathShards.push({
        x: x + (Math.random() * 2 - 1) * 6,
        y: y + (Math.random() * 2 - 1) * 6,
        vx: nx * speed,
        vy: ny * speed,
        rot,
        rotV,
        size,
        life,
        ttl: life,
        hue: Math.random() < 0.65 ? "cyan" : "white",
      });
    }
  }

  private updateDeathVfx(dt: number): void {
    if (this.deathShards.length > 0) {
      const drag = Math.pow(0.10, dt); // framerate-independent drag
      for (const s of this.deathShards) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= drag;
        s.vy *= drag;
        s.rot += s.rotV * dt;
        s.life -= dt;
      }
      this.deathShards = this.deathShards.filter((s) => s.life > 0);
    }

    // Let the trail fade out after death (it otherwise freezes in place)
    if (this.state !== "PLAYING" && this.trail.length > 0) {
      const fade = Math.pow(0.86, dt * 60);
      for (const p of this.trail) p.a *= fade;
      while (this.trail.length > 0 && this.trail[0].a < 0.02) this.trail.shift();
    }
  }

  private drawDeathVfx(): void {
    if (this.deathShards.length === 0) return;
    const ctx = this.ctx;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (const s of this.deathShards) {
      const t = clamp(s.life / (s.ttl || 1), 0, 1);
      const a = t * t;
      const glow = s.hue === "cyan" ? "rgba(0,255,255,0.85)" : "rgba(255,255,255,0.85)";
      const fill =
        s.hue === "cyan"
          ? `rgba(0,255,255,${(0.18 + 0.38 * a).toFixed(3)})`
          : `rgba(255,255,255,${(0.14 + 0.34 * a).toFixed(3)})`;

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.shadowColor = glow;
      ctx.shadowBlur = 18 * a;
      ctx.fillStyle = fill;
      ctx.strokeStyle = `rgba(0,0,0,${(0.35 * a).toFixed(3)})`;
      ctx.lineWidth = 1.5;

      // shard triangle
      const w = s.size * (0.9 + 0.6 * (1 - t));
      const h = s.size * 0.55;
      ctx.beginPath();
      ctx.moveTo(w, 0);
      ctx.lineTo(-w * 0.55, h);
      ctx.lineTo(-w * 0.55, -h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawBackground(): void {
    const ctx = this.ctx;
    const w = this.viewW();
    const h = this.viewH();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, this.runtimePalette.bgTop);
    g.addColorStop(1, this.runtimePalette.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Starry twinkling background (behind grid)
    const t = performance.now() * 0.001;
    ctx.save();
    for (const s of this.stars) {
      // Parallax: stars drift slightly with scroll
      const sx = (s.x - this.scrollX * s.speed) % w;
      const sy = s.y;
      const x = sx < 0 ? sx + w : sx;

      // Twinkle: alpha oscillates around baseAlpha
      const tw = 0.45 + 0.55 * Math.sin(t * 2.3 + s.twinkle);
      const alpha = s.baseAlpha * tw;

      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, sy, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Planets layer (16-bit vibe): a few large shapes with parallax + simple banding/rings.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const p of this.planets) {
      const px = (p.x - this.scrollX * p.speed) % (w + p.r * 2);
      const x = px < -p.r ? px + (w + p.r * 2) : px;
      const y = p.y + Math.sin(t * 0.25 + p.bandPhase) * 2; // subtle drift

      ctx.save();
      ctx.globalAlpha = p.alpha;

      // Base planet
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = p.base;
      ctx.fill();

      // Clip and draw a few shade bands (no randomness in loop)
      ctx.clip();
      ctx.fillStyle = p.shade;
      const bandH = Math.max(6, Math.floor(p.r * 0.18));
      const off = (Math.sin(t * 0.35 + p.bandPhase) * 0.5 + 0.5) * bandH;
      for (let by = y - p.r; by < y + p.r + bandH; by += bandH * 2) {
        ctx.fillRect(x - p.r, Math.floor(by + off), p.r * 2, Math.floor(bandH));
      }

      // Simple terminator shade (gives depth)
      ctx.globalAlpha = p.alpha * 0.85;
      const rg = ctx.createRadialGradient(x - p.r * 0.35, y - p.r * 0.25, p.r * 0.2, x, y, p.r * 1.05);
      rg.addColorStop(0, "rgba(255,255,255,0.28)");
      rg.addColorStop(0.55, "rgba(255,255,255,0.06)");
      rg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = rg;
      ctx.fillRect(x - p.r, y - p.r, p.r * 2, p.r * 2);

      ctx.restore();

      // Ring (drawn outside clip for silhouette)
      if (p.ring) {
        ctx.save();
        ctx.globalAlpha = p.alpha * 0.75;
        ctx.translate(x, y);
        ctx.rotate(p.ringTilt);
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = Math.max(2, Math.floor(p.r * 0.06));
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * 1.55, p.r * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();

    // subtle diamond grid, parallax
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = this.runtimePalette.grid;
    ctx.lineWidth = 1;
    const size = 34;
    const ox = -((this.scrollX * 0.08) % size);
    const oy = -((this.camY * 0.08) % size);
    for (let x = ox - size; x < w + size; x += size) {
      for (let y = oy - size; y < h + size; y += size) {
        ctx.beginPath();
        ctx.moveTo(x, y + size * 0.5);
        ctx.lineTo(x + size * 0.5, y);
        ctx.lineTo(x + size, y + size * 0.5);
        ctx.lineTo(x + size * 0.5, y + size);
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawWorld(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(-this.scrollX, -this.camY);

    // draw walls for visible chunks
    const visibleStart = this.scrollX - 200;
    const visibleEnd = this.scrollX + this.viewW() + 600;

    for (const c of this.chunks) {
      if (c.xEnd < visibleStart || c.xStart > visibleEnd) continue;
      this.drawWalls(c);
      for (const b of c.blocks) this.drawBlock(b);
      this.drawSpikes(c.spikes);
      this.drawWheels(c.wheels);
    }

    ctx.restore();
  }

  private drawWalls(c: Chunk): void {
    const ctx = this.ctx;
    const h = this.viewH();
    // Extend a bit beyond screen bounds to cover camera motion without huge overdraw.
    const extend = 900;
    const topExtend = -extend;
    const bottomExtend = h + extend;

    // Top fill - extend far beyond screen
    ctx.fillStyle = CONFIG.WALL_FILL;
    ctx.beginPath();
    ctx.moveTo(c.top[0].x, topExtend);
    for (const p of c.top) ctx.lineTo(p.x, p.y);
    ctx.lineTo(c.top[c.top.length - 1].x, topExtend);
    ctx.closePath();
    ctx.fill();
    this.drawWallPatternClip(c.top, true, topExtend);

    // Bottom fill - extend far beyond screen
    ctx.beginPath();
    ctx.moveTo(c.bottom[0].x, bottomExtend);
    for (const p of c.bottom) ctx.lineTo(p.x, p.y);
    ctx.lineTo(c.bottom[c.bottom.length - 1].x, bottomExtend);
    ctx.closePath();
    ctx.fill();
    this.drawWallPatternClip(c.bottom, false, bottomExtend);

    // Outline inner edges
    ctx.save();
    ctx.strokeStyle = CONFIG.WALL_OUTLINE;
    ctx.lineWidth = 4;
    ctx.shadowColor = "rgba(255,255,255,0.35)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(c.top[0].x, c.top[0].y);
    for (const p of c.top) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.bottom[0].x, c.bottom[0].y);
    for (const p of c.bottom) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawWheels(wheels: Wheel[]): void {
    const ctx = this.ctx;
    const time = performance.now() * 0.001;

    // Deterministic hash helpers (avoid Math.random in render)
    const frac = (v: number): number => v - Math.floor(v);
    const hash01 = (v: number): number => frac(Math.sin(v) * 43758.5453123);

    ctx.save();
    for (const w of wheels) {
      const seed = hash01(w.x * 0.0037 + w.y * 0.0049 + w.radius * 0.11);
      const seed2 = hash01(seed * 91.7 + 0.123);

      ctx.save();
      ctx.translate(w.x, w.y);

      const r = w.radius;
      const diskR = r * 1.55;
      const diskRy = r * (0.42 + 0.10 * seed2);
      const tilt = (seed - 0.5) * 0.9;
      const spin = time * (1.4 + seed * 1.2);
      const pulse = 0.65 + 0.35 * Math.sin(time * 2.0 + seed * 30.0);

      // Big bloom / gravity glow
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = this.runtimePalette.waveGlow;
      ctx.shadowBlur = 46;
      ctx.globalAlpha = 0.28 + 0.18 * pulse;
      ctx.strokeStyle = this.runtimePalette.trail;
      ctx.lineWidth = Math.max(8, Math.floor(r * 0.40));
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 22;
      ctx.globalAlpha = 0.18 + 0.12 * pulse;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = Math.max(5, Math.floor(r * 0.22));
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.04, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Accretion disk (tilted ellipse with hot inner edge)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.rotate(tilt);
      ctx.rotate(spin);
      const diskGrad = ctx.createRadialGradient(0, 0, r * 0.18, 0, 0, diskR);
      diskGrad.addColorStop(0.0, "rgba(0,0,0,0)");
      diskGrad.addColorStop(0.30, "rgba(0,0,0,0)");
      diskGrad.addColorStop(0.55, this.runtimePalette.trail);
      diskGrad.addColorStop(0.82, "rgba(255,255,255,0.14)");
      diskGrad.addColorStop(1.0, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.34 + 0.22 * pulse;
      ctx.fillStyle = diskGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, diskR, diskRy, 0, 0, Math.PI * 2);
      ctx.fill();

      // Inner hot ring
      ctx.shadowColor = this.runtimePalette.waveGlow;
      ctx.shadowBlur = 20;
      ctx.globalAlpha = 0.30 + 0.22 * pulse;
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = Math.max(2, Math.floor(r * 0.10));
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.08, r * 0.40, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Event horizon (solid black) + subtle rim
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = "rgba(255,255,255,0.20)";
      ctx.shadowBlur = 12;
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Lensing arcs (suggest bending light)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = this.runtimePalette.waveGlow;
      ctx.shadowBlur = 18;
      ctx.globalAlpha = 0.16 + 0.12 * pulse;
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a0 = (time * 0.9 + seed * 10 + i * 2.1) % (Math.PI * 2);
        const arcR = r * (1.20 + i * 0.18);
        ctx.beginPath();
        ctx.arc(0, 0, arcR, a0, a0 + 0.9);
        ctx.stroke();
      }
      ctx.restore();

      // Orbiting sparks (pixel-friendly squares), deterministic
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = this.runtimePalette.waveGlow;
      ctx.shadowBlur = 12;
      for (let i = 0; i < 10; i++) {
        const h = hash01(seed * 100.0 + i * 12.7);
        const a = time * (1.2 + h * 2.8) + i * 0.7 + seed * 10.0;
        const rr = r * (1.05 + h * 0.95);
        const sx = Math.cos(a) * rr;
        const sy = Math.sin(a * (1.0 + seed2 * 0.25)) * rr * (0.55 + 0.15 * seed2);
        const s = 1 + Math.floor(h * 3);
        ctx.globalAlpha = 0.10 + 0.22 * (0.5 + 0.5 * Math.sin(a * 1.7));
        ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.9)" : this.runtimePalette.trail;
        ctx.fillRect(Math.round(sx - s * 0.5), Math.round(sy - s * 0.5), s, s);
      }
      ctx.restore();

      ctx.restore();
    }
    ctx.restore();
  }

  private drawWallPatternClip(path: Point[], isTop: boolean, extendY: number): void {
    const ctx = this.ctx;
    ctx.save();

    // Create clipping path (so pattern never leaks into corridor)
    ctx.beginPath();
    ctx.moveTo(path[0].x, extendY);
    for (const p of path) ctx.lineTo(p.x, p.y);
    ctx.lineTo(path[path.length - 1].x, extendY);
    ctx.closePath();
    ctx.clip();

    // Use a cached repeating CanvasPattern (massively faster than per-cell drawing)
    if (!this.wallPattern) this.rebuildWallPattern();
    if (this.wallPattern) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = this.wallPattern;
      const x0 = path[0].x - 64;
      const x1 = path[path.length - 1].x + 128;
      const y0 = Math.min(extendY, path[0].y) - 128;
      const y1 = Math.max(extendY, path[path.length - 1].y) + 128;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.restore();
  }

  private rebuildWallPattern(): void {
    // A small tiled pattern we can repeat cheaply.
    const tileSize = 96;
    const tile = document.createElement("canvas");
    tile.width = tileSize;
    tile.height = tileSize;
    const tctx = tile.getContext("2d");
    if (!tctx) return;

    tctx.clearRect(0, 0, tileSize, tileSize);
    tctx.fillStyle = CONFIG.WALL_PATTERN;
    tctx.strokeStyle = CONFIG.WALL_PATTERN;
    tctx.lineWidth = 2;

    // Draw a few simple “frame-like” glyphs in the tile. Repeat gives the wall texture.
    const drawDiamond = (cx: number, cy: number, r: number) => {
      tctx.beginPath();
      tctx.moveTo(cx, cy - r);
      tctx.lineTo(cx + r, cy);
      tctx.lineTo(cx, cy + r);
      tctx.lineTo(cx - r, cy);
      tctx.closePath();
      tctx.fill();
    };

    const drawCross = (cx: number, cy: number, r: number) => {
      tctx.beginPath();
      tctx.moveTo(cx - r, cy);
      tctx.lineTo(cx + r, cy);
      tctx.moveTo(cx, cy - r);
      tctx.lineTo(cx, cy + r);
      tctx.stroke();
    };

    // Layout within tile (deterministic, no per-frame randomness)
    drawDiamond(24, 24, 12);
    tctx.beginPath();
    tctx.arc(72, 24, 9, 0, Math.PI * 2);
    tctx.fill();
    drawCross(24, 72, 12);
    tctx.fillRect(64, 64, 18, 18);

    // A subtle diagonal line for more “tech” feel
    tctx.beginPath();
    tctx.moveTo(0, tileSize);
    tctx.lineTo(tileSize, 0);
    tctx.stroke();

    this.wallPatternTile = tile;
    this.wallPattern = this.ctx.createPattern(tile, "repeat");
  }

  private drawBlock(b: Block): void {
    const ctx = this.ctx;
    const seed = b.seed;
    const frac = (v: number): number => v - Math.floor(v);
    const hash01 = (v: number): number => frac(Math.sin(v) * 43758.5453123);
    const v1 = hash01(seed * 91.7 + b.x * 0.0031 + b.y * 0.0047);
    const v2 = hash01(seed * 33.3 + b.x * 0.0019);
    const v3 = hash01(seed * 17.1 + b.y * 0.0027);

    const time = performance.now() * 0.001;
    const pulse = 0.6 + 0.4 * Math.sin(time * 2.2 + seed * 18.0);

    const cx = b.x;
    const cy = b.y + b.h * 0.5;
    const rx = b.w * 0.5;
    const ry = b.h * 0.5;

    const tip = rx * (1.06 + 0.10 * v2);
    const fin = 0.56 + 0.12 * v1;
    const cut = 0.44 + 0.10 * v3;

    const pathInterstellar = (): void => {
      ctx.beginPath();
      // A "diamond ship" with a forward nose and side fins (interstellar silhouette)
      ctx.moveTo(0, -ry);
      ctx.lineTo(rx * fin, -ry * cut);
      ctx.lineTo(tip, 0);
      ctx.lineTo(rx * fin, ry * cut);
      ctx.lineTo(0, ry);
      ctx.lineTo(-rx * 0.85, ry * 0.30);
      ctx.lineTo(-rx, 0);
      ctx.lineTo(-rx * 0.85, -ry * 0.30);
      ctx.closePath();
    };

    ctx.save();
    ctx.translate(cx, cy);

    // BIG glow bloom (two passes)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.shadowBlur = 46;
    ctx.strokeStyle = rgba(160, 255, 245, 0.22 + 0.18 * pulse);
    ctx.lineWidth = Math.max(10, Math.floor(Math.min(rx, ry) * 0.45));
    pathInterstellar();
    ctx.stroke();

    ctx.shadowBlur = 20;
    ctx.strokeStyle = rgba(255, 255, 255, 0.12 + 0.10 * pulse);
    ctx.lineWidth = Math.max(6, Math.floor(Math.min(rx, ry) * 0.26));
    pathInterstellar();
    ctx.stroke();
    ctx.restore();

    // Base body (dark hull with subtle nebula tint)
    const fillGrad = ctx.createLinearGradient(-rx, -ry, tip, ry);
    fillGrad.addColorStop(0, "#05040d");
    fillGrad.addColorStop(0.55, "#0c1430");
    fillGrad.addColorStop(1, "#0b2b3b");
    ctx.fillStyle = fillGrad;
    ctx.strokeStyle = "rgba(230,255,248,0.86)";
    ctx.lineWidth = 3;
    ctx.shadowBlur = 0;
    pathInterstellar();
    ctx.fill();
    ctx.stroke();

    // Inner "star-core" + constellation details (clipped to body)
    ctx.save();
    pathInterstellar();
    ctx.clip();

    // Nebula core
    ctx.globalCompositeOperation = "screen";
    const coreR = Math.min(rx, ry) * 0.75;
    const neb = ctx.createRadialGradient(rx * 0.10, -ry * 0.12, coreR * 0.08, 0, 0, coreR);
    neb.addColorStop(0, rgba(255, 255, 255, 0.18));
    neb.addColorStop(0.35, this.runtimePalette.trail);
    neb.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = neb;
    ctx.fillRect(-rx * 1.4, -ry * 1.4, rx * 2.8, ry * 2.8);

    // Constellation points (pixel-friendly squares) + a few connecting lines
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.shadowBlur = 10;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
      const px = (hash01(seed * 100.0 + i * 12.7) - 0.5) * rx * 1.10;
      const py = (hash01(seed * 200.0 + i * 9.9) - 0.5) * ry * 0.95;
      pts.push({ x: px, y: py });

      const s = 2 + Math.floor(hash01(seed * 300.0 + i * 7.3) * 3);
      ctx.globalAlpha = 0.25 + 0.35 * hash01(seed * 400.0 + i * 3.1);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(Math.round(px - s * 0.5), Math.round(py - s * 0.5), s, s);
    }

    ctx.globalAlpha = 0.18 + 0.14 * pulse;
    ctx.strokeStyle = this.runtimePalette.trail;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b2 = pts[i + 1];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.stroke();
    }

    // Star-core diamond
    const corePulse = 0.7 + 0.3 * Math.sin(time * 3.1 + seed * 10.0);
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 22;
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.fillStyle = rgba(255, 255, 255, 0.10 + 0.12 * corePulse);
    ctx.strokeStyle = rgba(230, 255, 248, 0.35 + 0.25 * corePulse);
    ctx.lineWidth = 2;
    const d = Math.max(10, Math.min(rx, ry) * 0.24);
    ctx.beginPath();
    ctx.moveTo(0, -d);
    ctx.lineTo(d, 0);
    ctx.lineTo(0, d);
    ctx.lineTo(-d, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore(); // clip

    // Orbit ring accent
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.22 + 0.12 * pulse;
    ctx.strokeStyle = this.runtimePalette.trail;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.85, ry * 0.30, (v1 - 0.5) * 0.9, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private drawSpikes(spikes: SpikeTri[]): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = CONFIG.SPIKE_FILL;
    ctx.strokeStyle = CONFIG.SPIKE_STROKE;
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255,255,255,0.18)";
    ctx.shadowBlur = 10;
    for (const t of spikes) {
      ctx.beginPath();
      ctx.moveTo(t.ax, t.ay);
      ctx.lineTo(t.bx, t.by);
      ctx.lineTo(t.cx, t.cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawWave(): void {
    const ctx = this.ctx;

    // trail (diagonal zig-zag, 45° segments relative to scrolling level)
    if (this.trail.length > 1) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      
      // Pulsing white outline (beats on and off)
      const time = performance.now() * 0.003;
      const pulse = 0.5 + 0.5 * Math.sin(time); // Oscillates between 0 and 1
      const outlineAlpha = pulse;
      
      // Draw outline first (thicker, pulsing white)
      ctx.lineWidth = 16;
      ctx.strokeStyle = `rgba(255, 255, 255, ${outlineAlpha})`;
      ctx.beginPath();
      for (let i = 0; i < this.trail.length; i++) {
        const p = this.trail[i];
        const sx = p.x - this.scrollX;
        const sy = p.y - this.camY;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      
      // Draw main trail on top (thinner, brighter)
      ctx.lineWidth = 12;
      ctx.strokeStyle = this.runtimePalette.trail;
      ctx.beginPath();
      for (let i = 0; i < this.trail.length; i++) {
        const p = this.trail[i];
        const sx = p.x - this.scrollX;
        const sy = p.y - this.camY;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // wave triangle (screen space) - equilateral-style, visually balanced
    if ((this.state === "DYING" || this.state === "GAME_OVER") && this.deathShards.length > 0) return;
    const size = CONFIG.WAVE_SIZE;
    const x = this.waveX;
    const y = this.waveY;
    ctx.save();
    ctx.translate(x, y);
    // Point forward when sliding on roof/ground, otherwise point at 45° up/down
    if (this.isSlidingOnSurface) {
      ctx.rotate(0); // Point forward (horizontal)
    } else {
      const dirUp = this.holding;
      ctx.rotate(dirUp ? -Math.PI / 4 : Math.PI / 4);
    }
    ctx.fillStyle = CONFIG.WAVE_FILL;
    ctx.strokeStyle = CONFIG.WAVE_OUTLINE;
    ctx.lineWidth = 2;
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    // Equally-angled triangle: tip forward, symmetric base
    // Apex at (size, 0), base corners at (-size * 0.6, ±size * 0.8)
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, size * 0.8);
    ctx.lineTo(-size * 0.6, -size * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke(); // Draw outline
    ctx.restore();
  }

  private drawDeathFlash(): void {
    if (this.deathFlashT <= 0) return;
    const ctx = this.ctx;
    const a = clamp(this.deathFlashT / CONFIG.DEATH_FLASH_MS, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.25 * a;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.viewW(), this.viewH());
    ctx.restore();
  }

  private drawDebug(c: Chunk): void {
    const ctx = this.ctx;
    // draw collision polylines + wave circle
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.top[0].x, c.top[0].y);
    for (const p of c.top) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.bottom[0].x, c.bottom[0].y);
    for (const p of c.bottom) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
  }
}

// Boot
console.log("[WaveModeGame] Boot");
new WaveModeGame();

