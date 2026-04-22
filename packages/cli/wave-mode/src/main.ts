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

// Import from extracted modules
import type {
  GameState,
  Settings,
  Point,
  Wheel,
  SpikeTri,
  SpikeField,
  Block,
  NebulaCloud,
  Pulsar,
  Comet,
  Chunk,
  TrailPoint,
  DeathShard,
  BgPlanet,
  RuntimePalette,
  SpikeKind,
} from "./types";

import { CONFIG, PALETTE_KEYFRAMES, PERF, type PaletteKeyframe } from "./config";

import {
  clamp,
  lerp,
  smoothstep,
  lerp3,
  lerp4,
  rgb,
  rgba,
  dist2,
  pointInTri,
  pointSegDistSq,
  circleIntersectsTri,
  circleIntersectsRect,
  triggerHaptic,
  submitScore,
  seededRandom,
  hash01,
} from "./utils";

// Obstacle modules
import {
  pickSpikeKind,
  makeSpike,
  canPlaceSpike,
  isInObstacleZone,
  pickSpikePattern,
  drawSpikes,
  drawSpikeFields,
  drawWheels,
  drawNebulas,
  drawPulsars,
  drawComets,
  updateComets,
  drawBlocks,
} from "./obstacles";

// Collision module
import { checkChunkCollision, hitPolyline, findCollisionImpactPoint } from "./collision";

// Performance utilities
import { GradientCache, CircularBuffer, ObjectPool } from "./utils/index";

// WebGL particle renderer
import { ParticleGL, GlowCache } from "./rendering/index";

// Types, config, and utilities are imported from their respective modules above

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

// Pattern types for structured map sections
type PatternType = "zigzag" | "gauntlet" | "squeeze" | "wave" | "staircase" | "tunnel" | null;

class LevelGen {
  private topY = 0;
  private botY = 0;
  private lastForcedUp = false;
  private adjustTopNext = false; // Alternate which path to adjust for min height enforcement
  
  // Pattern section system (replaces old zigzag-only system)
  private currentPattern: PatternType = null;
  private patternStartM = -1; // -1 = not in pattern, otherwise the start meter
  private patternChunksRemaining = 0; // chunks left in current pattern
  private patternPhase = 0; // internal phase counter for pattern logic
  private patternDirection = false; // direction toggle for zigzag/staircase
  private lastPatternEndM = 0; // when last pattern ended (for spacing)
  
  // Wave pattern state
  private waveAngle = 0;
  
  // Squeeze pattern state
  private squeezePhase: "narrowing" | "tight" | "widening" = "narrowing";
  private squeezeProgress = 0;

  public reset(width: number, height: number): void {
    // Small resolutions: ensure the corridor constraints always fit inside the viewport.
    // Otherwise the generator can collapse and appear to "not generate a path".
    const margin = Math.min(CONFIG.WALL_MARGIN, Math.max(12, height * 0.12));
    const avail = Math.max(60, height - margin * 2);

    // IMPORTANT: On short viewports, the absolute MIN/MAX corridor heights can be too large,
    // leaving no headroom for vertical motion. Use availability-relative targets.
    const maxH = Math.min(CONFIG.MAX_HEIGHT, avail * 0.78);
    const minH = Math.max(34, Math.min(CONFIG.MIN_HEIGHT + 40, avail * 0.62, maxH - 20));
    const h = clamp(height * 0.58, minH, maxH);

    this.topY = clamp(height * 0.5 - h * 0.5, margin, height - margin - h);
    this.botY = this.topY + h;
    this.lastForcedUp = false;
    
    // Reset pattern state
    this.currentPattern = null;
    this.patternStartM = -1;
    this.patternChunksRemaining = 0;
    this.patternPhase = 0;
    this.patternDirection = false;
    this.lastPatternEndM = 0;
    this.waveAngle = 0;
    this.squeezePhase = "narrowing";
    this.squeezeProgress = 0;
  }
  
  // Check if we should start a new pattern section
  private maybeStartPattern(meters: number, smallViewport: boolean): void {
    if (this.currentPattern !== null) return; // Already in a pattern
    if (smallViewport) return; // No patterns on small screens
    if (meters < 150) return; // No patterns in early game
    if (meters - this.lastPatternEndM < 200) return; // Minimum gap between patterns
    
    // Use seeded random for pattern triggering (15% chance per check)
    const seed = Math.floor(meters / 80);
    const r = Math.abs((Math.sin(seed * 12.9898) * 43758.5453) % 1);
    if (r > 0.15) return;
    
    // Pick a random pattern type
    const patterns: PatternType[] = ["zigzag", "gauntlet", "squeeze", "wave", "staircase", "tunnel"];
    const patternIndex = Math.floor(Math.abs((Math.sin(seed * 7.7777) * 12345.6789) % 1) * patterns.length);
    this.currentPattern = patterns[patternIndex];
    this.patternStartM = meters;
    this.patternChunksRemaining = 5; // Each pattern lasts 5 chunks
    this.patternPhase = 0;
    this.patternDirection = false;
    this.waveAngle = 0;
    this.squeezePhase = "narrowing";
    this.squeezeProgress = 0;
  }
  
  // End the current pattern
  private endPattern(meters: number): void {
    this.lastPatternEndM = meters;
    this.currentPattern = null;
    this.patternStartM = -1;
    this.patternChunksRemaining = 0;
  }
  
  // Check if current pattern spawns extra obstacles (gauntlet)
  public isGauntletPattern(): boolean {
    return this.currentPattern === "gauntlet";
  }
  
  // Get current pattern type for external use
  public getCurrentPattern(): PatternType {
    return this.currentPattern;
  }

  public nextChunk(
    xStart: number,
    canvasW: number,
    canvasH: number,
    meters: number,
    isEmpty: boolean,
    straightSteps?: number,
    chunkWidthPx?: number,
    reuseChunk?: Chunk
  ): Chunk {
    const diff = this.difficulty01(meters);

    // Chunks alternate between "hazard-heavy" (more spikes/obstacles) and "corridor-heavy" (more zig-zag motion)
    // so we don't get empty straight roads when spikes are sparse.
    const hazardHeavy = !isEmpty && Math.random() < lerp(0.55, 0.70, diff);

    const maxStepChance = hazardHeavy ? lerp(0.30, 0.58, diff) : lerp(0.55, 0.92, diff);
    // Reduced tightening effect - corridors stay wider even at high difficulty
    const heightTighten = lerp(0, 0.6, diff); // Was lerp(0, 1, diff) - now caps at 0.6

    // Height constraints must adapt on tiny viewports so the corridor always exists.
    let margin = Math.min(CONFIG.WALL_MARGIN, Math.max(12, canvasH * 0.12));
    // Guarantee at least ~80px of usable corridor space (or as much as possible).
    margin = Math.min(margin, Math.max(0, (canvasH - 80) * 0.5));
    const marginTop = margin;
    const marginBot = canvasH - margin;
    const avail = Math.max(60, marginBot - marginTop);

    // Corridor height window:
    // Use availability-relative sizes so short viewports still get meaningful up/down motion.
    // Easy: wider corridor; Hard: tighter but still playable corridor.
    // Increased minimums to ensure maneuvering room even at high difficulty.
    const maxH = clamp(avail * lerp(0.82, 0.68, heightTighten), 54, avail); // Was 0.78->0.62
    const minH = clamp(avail * lerp(0.68, 0.54, heightTighten), 44, maxH - 20); // Was 0.62->0.44

    // Critical for small screens:
    // The vertical step size MUST be smaller than the available headroom for the corridor center to move.
    // Otherwise every attempt to go up/down clamps to bounds and quantizes back to "flat", producing straight corridors.
    const baseDx = CONFIG.SEG_DX;
    const headroom = Math.max(24, avail - maxH); // worst-case center movement range
    const effectiveDx = clamp(Math.floor(headroom * 0.9), 24, baseDx);

    const widthPx = chunkWidthPx ?? CONFIG.CHUNK_WIDTH;
    const xEnd = xStart + widthPx;
    // Use ceil so we always reach xEnd exactly (important for the intro which isn't divisible by SEG_DX).
    const steps = Math.ceil(widthPx / effectiveDx);
    const top: Point[] = [{ x: xStart, y: this.topY }];
    const bottom: Point[] = [{ x: xStart, y: this.botY }];

    let x = xStart;

    const smallViewport = canvasH < 520 || avail < 240;
    
    // Check if we should start a new pattern section
    if (!isEmpty) {
      this.maybeStartPattern(meters, smallViewport);
    }
    
    // Track if we're in a pattern this chunk
    const inPattern = this.currentPattern !== null;
    if (inPattern) {
      this.patternChunksRemaining--;
      if (this.patternChunksRemaining <= 0) {
        this.endPattern(meters);
      }
    }

    // Phase-based generation: creates readable zig-zags + widen/narrow moments (still 45°/flat only)
    type Phase = "flat" | "slopeUp" | "slopeDown" | "widen" | "narrow";
    let phase: Phase = "flat";
    let phaseLeft = 0;
    let flatRun = 0;
    let lastSlopeUp = false;
    let straightRun = 0;

    const straightCount = isEmpty ? clamp(straightSteps ?? steps, 0, steps) : 0;
    
    // Pattern-specific segment lengths
    const zigzagSegmentLength = Math.max(4, Math.floor(400 / effectiveDx)); // ~40m per direction
    const staircaseStepLength = Math.max(3, Math.floor(300 / effectiveDx)); // ~30m per step

    for (let i = 0; i < steps; i++) {
      const x2 = Math.min(x + effectiveDx, xEnd);
      const currentMeters = (x2 - xStart) / 10 + meters;

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
        // Prevent duplicating the final point when widthPx isn't divisible by effectiveDx.
        if (x >= xEnd - 0.001) break;
        continue;
      }

      // ===== PATTERN-BASED GENERATION =====
      if (!smallViewport && this.currentPattern !== null) {
        this.patternPhase++;
        
        switch (this.currentPattern) {
          case "zigzag": {
            // Sharp alternating up/down - 40m each direction
            const dir = this.patternDirection ? effectiveDx : -effectiveDx;
            dyTop = dir;
            dyBot = dir;
            
            if (this.patternPhase >= zigzagSegmentLength) {
              this.patternDirection = !this.patternDirection;
              this.patternPhase = 0;
            }
            break;
          }
          
          case "gauntlet": {
            // Wide corridor (for more obstacle space) - slight random movement
            // Gradually widen the corridor
            const currentH = this.botY - this.topY;
            const targetH = Math.min(maxH, currentH * 1.15);
            if (currentH < targetH) {
              dyTop = -effectiveDx * 0.5;
              dyBot = effectiveDx * 0.5;
            }
            // Add slight random vertical drift
            if (Math.random() < 0.3) {
              const drift = (Math.random() > 0.5 ? 1 : -1) * effectiveDx * 0.3;
              dyTop += drift;
              dyBot += drift;
            }
            break;
          }
          
          case "squeeze": {
            // Narrow -> tight -> widen pattern
            const segmentsPerPhase = Math.floor(steps / 3);
            
            if (this.squeezePhase === "narrowing") {
              // Narrow the corridor
              dyTop = effectiveDx * 0.6;
              dyBot = -effectiveDx * 0.6;
              this.squeezeProgress++;
              if (this.squeezeProgress >= segmentsPerPhase) {
                this.squeezePhase = "tight";
                this.squeezeProgress = 0;
              }
            } else if (this.squeezePhase === "tight") {
              // Stay tight with minimal movement
              this.squeezeProgress++;
              if (this.squeezeProgress >= segmentsPerPhase) {
                this.squeezePhase = "widening";
                this.squeezeProgress = 0;
              }
            } else {
              // Widen back out
              dyTop = -effectiveDx * 0.6;
              dyBot = effectiveDx * 0.6;
            }
            break;
          }
          
          case "wave": {
            // Smooth sine wave motion
            this.waveAngle += 0.15;
            const waveOffset = Math.sin(this.waveAngle) * effectiveDx * 0.8;
            dyTop = waveOffset;
            dyBot = waveOffset;
            break;
          }
          
          case "staircase": {
            // Stepped pattern: flat -> sudden shift -> flat
            const stepPhase = this.patternPhase % staircaseStepLength;
            
            if (stepPhase === 0) {
              // Sudden step up or down
              const stepDir = this.patternDirection ? effectiveDx * 1.5 : -effectiveDx * 1.5;
              dyTop = stepDir;
              dyBot = stepDir;
              this.patternDirection = !this.patternDirection;
            }
            // Otherwise stay flat (dyTop = dyBot = 0)
            break;
          }
          
          case "tunnel": {
            // Very narrow corridor - gradually narrow then maintain
            const currentH = this.botY - this.topY;
            const targetH = Math.max(minH * 1.1, 60); // Very tight but passable
            
            if (currentH > targetH) {
              // Narrow the corridor
              dyTop = effectiveDx * 0.4;
              dyBot = -effectiveDx * 0.4;
            }
            // Add very slight movement to keep it interesting
            if (Math.random() < 0.2) {
              const drift = (Math.random() > 0.5 ? 1 : -1) * effectiveDx * 0.2;
              dyTop += drift;
              dyBot += drift;
            }
            break;
          }
        }
      } else {
        // Normal phase-based generation (only when not in zigzag section)
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
          const baseLen = hazardHeavy ? Math.floor(lerp(2, 4, diff) + Math.random() * 2) : Math.floor(lerp(3, 6, diff) + Math.random() * 2);
          phaseLeft = baseLen;
        }
        phaseLeft--;

        // Apply phase
        if (phase === "slopeUp") {
          dyTop = -effectiveDx;
          dyBot = -effectiveDx;
        } else if (phase === "slopeDown") {
          dyTop = effectiveDx;
          dyBot = effectiveDx;
        } else if (phase === "widen") {
          dyTop = -effectiveDx;
          dyBot = effectiveDx;
        } else if (phase === "narrow") {
          dyTop = effectiveDx;
          dyBot = -effectiveDx;
        }

        // Add some extra micro-variation inside the phase (keeps it from feeling scripted)
        // Choose changes in {-effectiveDx,0,effectiveDx} so edges are 0° or 45° only
        if (Math.random() < maxStepChance * 0.55) {
          dyTop += this.pickDy(effectiveDx, diff);
        }
        if (Math.random() < maxStepChance * 0.55) {
          dyBot += this.pickDy(effectiveDx, diff);
        }
      }

      // Keep deltas within one 45° step.
      dyTop = clamp(dyTop, -effectiveDx, effectiveDx);
      dyBot = clamp(dyBot, -effectiveDx, effectiveDx);

      // Skip straight-run prevention during pattern sections (they're intentionally structured)
      if (this.currentPattern === null) {
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
            dyTop = up ? -effectiveDx : effectiveDx;
            dyBot = up ? effectiveDx : -effectiveDx;
          } else {
            dyTop = up ? -effectiveDx : effectiveDx;
            dyBot = up ? -effectiveDx : effectiveDx;
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
          dyTop = up ? -effectiveDx : effectiveDx;
          dyBot = up ? -effectiveDx : effectiveDx;
          flatRun = 0;
        }
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

      // Re-quantize to keep 45°/flat: make deltas exactly -effectiveDx/0/+effectiveDx relative to previous
      t2 = this.quantizeStep(this.topY, t2, effectiveDx);
      b2 = this.quantizeStep(this.botY, b2, effectiveDx);

      // Final safety for min height after quantization
      // ALTERNATE which path to adjust to create balanced flat segments on both top and bottom
      if (b2 - t2 < minH) {
        const need = minH - (b2 - t2);
        
        if (this.adjustTopNext) {
          // Push top UP (away from bottom)
          t2 = clamp(t2 - need, marginTop, marginBot - minH);
          t2 = this.quantizeStep(this.topY, t2, effectiveDx);
        } else {
          // Push bottom DOWN (away from top)
        b2 = clamp(b2 + need, marginTop + minH, marginBot);
        b2 = this.quantizeStep(this.botY, b2, effectiveDx);
        }
        this.adjustTopNext = !this.adjustTopNext; // Alternate for next time
        
        // If still not enough height, try the other direction
        if (b2 - t2 < minH) {
          if (this.adjustTopNext) {
            t2 = clamp(t2 - (minH - (b2 - t2)), marginTop, marginBot - minH);
            t2 = this.quantizeStep(this.topY, t2, effectiveDx);
          } else {
            b2 = clamp(b2 + (minH - (b2 - t2)), marginTop + minH, marginBot);
            b2 = this.quantizeStep(this.botY, b2, effectiveDx);
          }
        }
        
        // Final fallback: flatten both
        if (b2 - t2 < minH) {
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

    // Use provided chunk or create new one (pooling support)
    const chunk: Chunk = reuseChunk ?? {
      xStart,
      xEnd: xStart + widthPx,
      top: [],
      bottom: [],
      spikes: [],
      spikeFields: [],
      blocks: [],
      wheels: [],
      nebulas: [],
      pulsars: [],
      comets: [],
    };
    
    // Populate chunk properties (for reused chunks, arrays are already cleared)
    chunk.xStart = xStart;
    chunk.xEnd = xStart + widthPx;
    // Copy points into arrays (reuses existing array allocations if present)
    chunk.top.length = 0;
    chunk.bottom.length = 0;
    for (let i = 0; i < top.length; i++) {
      chunk.top.push(top[i]);
      chunk.bottom.push(bottom[i]);
    }

    if (!isEmpty) {
      // IMPORTANT: Place obstacles FIRST, then spikes
      // This ensures spike clearance zones around obstacles work correctly
      this.addBlocks(chunk, meters, canvasH, minH);
      this.addWheels(chunk, meters, canvasH, minH);
      this.addNebulas(chunk, meters, canvasH, minH);
      this.addPulsars(chunk, meters, canvasH, minH);
      this.addComets(chunk, meters, canvasH, minH);
      
      // Validate path - remove obstacles that don't leave passable gaps
      this.removeUnpassableObstacles(chunk);
      
      // Now add spikes (they will avoid obstacle clearance zones)
      this.addSurfaceSpikes(chunk, meters);

      // Guarantee: never leave a chunk "empty". If hazards are too sparse, force a small ground/ceiling spike cluster.
      this.ensureChunkHasAction(chunk, meters);
    }

    return chunk;
  }

  // Remove obstacles that don't leave passable gaps above AND below
  private removeUnpassableObstacles(chunk: Chunk): void {
    const minPath = CONFIG.OBSTACLE_MIN_CLEARANCE;
    
    // Filter blocks - keep only those with at least one passable gap
    chunk.blocks = chunk.blocks.filter(b => {
      const corridor = this.corridorAtX(chunk, b.x);
      const gapAbove = b.y - corridor.topY;
      const gapBelow = corridor.bottomY - (b.y + b.h);
      return gapAbove >= minPath || gapBelow >= minPath;
    });
    
    // Filter wheels - keep only those with at least one passable gap
    chunk.wheels = chunk.wheels.filter(w => {
      const corridor = this.corridorAtX(chunk, w.x);
      const gapAbove = (w.y - w.radius) - corridor.topY;
      const gapBelow = corridor.bottomY - (w.y + w.radius);
      return gapAbove >= minPath || gapBelow >= minPath;
    });
  }

  private ensureChunkHasAction(chunk: Chunk, meters: number): void {
    // "Something" means: any spikes, any block, or any wheel.
    // If we end up with nothing (or basically nothing), force a small surface spike cluster on a safe flat.
    const diff = this.difficulty01(meters);
    const hazardCount = chunk.spikes.length + chunk.blocks.length + chunk.wheels.length;

    // Reduced target spikes for less overwhelming gameplay
    const targetSpikes = clamp(Math.floor(lerp(1, 4, diff)), 1, 4); // Was 2-6
    if (hazardCount >= 1 && chunk.spikes.length >= targetSpikes) return;

    // If we already have a wheel or a block, that's usually enough challenge.
    // Only add more spikes if chunk is truly empty.
    const shouldAddCluster =
      hazardCount === 0 ||
      (chunk.spikes.length < targetSpikes && Math.random() < lerp(0.35, 0.55, diff)); // Reduced from 0.55-0.80
    if (!shouldAddCluster) return;

    const placeCluster = (useTop: boolean): boolean => {
      const path = useTop ? chunk.top : chunk.bottom;

      // Find flat segments that are NOT right next to slopes (corner flats)
      // AND are not in obstacle clearance zones.
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

        // Check if segment center is in obstacle clearance zone
        const centerX = (a.x + b.x) * 0.5;
        if (isInObstacleZone(chunk, centerX)) continue;

        candidates.push({ i, a, b });
      }

      if (candidates.length === 0) return false;

      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const segLen = pick.b.x - pick.a.x;
      const maxCount = Math.max(2, Math.floor((segLen - CONFIG.SPIKE_W) / CONFIG.SPIKE_SPACING));
      if (maxCount <= 0) return false;

      // Smaller clusters for less overwhelming gameplay
      const clusterCount = clamp(Math.floor(lerp(2, 4, diff)), 2, 4); // Was 3-6
      const count = Math.min(maxCount, clusterCount);

      const inset = CONFIG.SPIKE_W * 0.7;
      const centerX = (pick.a.x + pick.b.x) * 0.5;
      const startX = centerX - ((count - 1) * CONFIG.SPIKE_SPACING) * 0.5;
      
      // Pick ONE kind for this entire cluster - all spikes match
      const clusterKind = pickSpikeKind();

      for (let j = 0; j < count; j++) {
        const cx = clamp(startX + j * CONFIG.SPIKE_SPACING, pick.a.x + inset, pick.b.x - inset);
        // Skip if in obstacle zone or would overlap existing spike
        if (isInObstacleZone(chunk, cx)) continue;
        // Use default scale for overlap check
        const defaultScale = (CONFIG.SPIKE_SCALE_MIN + CONFIG.SPIKE_SCALE_MAX) * 0.5;
        if (!canPlaceSpike(chunk, cx, defaultScale)) continue;
        chunk.spikes.push(makeSpike(cx, pick.a.y, useTop, undefined, clusterKind));
      }
      return true;
    };

    // Choose top vs bottom, bias bottom slightly for readability.
    const useTop = Math.random() < 0.42;
    placeCluster(useTop);

    // Removed: secondary cluster on opposite surface (was too overwhelming)
  }

  // Validate that a clear path exists through the chunk
  // Returns true if at least one passable route exists around every obstacle
  private validateChunkPath(chunk: Chunk): boolean {
    const minPath = CONFIG.OBSTACLE_MIN_CLEARANCE;
    
    // Check each block has passable gaps
    for (const b of chunk.blocks) {
      const corridor = this.corridorAtX(chunk, b.x);
      const gapAbove = b.y - corridor.topY;
      const gapBelow = corridor.bottomY - (b.y + b.h);
      
      // At least one gap must be passable
      if (gapAbove < minPath && gapBelow < minPath) {
        return false;
      }
    }
    
    // Check each wheel has passable gaps
    for (const w of chunk.wheels) {
      const corridor = this.corridorAtX(chunk, w.x);
      const gapAbove = (w.y - w.radius) - corridor.topY;
      const gapBelow = corridor.bottomY - (w.y + w.radius);
      
      if (gapAbove < minPath && gapBelow < minPath) {
        return false;
      }
    }
    
    return true;
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
    // Higher spike probability to fill empty areas
    const pStrip = lerp(0.55, 0.80, diff);
    const maxSpikesPerChunk = clamp(Math.floor(lerp(16, 32, diff)), 14, 36);

    // Collect all valid flat segments
    interface FlatSegment {
      a: Point;
      b: Point;
      isTop: boolean;
      hasSpikes: boolean;
    }
    const flatSegments: FlatSegment[] = [];

    // Helper to check if a segment is a valid flat for spike placement
    const isValidFlat = (path: Point[], i: number): boolean => {
      const a = path[i];
      const b = path[i + 1];
      // Check if segment is flat (minimal Y change)
      const isFlat = Math.abs(b.y - a.y) < 0.1;
      if (!isFlat) return false;
      // Check if segment is long enough for spikes
      const segmentLength = Math.abs(b.x - a.x);
      if (segmentLength < CONFIG.SPIKE_W * 1.5) return false;
      // Valid flat segment!
      return true;
    };

    // Collect top flat segments
    for (let i = 0; i < chunk.top.length - 1; i++) {
      if (isValidFlat(chunk.top, i)) {
        flatSegments.push({ a: chunk.top[i], b: chunk.top[i + 1], isTop: true, hasSpikes: false });
      }
    }

    // Collect bottom flat segments
    for (let i = 0; i < chunk.bottom.length - 1; i++) {
      if (isValidFlat(chunk.bottom, i)) {
        flatSegments.push({ a: chunk.bottom[i], b: chunk.bottom[i + 1], isTop: false, hasSpikes: false });
      }
    }

    // STRICT BALANCING: Separate top and bottom segments
    const topSegments = flatSegments.filter(s => s.isTop);
    const bottomSegments = flatSegments.filter(s => !s.isTop);
    
    // Shuffle each list for variety
    const shuffle = <T>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    shuffle(topSegments);
    shuffle(bottomSegments);
    
    // Clear and rebuild with STRICT alternation (force equal distribution)
    flatSegments.length = 0;
    
    // Strictly alternate: top, bottom, top, bottom...
    // Start randomly with top or bottom to avoid bias
    let startWithTop = Math.random() < 0.5;
    let topIdx = 0;
    let botIdx = 0;
    let wantTop = startWithTop;
    
    while (topIdx < topSegments.length || botIdx < bottomSegments.length) {
      if (wantTop && topIdx < topSegments.length) {
        flatSegments.push(topSegments[topIdx++]);
        wantTop = false;
      } else if (!wantTop && botIdx < bottomSegments.length) {
        flatSegments.push(bottomSegments[botIdx++]);
        wantTop = true;
      } else if (topIdx < topSegments.length) {
        flatSegments.push(topSegments[topIdx++]);
      } else if (botIdx < bottomSegments.length) {
        flatSegments.push(bottomSegments[botIdx++]);
      }
    }

    // Helper to add a spike with overlap and obstacle zone checking
    // Now accepts kind parameter so all spikes in a group have the same type
    const tryAddSpike = (
      cx: number,
      baseY: number,
      isTop: boolean,
      scale?: number,
      kind?: "crystal" | "plasma" | "void" | "asteroid"
    ): boolean => {
      if (chunk.spikes.length >= maxSpikesPerChunk) return false;
      // Skip if in obstacle clearance zone
      if (isInObstacleZone(chunk, cx)) return false;
      // Calculate actual scale for overlap check
      const actualScale = scale ?? (CONFIG.SPIKE_SCALE_MIN + (CONFIG.SPIKE_SCALE_MAX - CONFIG.SPIKE_SCALE_MIN) * 0.5);
      // Skip if would overlap existing spike
      if (!canPlaceSpike(chunk, cx, actualScale)) return false;
      
      chunk.spikes.push(makeSpike(cx, baseY, isTop, scale, kind));
      return true;
    };

    // Add spike pattern to a segment - all spikes in a pattern share the same type
    const addPatternToSegment = (seg: FlatSegment): boolean => {
      if (chunk.spikes.length >= maxSpikesPerChunk) return false;
      const segLen = seg.b.x - seg.a.x;
      if (segLen < CONFIG.SPIKE_W * 2) return false;

      // Check if segment center is in obstacle zone
      const centerX = (seg.a.x + seg.b.x) * 0.5;
      if (isInObstacleZone(chunk, centerX)) return false;

      const pattern = pickSpikePattern(diff);
      const inset = CONFIG.SPIKE_W * 0.8;
      const baseY = seg.a.y;
      let added = false;
      
      // Pick ONE kind for this entire pattern - all spikes in the group will match
      const groupKind = pickSpikeKind();

      switch (pattern) {
        case "single_big": {
          added = tryAddSpike(centerX, baseY, seg.isTop, CONFIG.SPIKE_SCALE_BIG, groupKind);
          break;
        }

        case "field": {
          // Create a unified spike field instead of multiple small spikes
          const fieldWidth = Math.min(segLen - inset * 2, 140);
          const centerX = (seg.a.x + seg.b.x) * 0.5;
          const fieldHeight = CONFIG.SPIKE_H * CONFIG.SPIKE_SCALE_FIELD * (0.8 + Math.random() * 0.4);
          const peakCount = 5 + Math.floor(Math.random() * 5); // 5-9 peaks
          
          const spikeField: SpikeField = {
            x: centerX,
            baseY: baseY,
            width: fieldWidth,
            height: fieldHeight,
            isTop: seg.isTop,
            kind: groupKind,
            seed: Math.random() * 1000,
            peakCount: peakCount
          };
          chunk.spikeFields.push(spikeField);
          added = true;
          break;
        }

        case "staggered": {
          const count = Math.min(3, Math.floor((segLen - inset * 2) / (CONFIG.SPIKE_SPACING * 1.5)));
          if (count <= 0) break;
          
          const totalSpacing = segLen - inset * 2;
          const gap = totalSpacing / (count + 1);
          
          for (let i = 0; i < count; i++) {
            const cx = seg.a.x + inset + gap * (i + 1);
            const scale = 0.7 + Math.random() * 0.5;
            if (tryAddSpike(cx, baseY, seg.isTop, scale, groupKind)) added = true;
          }
          break;
        }

        case "sparse": {
          const availLen = segLen - inset * 2;
          const count = Math.min(2, Math.floor(availLen / (CONFIG.SPIKE_SPACING * 2.5)));
          if (count <= 0) {
            added = tryAddSpike(centerX, baseY, seg.isTop, 1.0, groupKind);
            break;
          }
          
          const gap = availLen / (count + 1);
          for (let i = 0; i < count; i++) {
            const cx = seg.a.x + inset + gap * (i + 1);
            if (tryAddSpike(cx, baseY, seg.isTop, 0.9 + Math.random() * 0.3, groupKind)) added = true;
          }
          break;
        }
      }
      
      return added;
    };

    // Track top/bottom spike counts for STRICT balancing
    let topSpikeCount = 0;
    let bottomSpikeCount = 0;
    
    // FIRST PASS: Add spikes with STRICT equal distribution enforcement
    for (const seg of flatSegments) {
      // Calculate imbalance - positive means too many top, negative means too many bottom
      const imbalance = topSpikeCount - bottomSpikeCount;
      
      // STRICT ENFORCEMENT: If imbalance is >= 2, SKIP the overrepresented side entirely
      if (seg.isTop && imbalance >= 2) continue; // Skip top if too many top spikes
      if (!seg.isTop && imbalance <= -2) continue; // Skip bottom if too many bottom spikes
      
      // Adjust probability based on imbalance
      let adjustedProb = pStrip;
      if (seg.isTop && imbalance > 0) {
        // Top is overrepresented - reduce probability
        adjustedProb = pStrip * 0.5;
      } else if (!seg.isTop && imbalance < 0) {
        // Bottom is overrepresented - reduce probability
        adjustedProb = pStrip * 0.5;
      } else if (seg.isTop && imbalance < 0) {
        // Top is underrepresented - BOOST probability
        adjustedProb = Math.min(1, pStrip * 2.0);
      } else if (!seg.isTop && imbalance > 0) {
        // Bottom is underrepresented - BOOST probability
        adjustedProb = Math.min(1, pStrip * 2.0);
      }
      
      if (Math.random() < adjustedProb) {
        if (addPatternToSegment(seg)) {
          seg.hasSpikes = true;
          if (seg.isTop) topSpikeCount++;
          else bottomSpikeCount++;
        }
      }
    }

    // SECOND PASS: Fill empty segments, PRIORITIZING the underrepresented side
    const emptySegmentKind = pickSpikeKind();
    
    // Separate empty segments by side and prioritize underrepresented
    const emptyTop = flatSegments.filter(s => !s.hasSpikes && s.isTop);
    const emptyBot = flatSegments.filter(s => !s.hasSpikes && !s.isTop);
    
    // Process underrepresented side FIRST until balanced
    while (topSpikeCount !== bottomSpikeCount && chunk.spikes.length < maxSpikesPerChunk) {
      const needTop = topSpikeCount < bottomSpikeCount;
      const targetList = needTop ? emptyTop : emptyBot;
      
      if (targetList.length === 0) break; // No more segments on needed side
      
      const seg = targetList.shift()!;
      const segLen = seg.b.x - seg.a.x;
      if (segLen < CONFIG.SPIKE_W * 1.5) continue;
      
      const centerX = (seg.a.x + seg.b.x) * 0.5;
      if (isInObstacleZone(chunk, centerX)) continue;
      
      const baseY = seg.a.y;
      const scale = 0.8 + Math.random() * 0.4;
      if (tryAddSpike(centerX, baseY, seg.isTop, scale, emptySegmentKind)) {
        if (seg.isTop) topSpikeCount++;
        else bottomSpikeCount++;
      }
    }
    
    // Fill remaining empty segments (alternating to maintain balance)
    const remaining = [...emptyTop, ...emptyBot];
    shuffle(remaining);
    
    for (const seg of remaining) {
      if (chunk.spikes.length >= maxSpikesPerChunk) break;
      
      // Skip if adding would create imbalance
      const imbalance = topSpikeCount - bottomSpikeCount;
      if (seg.isTop && imbalance >= 1) continue;
      if (!seg.isTop && imbalance <= -1) continue;
      
      const segLen = seg.b.x - seg.a.x;
      if (segLen < CONFIG.SPIKE_W * 1.5) continue;
      
      const centerX = (seg.a.x + seg.b.x) * 0.5;
      if (isInObstacleZone(chunk, centerX)) continue;
      
      const baseY = seg.a.y;
      const scale = 0.8 + Math.random() * 0.4;
      if (tryAddSpike(centerX, baseY, seg.isTop, scale, emptySegmentKind)) {
        if (seg.isTop) topSpikeCount++;
        else bottomSpikeCount++;
      }
    }
  }

  private addBlocks(chunk: Chunk, meters: number, canvasH: number, minH: number): void {
    const diff = this.difficulty01(meters);
    const isGauntlet = this.isGauntletPattern();
    
    // Gauntlet pattern: higher spawn rate and more blocks
    // Reduced spawn probability at high difficulty to avoid overcrowding
    const pBlock = isGauntlet ? 0.85 : lerp(0.30, 0.55, diff);

    // Allow up to 2 blocks per chunk, or 4 during gauntlet for dense obstacle field
    const maxBlocks = isGauntlet ? 4 : (diff < 0.30 ? 1 : 2);
    const minSpacingX = isGauntlet ? 180 : 280; // Tighter spacing in gauntlet

    const tooClose = (x: number): boolean => {
      for (const b of chunk.blocks) if (Math.abs(b.x - x) < minSpacingX) return true;
      for (const w of chunk.wheels) if (Math.abs(w.x - x) < minSpacingX) return true;
      return false;
    };

    // Minimum clearance above AND below the obstacle for safe passage
    const minClearance = CONFIG.OBSTACLE_MIN_CLEARANCE;

    // Candidate lanes (left->right) so obstacles are distributed instead of clumped.
    const placements = [0.26, 0.44, 0.62, 0.80];
    for (let pi = 0; pi < placements.length && chunk.blocks.length < maxBlocks; pi++) {
      if (Math.random() > pBlock) continue;
      const jitter = (Math.random() * 2 - 1) * 0.06;
      const x = chunk.xStart + CONFIG.CHUNK_WIDTH * clamp(placements[pi] + jitter, 0.18, 0.90);
      if (tooClose(x)) continue;

      const c = this.corridorAtX(chunk, x);
      const corridorH = c.bottomY - c.topY;
      
      // Corridor must be wide enough for obstacle + clearance on BOTH sides
      // minClearance * 2 (above + below) + minimum block height (50)
      const minCorridorForBlock = minClearance * 2 + 50;
      if (corridorH < minCorridorForBlock) continue;

      // Max block height ensures clearance on both sides
      const maxBlockH = corridorH - minClearance * 2;
      if (maxBlockH < 50) continue;

      // Smaller blocks to ensure passable gaps
      const w = lerp(70, 110, Math.random()); // Reduced from 76-126
      const h = clamp(lerp(50, maxBlockH * 0.65, Math.random()), 50, 130); // Reduced max from 160
      
      // Center the block, ensuring minimum clearance above and below
      const y = c.topY + corridorH * 0.5 - h * 0.5;
      const gapAbove = y - c.topY;
      const gapBelow = c.bottomY - (y + h);

      // Verify both gaps meet minimum clearance
      if (gapAbove < minClearance || gapBelow < minClearance) continue;

      // Safety: keep block within corridor bounds
      if (x - w * 0.5 < chunk.xStart + 40) continue;
      if (x + w * 0.5 > chunk.xEnd - 40) continue;

      // Randomly assign a visual style (ship, nebula, or asteroid)
      const kinds: Array<"ship" | "nebula" | "asteroid"> = ["ship", "nebula", "asteroid"];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const block: Block = { x, y, w, h, seed: Math.random(), spikes: [], kind };
      // NOTE: Spikes are ground/ceiling only. Floating obstacles never add spikes.
      chunk.blocks.push(block);
    }
  }

  // Rolling spike wheels (static in world, visually rotating)
  private addWheels(chunk: Chunk, meters: number, canvasH: number, minH: number): void {
    // Low chance early, higher chance later
    const diff = this.difficulty01(meters);
    const isGauntlet = this.isGauntletPattern();
    
    // Gauntlet pattern: higher spawn rate
    const pWheel = isGauntlet ? 0.65 : lerp(0.10, 0.22, diff);

    // Wheels: max 1 per chunk, or 2 during gauntlet
    const maxWheels = isGauntlet ? 2 : 1;
    const minSpacingX = isGauntlet ? 200 : 280;
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

    // Minimum clearance above AND below the wheel for safe passage
    const minClearance = CONFIG.OBSTACLE_MIN_CLEARANCE;

    const tryPlaceWheel = (): void => {
      if (Math.random() > pWheel) return;
      if (chunk.wheels.length >= maxWheels) return;

      // Try a couple candidate spots so we don't frequently fail due to spacing.
      for (let attempt = 0; attempt < 3; attempt++) {
        const x = pickX();
        if (!canPlaceAtX(x)) continue;

        const c = this.corridorAtX(chunk, x);
        const corridorH = c.bottomY - c.topY;

        // Corridor must be wide enough for wheel + clearance on BOTH sides
        // diameter + minClearance * 2
        const minCorridorForWheel = minClearance * 2 + 50; // 50 = minimum diameter
        if (corridorH < minCorridorForWheel) continue;

        // Max radius ensures clearance on both sides
        const maxRadius = (corridorH - minClearance * 2) * 0.5;
        if (maxRadius < 24) continue;
        // Smaller wheels for better clearance
        const radius = lerp(24, Math.min(50, maxRadius), Math.random()); // Reduced from 26-60

        const y = c.topY + corridorH * 0.5;
        const gapAbove = y - radius - c.topY;
        const gapBelow = c.bottomY - (y + radius);

        // Verify both gaps meet minimum clearance
        if (gapAbove < minClearance || gapBelow < minClearance) continue;

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

  // Nebula Clouds - semi-transparent swirling hazard zones
  private addNebulas(chunk: Chunk, meters: number, _canvasH: number, _minH: number): void {
    const diff = this.difficulty01(meters);
    // Higher chance - these are visually striking obstacles
    const pNebula = lerp(0.25, 0.45, diff);
    
    if (Math.random() > pNebula) return;
    
    // Reduced spacing - nebulas can be closer to other obstacles
    const minSpacingX = 150;
    const canPlaceAtX = (x: number): boolean => {
      for (const b of chunk.blocks) if (Math.abs(b.x - x) < minSpacingX) return false;
      for (const w of chunk.wheels) if (Math.abs(w.x - x) < minSpacingX) return false;
      for (const n of chunk.nebulas) if (Math.abs(n.x - x) < minSpacingX) return false;
      return true;
    };
    
    for (let attempt = 0; attempt < 5; attempt++) {
      const x = chunk.xStart + CONFIG.CHUNK_WIDTH * (0.2 + Math.random() * 0.6);
      if (!canPlaceAtX(x)) continue;
      
      const c = this.corridorAtX(chunk, x);
      const corridorH = c.bottomY - c.topY;
      
      // Reduced corridor requirement - nebulas are smaller now
      if (corridorH < 120) continue;
      
      // Smaller nebulas that leave room to pass
      const maxSize = Math.min(corridorH * 0.4, 100); // Never more than 40% of corridor
      const width = lerp(60, maxSize, Math.random());
      const height = lerp(50, maxSize * 0.8, Math.random());
      const y = c.topY + corridorH * (0.25 + Math.random() * 0.5); // Float in middle area
      
      const colors: Array<"purple" | "pink" | "cyan"> = ["purple", "pink", "cyan"];
      const color = colors[Math.floor(Math.random() * colors.length)];
      
      chunk.nebulas.push({
        x,
        y,
        width,
        height,
        seed: Math.random() * 1000,
        intensity: lerp(0.5, 1.0, diff),
        color
      });
      return;
    }
  }

  // Pulsars - rotating energy beams that sweep the corridor
  private addPulsars(chunk: Chunk, meters: number, _canvasH: number, _minH: number): void {
    const diff = this.difficulty01(meters);
    // Higher chance - pulsars are interesting obstacles
    const pPulsar = lerp(0.15, 0.35, diff);
    
    if (Math.random() > pPulsar) return;
    if (meters < 100) return; // Spawn a bit earlier (was 200)
    
    // Reduced spacing - pulsars can be closer to other obstacles
    const minSpacingX = 200;
    const canPlaceAtX = (x: number): boolean => {
      for (const b of chunk.blocks) if (Math.abs(b.x - x) < minSpacingX) return false;
      for (const w of chunk.wheels) if (Math.abs(w.x - x) < minSpacingX) return false;
      for (const n of chunk.nebulas) if (Math.abs(n.x - x) < minSpacingX) return false;
      for (const p of chunk.pulsars) if (Math.abs(p.x - x) < minSpacingX) return false;
      return true;
    };
    
    for (let attempt = 0; attempt < 5; attempt++) {
      const x = chunk.xStart + CONFIG.CHUNK_WIDTH * (0.3 + Math.random() * 0.4);
      if (!canPlaceAtX(x)) continue;
      
      const c = this.corridorAtX(chunk, x);
      const corridorH = c.bottomY - c.topY;
      
      // Reduced corridor requirement - smaller pulsars
      if (corridorH < 140) continue;
      
      const y = c.topY + corridorH * 0.5;
      // Longer beam - reaches 40% of corridor for more visual impact
      const radius = Math.min(corridorH * 0.4, 80);
      
      const colors: Array<"cyan" | "magenta" | "white"> = ["cyan", "magenta", "white"];
      const color = colors[Math.floor(Math.random() * colors.length)];
      
      chunk.pulsars.push({
        x,
        y,
        radius,
        angle: Math.random() * Math.PI * 2,
        speed: lerp(1.2, 2.0, Math.random()), // Slightly slower rotation
        beamWidth: lerp(12, 18, Math.random()), // Visible beam width
        color
      });
      return;
    }
  }

  // Comets - moving obstacles with glowing trails
  private addComets(chunk: Chunk, meters: number, _canvasH: number, _minH: number): void {
    const diff = this.difficulty01(meters);
    const isGauntlet = this.isGauntletPattern();
    
    // Gauntlet pattern: higher spawn rate
    const pComet = isGauntlet ? 0.75 : lerp(0.18, 0.40, diff);
    
    if (Math.random() > pComet) return;
    
    const minSpacingX = isGauntlet ? 180 : 250;
    const canPlaceAtX = (x: number): boolean => {
      for (const b of chunk.blocks) if (Math.abs(b.x - x) < minSpacingX) return false;
      for (const w of chunk.wheels) if (Math.abs(w.x - x) < minSpacingX) return false;
      for (const c of chunk.comets) if (Math.abs(c.startX - x) < minSpacingX) return false;
      return true;
    };
    
    for (let attempt = 0; attempt < 3; attempt++) {
      const startX = chunk.xStart + CONFIG.CHUNK_WIDTH * (0.2 + Math.random() * 0.3);
      if (!canPlaceAtX(startX)) continue;
      
      const c = this.corridorAtX(chunk, startX);
      const corridorH = c.bottomY - c.topY;
      
      if (corridorH < 160) continue;
      
      // Comets move diagonally or horizontally
      const moveVertical = Math.random() > 0.6;
      const startY = moveVertical 
        ? c.topY + corridorH * (Math.random() > 0.5 ? 0.2 : 0.8)
        : c.topY + corridorH * (0.3 + Math.random() * 0.4);
      
      let endX = startX + lerp(150, 250, Math.random());
      let endY = moveVertical
        ? c.topY + corridorH * (startY < c.topY + corridorH * 0.5 ? 0.8 : 0.2)
        : startY + (Math.random() - 0.5) * corridorH * 0.3;
      
      // Ensure minimum path distance to prevent freeze bug
      const pathDist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
      if (pathDist < 80) {
        endX = startX + 120; // Extend horizontally
      }
      
      const colors: Array<"blue" | "orange" | "green"> = ["blue", "orange", "green"];
      const color = colors[Math.floor(Math.random() * colors.length)];
      
      // Speed scales with distance: slow at start (50-80), fast later (120-180)
      const baseSpeed = lerp(50, 120, diff);
      const speedVariance = lerp(30, 60, diff);
      const speed = baseSpeed + Math.random() * speedVariance;
      
      chunk.comets.push({
        x: startX,
        y: startY,
        startX,
        startY,
        endX,
        endY,
        speed, // Now scales with difficulty
        size: lerp(8, 14, Math.random()),
        progress: 0,
        tailLength: lerp(40, 70, Math.random()),
        color
      });
      return;
    }
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
  
  // Device detection
  private isMobile = window.matchMedia("(pointer: coarse)").matches;

  private state: GameState = "START";
  private lastT = performance.now();
  
  // FPS capping and adaptive framerate
  private targetFPS = 60;
  private frameInterval = 1000 / 60; // ms between frames
  private lastFrameTime = 0;
  private frameTimes: number[] = []; // Track recent frame times for adaptive FPS
  private isBackgrounded = false; // Pause when tab/app is hidden
  private loopRunning = false; // Track if game loop is active (stops on GAME_OVER to save battery)

  private settings: Settings = { music: true, fx: true, haptics: true };

  private audio = new AudioFx();

  private waveX = 0;
  private waveY = 0; // screen-space (derived from waveWorldY - camY)
  private waveWorldY = 0; // world-space (physics position; camera must not affect this)
  private holding = false;
  private prevHolding = false; // track previous holding state for haptic feedback
  private scrollX = 0;
  private meters = 0;
  private speedMul = 1;
  private isSlidingOnSurface = false; // true when clamped to roof/ground
  private slidingSurface: "top" | "bottom" | null = null; // which surface we were clamped to last frame
  private prevRoofSlopeUp = false; // track if we were sliding up a roof slope last frame
  private cachedCorridorInfo: { x: number; info: { topY: number; bottomY: number; topFlat: boolean; bottomFlat: boolean; topDy: number; bottomDy: number } } | null = null; // cache corridor info

  private camY = 0;
  private shakeT = 0;
  private shakeX = 0;
  private shakeY = 0;
  private deathFlashT = 0;
  private deathDelayT = 0; // seconds before showing Game Over UI

  // Trail uses CircularBuffer for O(1) push/shift operations
  private trail = new CircularBuffer<TrailPoint>(50);
  private deathShards: DeathShard[] = [];
  
  // Reusable visibility arrays (avoid per-frame allocation)
  private visibleBlocks: Block[] = [];
  private visibleSpikes: SpikeTri[] = [];
  private visibleFields: SpikeField[] = [];
  private visibleWheels: Wheel[] = [];
  private visibleNebulas: NebulaCloud[] = [];
  private visiblePulsars: Pulsar[] = [];
  private visibleComets: Comet[] = [];
  
  // Gradient cache for reduced GPU allocation
  private gradientCache: GradientCache | null = null;
  
  // Glow cache for pre-rendered glow sprites (replaces expensive shadowBlur)
  private glowCache: GlowCache | null = null;
  
  // WebGL particle renderer for trails and death effects
  private particleGL: ParticleGL | null = null;
  
  // Chunk pool for reduced memory allocation
  private chunkPool = new ObjectPool<Chunk>(
    // Factory: create empty chunk
    () => ({
      xStart: 0,
      xEnd: 0,
      top: [],
      bottom: [],
      spikes: [],
      spikeFields: [],
      blocks: [],
      wheels: [],
      nebulas: [],
      pulsars: [],
      comets: [],
    }),
    // Reset: clear all arrays but preserve allocations
    (c) => {
      c.xStart = 0;
      c.xEnd = 0;
      c.top.length = 0;
      c.bottom.length = 0;
      c.spikes.length = 0;
      c.spikeFields.length = 0;
      c.blocks.length = 0;
      c.wheels.length = 0;
      c.nebulas.length = 0;
      c.pulsars.length = 0;
      c.comets.length = 0;
    },
    12 // Pre-allocate 12 chunks (max is 8 active + buffer)
  );
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
    wallFill: CONFIG.WALL_FILL,
    wallPattern: CONFIG.WALL_PATTERN,
  };
  private paletteOffset = 0; // Random offset to start from different colors each game

  // Cached wall pattern (huge perf win vs drawing thousands of tiny shapes every frame)
  private wallPattern: CanvasPattern | null = null;
  private wallPatternTile: HTMLCanvasElement | null = null;
  private lastWallPatternColor = ""; // Track color to rebuild pattern when it changes

  // Chunk generation queue (keeps generation work away from critical frames)
  private pendingChunkStarts: number[] = [];
  private plannedXEnd = 0;

  private gen = new LevelGen();
  private chunks: Chunk[] = [];

  // Pixel-art mode looks best when the world is rendered on whole pixels.
  // We keep physics/camera in floats, but snap ONLY for rendering to avoid "swimming/sliding" artifacts.
  private renderScrollX(): number {
    return CONFIG.PIXEL_ART ? Math.round(this.scrollX) : this.scrollX;
  }

  private renderCamY(): number {
    return CONFIG.PIXEL_ART ? Math.round(this.camY) : this.camY;
  }
  
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
    
    // Initialize FPS settings based on device
    this.targetFPS = this.isMobile ? CONFIG.TARGET_FPS_MOBILE : CONFIG.TARGET_FPS_DESKTOP;
    this.frameInterval = 1000 / this.targetFPS;
    PERF.targetFPS = this.targetFPS;
    PERF.glowQuality = this.isMobile ? CONFIG.GLOW_QUALITY_MOBILE : CONFIG.GLOW_QUALITY_DESKTOP;
    
    // Initialize gradient cache for performance
    this.gradientCache = new GradientCache(this.ctx);
    
    // Initialize glow cache for pre-rendered glow sprites
    this.glowCache = new GlowCache(this.isMobile);
    
    // Initialize WebGL particle renderer
    this.particleGL = new ParticleGL(document.body);

    this.loadSettings();
    this.applySettingsToUI();

    this.onResize();
    this.generateStars();
    window.addEventListener("resize", () => this.onResize());
    
    // Pause rendering when tab/app is backgrounded (saves battery)
    document.addEventListener("visibilitychange", () => {
      this.isBackgrounded = document.hidden;
      if (!this.isBackgrounded) {
        // Reset timing when returning to foreground to avoid large dt spike
        this.lastT = performance.now();
        this.lastFrameTime = performance.now();
      }
    });

    this.setupInput();
    this.setupUI();

    this.resetRun();
    this.startLoop();
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
    // Use viewport dimensions (window.inner*) to fit within available space (respects platform UI).
    if (forceLandscape) {
      // Use viewport dimensions so container fits within visible area (not physical screen)
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      // In portrait mode: viewportW < viewportH, so after rotation:
      // - Game width (horizontal) = viewportH (the taller dimension)
      // - Game height (vertical) = viewportW (the shorter dimension)
      this._viewW = viewportH;
      this._viewH = viewportW;
      this.gameContainer.style.position = "fixed";
      this.gameContainer.style.left = "50%";
      this.gameContainer.style.top = "50%";
      this.gameContainer.style.width = `${viewportH}px`;
      this.gameContainer.style.height = `${viewportW}px`;
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

    // Apply landscape classes for mobile orientation (for UI adjustments)
    const isLandscape = window.innerWidth > window.innerHeight;
    
    // forcedLandscape: container is rotated 90° (portrait device, landscape game)
    // landscapeMode: natural landscape orientation (no rotation)
    if (forceLandscape) {
      this.gameContainer.classList.add("forcedLandscape");
      this.gameContainer.classList.remove("landscapeMode");
    } else if (isMobile && isLandscape) {
      this.gameContainer.classList.add("landscapeMode");
      this.gameContainer.classList.remove("forcedLandscape");
    } else {
      this.gameContainer.classList.remove("landscapeMode");
      this.gameContainer.classList.remove("forcedLandscape");
    }

    this.canvas.width = Math.floor(this._viewW * dpr);
    this.canvas.height = Math.floor(this._viewH * dpr);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    
    // Resize particle renderer to match
    if (this.particleGL) {
      this.particleGL.resize(this._viewW, this._viewH, dpr);
    }

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
    // Temporary; we'll snap to corridor center after we generate the intro chunk.
    this.waveWorldY = this.viewH() * 0.52;
    this.waveY = this.waveWorldY - this.camY;
    this.trail.clear();
    this.holding = false;
    this.prevHolding = false;
    this.prevRoofSlopeUp = false;

    // Randomize starting palette offset for very different colors each game
    this.paletteOffset = Math.random() * PALETTE_KEYFRAMES.length;
    
    // Invalidate wall pattern cache so it rebuilds with new colors
    this.wallPattern = null;
    this.lastWallPatternColor = "";
    
    // Clear gradient cache for fresh start
    if (this.gradientCache) {
      this.gradientCache.clear();
    }
    
    // Clear glow cache for fresh start
    if (this.glowCache) {
      this.glowCache.clear();
    }
    
    // Clear particle system
    if (this.particleGL) {
      this.particleGL.clear();
    }
    
    // Clear corridor info cache
    this.cachedCorridorInfo = null;

    this.gen.reset(this.viewW(), this.viewH());
    // Release old chunks back to pool
    for (const c of this.chunks) {
      this.chunkPool.release(c);
    }
    this.chunks = [];
    this.pendingChunkStarts = [];

    // Intro: always start with a straight corridor and no obstacles for the first 100m.
    const introPx = CONFIG.INTRO_SAFE_METERS * 10; // meters are worldX/10
    const pooledChunk = this.chunkPool.acquire();
    const introChunk = this.gen.nextChunk(0, this.viewW(), this.viewH(), 0, true, undefined, introPx, pooledChunk);
    this.chunks.push(introChunk);

    // Ensure the player always spawns inside the corridor (critical on small resolutions).
    const spawnX = this.waveX; // worldX when scrollX=0
    const spawnBounds = this.corridorAtX(introChunk, spawnX);
    this.waveWorldY = (spawnBounds.topY + spawnBounds.bottomY) * 0.5;
    this.waveY = this.waveWorldY - this.camY;

    // Then prebuild a few normal chunks (using pool).
    let x = introPx;
    for (let i = 0; i < 5; i++) {
      const m = x / 10;
      const pooled = this.chunkPool.acquire();
      const c = this.gen.nextChunk(x, this.viewW(), this.viewH(), m, false, undefined, undefined, pooled);
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
    // Use reduced star count on mobile for better performance
    const starCount = this.isMobile ? CONFIG.STAR_COUNT_MOBILE : CONFIG.STAR_COUNT_DESKTOP;
    for (let i = 0; i < starCount; i++) {
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

    // Use reduced planet count on mobile for better performance
    const count = this.isMobile ? CONFIG.PLANET_COUNT_MOBILE : CONFIG.PLANET_COUNT_DESKTOP;
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
    const tSec = performance.now() * 0.001;
    // Combine distance-based drift with a small time drift for a continuously shifting background.
    // Add paletteOffset to start from a different color each game
    const phase = this.paletteOffset + meters / Math.max(1, CONFIG.PALETTE_SHIFT_METERS) + tSec * CONFIG.PALETTE_TIME_SPEED;
    const i0 = ((Math.floor(phase) % keys.length) + keys.length) % keys.length;
    const i1 = (i0 + 1) % keys.length;
    const t = smoothstep(phase - Math.floor(phase));

    const a = keys[i0];
    const b = keys[i1];

    // Skip update if interpolation inputs are invalid
    if (Number.isNaN(t) || Number.isNaN(phase) || !a || !b) {
      return;
    }

    const bgTop = lerp3(a.bgTop, b.bgTop, t);
    const bgBottom = lerp3(a.bgBottom, b.bgBottom, t);
    const grid = lerp4(a.grid, b.grid, t);
    const glow = lerp4(a.waveGlow, b.waveGlow, t);
    const trail = lerp4(a.trail, b.trail, t);
    const wallFill = lerp3(a.wallFill, b.wallFill, t);
    const wallPattern = lerp4(a.wallPattern, b.wallPattern, t);

    // Validate and assign colors - rgb/rgba functions now handle NaN defensively
    this.runtimePalette.bgTop = rgb(bgTop[0], bgTop[1], bgTop[2]);
    this.runtimePalette.bgBottom = rgb(bgBottom[0], bgBottom[1], bgBottom[2]);
    this.runtimePalette.grid = rgba(grid[0], grid[1], grid[2], grid[3]);
    this.runtimePalette.waveGlow = rgba(glow[0], glow[1], glow[2], glow[3]);
    this.runtimePalette.trail = rgba(trail[0], trail[1], trail[2], trail[3]);
    this.runtimePalette.wallFill = rgb(wallFill[0], wallFill[1], wallFill[2]);
    this.runtimePalette.wallPattern = rgba(wallPattern[0], wallPattern[1], wallPattern[2], wallPattern[3]);
  }

  private setupUI(): void {
    const playBtn = document.getElementById("playBtn");
    const optionsBtn = document.getElementById("optionsBtn");
    const restartBtn = document.getElementById("restartBtn");
    const menuBtn = document.getElementById("menuBtn");
    const resumeBtn = document.getElementById("resumeBtn");

    // Helper to add both click and touchend handlers for reliable button response.
    // touchend bypasses iOS click synthesis issues with CSS-transformed containers (90° rotation).
    // Uses debounce to prevent double-fire when both touchend and click trigger.
    const addButtonHandler = (el: HTMLElement | null, handler: () => void) => {
      if (!el) return;
      let lastFire = 0;
      const DEBOUNCE_MS = 150;
      const debounced = () => {
        const now = Date.now();
        if (now - lastFire < DEBOUNCE_MS) return;
        lastFire = now;
        handler();
      };
      el.addEventListener("click", debounced);
      el.addEventListener("touchend", (e) => {
        e.preventDefault(); // Prevent duplicate click event
        debounced();
      }, { passive: false });
    };

    addButtonHandler(playBtn, () => {
      this.uiClick();
      this.start();
    });

    addButtonHandler(optionsBtn, () => {
      this.uiClick();
      this.toggleSettings();
      triggerHaptic(this.settings, "light");
    });

    addButtonHandler(restartBtn, () => {
      this.uiClick();
      this.restart();
    });

    addButtonHandler(menuBtn, () => {
      this.uiClick();
      this.showMenu();
      triggerHaptic(this.settings, "light");
    });

    addButtonHandler(resumeBtn, () => {
      this.uiClick();
      this.resume();
    });

    addButtonHandler(this.pauseBtn, () => {
      this.uiClick();
      if (this.state === "PLAYING") this.pause();
      else if (this.state === "PAUSED") this.resume();
    });

    addButtonHandler(this.settingsBtn, () => {
      this.uiClick();
      this.toggleSettings();
    });

    addButtonHandler(this.settingsCloseBtn, () => {
      this.uiClick();
      this.setSettingsOpen(false);
      triggerHaptic(this.settings, "light");
    });

    addButtonHandler(this.settingsBackdrop, () => {
      this.uiClick();
      this.setSettingsOpen(false);
      triggerHaptic(this.settings, "light");
    });

    const toggle = (el: HTMLElement, key: keyof Settings) => {
      const handler = () => {
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
      };
      addButtonHandler(el, handler);
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
        // Don't call preventDefault() here - it kills native button click events on mobile
        return;
      }
      pointerDown = true;
      handlePress(e);
      syncHolding();
    };
    const onPointerUp = (_e: PointerEvent): void => {
      pointerDown = false;
      // Note: No preventDefault() here - touch-action: none in CSS handles scroll/zoom prevention,
      // and calling preventDefault() on pointerup can break button click events on mobile.
      syncHolding();
    };

    // Pointer events scoped to canvas only - this prevents interference with button click events.
    // Other games (paper-plane, draw-the-thing) use this pattern successfully.
    this.canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    this.canvas.addEventListener("pointerup", onPointerUp, { passive: false });
    this.canvas.addEventListener("pointercancel", onPointerUp, { passive: false });

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
    this.startLoop(); // Restart loop if it was stopped on GAME_OVER
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

    console.log("[WaveModeGame] Game over. Distance:", final);
    // Animate counter (distance only)
    this.newRecordEl.style.display = "none";
    this.animateGameOverCounters(final);

    this.gameOverOverlay.classList.remove("hidden");
    this.pauseOverlay.classList.add("hidden");

    // Submit score to platform (no local highscore tracking)
    if (typeof (window as any).submitScore === "function") {
      (window as any).submitScore(final);
    }
  }

  private animateGameOverCounters(finalMeters: number): void {
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

      this.finalDistanceEl.textContent = `Distance: ${d}m`;

      if (this.settings.fx) {
        if (d >= lastTickValue + step && d < finalMeters) {
          lastTickValue = d;
          this.audio.tick();
        }
      }

      if (t < 1) this.counterAnimRaf = requestAnimationFrame(tick);
    };

    // reset label instantly so it always counts up cleanly
    this.finalDistanceEl.textContent = "Distance: 0m";
    this.counterAnimRaf = requestAnimationFrame(tick);
  }

  private loop(): void {
    // Stop loop entirely on GAME_OVER to save battery
    if (this.state === "GAME_OVER") {
      this.loopRunning = false;
      return;
    }
    
    try {
    const now = performance.now();
      
      // Skip frames when backgrounded (saves CPU/battery)
      if (this.isBackgrounded) {
        requestAnimationFrame(() => this.loop());
        return;
      }
      
      // FPS capping: only render if enough time has passed
      const elapsed = now - this.lastFrameTime;
      if (elapsed < this.frameInterval) {
        requestAnimationFrame(() => this.loop());
        return;
      }
      
      // Track frame times for adaptive FPS (last 30 frames)
      this.frameTimes.push(elapsed);
      if (this.frameTimes.length > 30) this.frameTimes.shift();
      
      // Adaptive quality: if frames are taking too long, reduce quality
      if (CONFIG.ADAPTIVE_FPS && this.frameTimes.length >= 10) {
        const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        const targetFrameTime = this.frameInterval;
        const ratio = avgFrameTime / targetFrameTime;
        
        // If consistently running slow, reduce quality
        if (ratio > CONFIG.ADAPTIVE_FPS_THRESHOLD + 0.2) {
          PERF.qualityLevel = Math.max(0.5, PERF.qualityLevel - 0.1);
          PERF.shadowBlurEnabled = PERF.qualityLevel > 0.7;
          this.frameTimes = []; // Reset after adjustment
        } else if (ratio < CONFIG.ADAPTIVE_FPS_THRESHOLD && PERF.qualityLevel < 1.0) {
          // Running well, can increase quality
          PERF.qualityLevel = Math.min(1.0, PERF.qualityLevel + 0.05);
          PERF.shadowBlurEnabled = PERF.qualityLevel > 0.7;
          this.frameTimes = []; // Reset after adjustment
        }
      }
      
      // Account for frame time overshoot to prevent drift
      this.lastFrameTime = now - (elapsed % this.frameInterval);
      
    const dt = Math.min(0.033, (now - this.lastT) / 1000);
    this.lastT = now;

    this.update(dt);
    this.render();
      requestAnimationFrame(() => this.loop());
    } catch (err) {
      console.error('[WaveMode] Loop error:', err);
      requestAnimationFrame(() => this.loop());
    }
  }
  
  /** Start the game loop if not already running */
  private startLoop(): void {
    if (this.loopRunning) return;
    this.loopRunning = true;
    this.lastT = performance.now();
    this.lastFrameTime = performance.now();
    requestAnimationFrame(() => this.loop());
  }

  private update(dt: number): void {
    if (this.deathFlashT > 0) this.deathFlashT -= dt * 1000;
    this.updateDeathVfx(dt);
    
    // Update WebGL particles
    if (this.particleGL) {
      this.particleGL.update(dt);
    }

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

    // Haptic feedback when changing direction (going up or down)
    if (this.holding !== this.prevHolding) {
      triggerHaptic(this.settings, "light");
    }
    this.prevHolding = this.holding;

    this.scrollX += vx * dt;
    // IMPORTANT: vertical motion is in world-space so camera motion never changes the movement angle.
    this.waveWorldY += vy * dt;

    // Keep chunks far ahead and generate them with a tiny time budget per frame
    this.enqueueChunksAhead();
    this.processChunkQueue(0.8); // Reduced from 1.2ms for better performance

    // Update comet positions (they move back and forth)
    updateComets(this.chunks, dt);

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
    // - Slopes:
    //   - Ground (bottom): allow sliding only when moving DOWN (release) and the segment slopes DOWN (or flat).
    //   - Roof (top): allow sliding only when moving UP (hold) AND you were already sliding on the roof.
    //     This is the "opposite of ground": you can ride up roof slopes once you're latched, but you can't ride down them.
    let worldY = this.waveWorldY;
    const wasSlidingTop = this.slidingSurface === "top";
    this.slidingSurface = null;
    this.isSlidingOnSurface = false;
    if (currentChunk) {
      // Cache corridor info to avoid recalculating if x hasn't changed much
      const cacheThreshold = 5; // pixels
      let info: { topY: number; bottomY: number; topFlat: boolean; bottomFlat: boolean; topDy: number; bottomDy: number };
      if (this.cachedCorridorInfo && Math.abs(this.cachedCorridorInfo.x - worldX) < cacheThreshold) {
        info = this.cachedCorridorInfo.info;
      } else {
        info = this.corridorAtXInfo(currentChunk, worldX);
        this.cachedCorridorInfo = { x: worldX, info };
      }
      // On 45° slopes the perpendicular distance to the wall is ~verticalDelta / sqrt(2),
      // so we increase the vertical margin on sloped segments to avoid dying while "sliding down".
      const r = CONFIG.WAVE_SIZE * 0.55;
      const baseMargin = r + 2.5;
      const topSlopeFactor = info.topFlat ? 1 : Math.SQRT2;
      const bottomSlopeFactor = info.bottomFlat ? 1 : Math.SQRT2;
      const minY = info.topY + baseMargin * topSlopeFactor;
      const maxY = info.bottomY - baseMargin * bottomSlopeFactor;
      const movingDown = !this.holding;
      const movingUp = this.holding;

      if (worldY < minY) {
        // Roof:
        // - Flat: always allow.
        // - Sloped: only allow if we were already roof-sliding AND we're moving UP (hold)
        //   AND the roof segment is sloping UP (or essentially flat).
        const roofSlopeUpOrFlat = info.topDy <= 0.1;
        const isSlidingUpSlope = !info.topFlat && movingUp && roofSlopeUpOrFlat;
        const topAllowsSlide = info.topFlat || (wasSlidingTop && isSlidingUpSlope);
        if (topAllowsSlide) {
          worldY = minY;
          this.waveWorldY = worldY;
          this.isSlidingOnSurface = true;
          // Haptic feedback when first touching the roof
          if (!wasSlidingTop) {
            triggerHaptic(this.settings, "light");
          }
          // Haptic feedback when transitioning to sliding up a roof slope
          if (wasSlidingTop && isSlidingUpSlope && !this.prevRoofSlopeUp) {
            triggerHaptic(this.settings, "light");
          }
          this.slidingSurface = "top";
          this.prevRoofSlopeUp = isSlidingUpSlope;
        } else {
          this.prevRoofSlopeUp = false;
        }
      } else if (worldY > maxY) {
        // Ground:
        // - Flat: always allow.
        // - Sloped: only allow when moving DOWN (release) and segment is not sloping UP.
        const bottomAllowsSlide = info.bottomFlat || (movingDown && info.bottomDy >= -0.1);
        if (bottomAllowsSlide) {
          worldY = maxY;
          this.waveWorldY = worldY;
          this.isSlidingOnSurface = true;
          this.slidingSurface = "bottom";
        }
        this.prevRoofSlopeUp = false;
      } else {
        // Not touching roof or ground
        this.prevRoofSlopeUp = false;
      }
    }

    // Derive screen-space Y for rendering only.
    this.waveY = this.waveWorldY - this.camY;

    // Trail uses world X (forward motion) and screen Y (dart Y) so the path
    // is anchored to the corridor path in world-space (so camera motion does not "drag" it).
    // Offset trail to the TAIL of the spaceship (not center)
    const tailOffset = CONFIG.WAVE_SIZE * 0.5; // Distance from center to tail
    let trailX = worldX;
    let trailY = worldY;
    
    if (this.isSlidingOnSurface) {
      // Ship is horizontal - offset straight back
      trailX = worldX - tailOffset;
    } else {
      // Ship is rotated 45° - offset back and in the opposite vertical direction
      const cos45 = 0.707; // cos(45°) ≈ 0.707
      const sin45 = 0.707;
      trailX = worldX - tailOffset * cos45;
      if (this.holding) {
        // Ship pointing up - tail is back and DOWN
        trailY = worldY + tailOffset * sin45;
      } else {
        // Ship pointing down - tail is back and UP
        trailY = worldY - tailOffset * sin45;
      }
    }
    
    this.trail.push({ x: trailX, y: trailY, a: 1 });
    // CircularBuffer auto-handles overflow (capacity=50), no need for shift
    // Fade all trail points
    this.trail.forEach((p) => { p.a *= 0.92; });

    this.updateShake(dt);

    if (this.checkCollision(worldX, worldY)) {
      // Find the visual impact point and extend trail to it
      const chunk = this.findChunk(worldX);
      if (chunk) {
        const time = performance.now() * 0.001;
        const impact = findCollisionImpactPoint(chunk, worldX, worldY, time);
        if (impact) {
          // Add impact point to trail so it visually connects to the obstacle
          this.trail.push({ x: impact.impactX, y: impact.impactY, a: 1 });
        }
      }
      
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
    // Reduced lookahead for better performance (from 3.0x to 2.5x)
    const lookahead = this.viewW() * 2.5;
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
      const pooled = this.chunkPool.acquire();
      const c = this.gen.nextChunk(xStart, this.viewW(), this.viewH(), meters, false, undefined, undefined, pooled);
      this.chunks.push(c);

      // Keep memory bounded (reduced from 10 to 8 for better performance)
      if (this.chunks.length > 8) {
        const oldChunk = this.chunks.shift();
        if (oldChunk) {
          this.chunkPool.release(oldChunk);
        }
        // Invalidate cache when chunks change
        this.cachedCorridorInfo = null;
      }

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

    const time = performance.now() * 0.001;
    return checkChunkCollision(chunk, worldX, worldY, time);
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
    
    // WebGL particle overlay (rendered after Canvas 2D)
    if (this.particleGL && this.particleGL.isAvailable()) {
      this.particleGL.setOffset(this.renderScrollX(), this.renderCamY());
      this.particleGL.render();
    }

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
      // Scale to fill the entire canvas (imageSmoothingEnabled=false preserves pixel art look).
      // This ensures no black borders on any device regardless of DPR/renderScale ratio.
      dctx.drawImage(this.renderCanvas, 0, 0, this.canvas.width, this.canvas.height);
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
    
    // Add WebGL particle burst for extra glow effect
    if (this.particleGL && this.particleGL.isAvailable()) {
      // Main burst - cyan/white particles
      this.particleGL.emitBurst(x, y, 30, 350, 0.4, 0.9, 1.0, 8, 0.6);
      // Secondary burst - smaller white sparkles
      this.particleGL.emitBurst(x, y, 20, 200, 1.0, 1.0, 1.0, 4, 0.4);
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
    if (this.state !== "PLAYING" && this.trail.size > 0) {
      const fade = Math.pow(0.86, dt * 60);
      this.trail.forEach((p) => { p.a *= fade; });
      // Remove fully faded points from the front
      this.trail.removeWhile((p) => p.a < 0.02);
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
      if (PERF.shadowBlurEnabled) {
      ctx.shadowColor = glow;
        ctx.shadowBlur = Math.min(18 * a, PERF.maxShadowBlur);
      }
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
    try {
    g.addColorStop(0, this.runtimePalette.bgTop);
    g.addColorStop(1, this.runtimePalette.bgBottom);
    } catch {
      g.addColorStop(0, "#070a1a");
      g.addColorStop(1, "#1a0830");
    }
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
    const rScrollX = this.renderScrollX();
    const rCamY = this.renderCamY();
    ctx.translate(-rScrollX, -rCamY);

    // draw walls for visible chunks (reduced range for better performance)
    const visibleStart = rScrollX - 100;
    const visibleEnd = rScrollX + this.viewW() + 400;
    const visibleTop = rCamY - 50;
    const visibleBottom = rCamY + this.viewH() + 50;

    // Clear reusable visibility arrays (O(1) operation)
    this.visibleBlocks.length = 0;
    this.visibleSpikes.length = 0;
    this.visibleFields.length = 0;
    this.visibleWheels.length = 0;
    this.visibleNebulas.length = 0;
    this.visiblePulsars.length = 0;
    this.visibleComets.length = 0;

    // First pass: draw walls and collect visible obstacles
    for (const c of this.chunks) {
      if (c.xEnd < visibleStart || c.xStart > visibleEnd) continue;

      this.drawWalls(c);

      // Collect visible blocks
      for (const b of c.blocks) {
        const x0 = b.x - b.w * 0.5;
        const y0 = b.y;
        if (x0 + b.w < visibleStart || x0 > visibleEnd) continue;
        if (y0 + b.h < visibleTop || y0 > visibleBottom) continue;
        this.visibleBlocks.push(b);
      }

      // Collect visible spikes
      for (const s of c.spikes) {
        const minX = Math.min(s.ax, s.bx, s.cx);
        const maxX = Math.max(s.ax, s.bx, s.cx);
        const minY = Math.min(s.ay, s.by, s.cy);
        const maxY = Math.max(s.ay, s.by, s.cy);
        if (maxX < visibleStart || minX > visibleEnd) continue;
        if (maxY < visibleTop || minY > visibleBottom) continue;
        this.visibleSpikes.push(s);
      }

      // Collect visible spike fields
      for (const sf of c.spikeFields) {
        const minX = sf.x - sf.width * 0.5;
        const maxX = sf.x + sf.width * 0.5;
        const minY = sf.isTop ? sf.baseY : sf.baseY - sf.height;
        const maxY = sf.isTop ? sf.baseY + sf.height : sf.baseY;
        if (maxX < visibleStart || minX > visibleEnd) continue;
        if (maxY < visibleTop || minY > visibleBottom) continue;
        this.visibleFields.push(sf);
      }

      // Collect visible wheels
      for (const w of c.wheels) {
        if (w.x + w.radius < visibleStart || w.x - w.radius > visibleEnd) continue;
        if (w.y + w.radius < visibleTop || w.y - w.radius > visibleBottom) continue;
        this.visibleWheels.push(w);
      }

      // Collect visible nebulas
      for (const n of c.nebulas) {
        const minX = n.x - n.width * 0.5;
        const maxX = n.x + n.width * 0.5;
        const minY = n.y - n.height * 0.5;
        const maxY = n.y + n.height * 0.5;
        if (maxX < visibleStart || minX > visibleEnd) continue;
        if (maxY < visibleTop || minY > visibleBottom) continue;
        this.visibleNebulas.push(n);
      }

      // Collect visible pulsars
      for (const p of c.pulsars) {
        const minX = p.x - p.radius;
        const maxX = p.x + p.radius;
        const minY = p.y - p.radius;
        const maxY = p.y + p.radius;
        if (maxX < visibleStart || minX > visibleEnd) continue;
        if (maxY < visibleTop || minY > visibleBottom) continue;
        this.visiblePulsars.push(p);
      }

      // Collect visible comets
      for (const comet of c.comets) {
        const minX = Math.min(comet.x, comet.x - comet.tailLength) - comet.size;
        const maxX = Math.max(comet.x, comet.x + comet.tailLength) + comet.size;
        const minY = comet.y - comet.size * 2;
        const maxY = comet.y + comet.size * 2;
        if (maxX < visibleStart || minX > visibleEnd) continue;
        if (maxY < visibleTop || minY > visibleBottom) continue;
        this.visibleComets.push(comet);
      }
    }

    // Second pass: batch render all obstacles by type (with gradient cache and glow cache)
    drawBlocks(ctx, this.visibleBlocks, this.runtimePalette, this.gradientCache ?? undefined, this.glowCache ?? undefined);
    drawSpikes(ctx, this.visibleSpikes, this.runtimePalette, this.gradientCache ?? undefined);
    drawSpikeFields(ctx, this.visibleFields, this.runtimePalette, this.gradientCache ?? undefined);
    drawWheels(ctx, this.visibleWheels, this.runtimePalette, this.gradientCache ?? undefined, this.glowCache ?? undefined);
    drawNebulas(ctx, this.visibleNebulas, this.gradientCache ?? undefined, this.glowCache ?? undefined);
    drawPulsars(ctx, this.visiblePulsars, this.runtimePalette, this.gradientCache ?? undefined, this.glowCache ?? undefined);
    drawComets(ctx, this.visibleComets, this.gradientCache ?? undefined, this.glowCache ?? undefined);

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
    ctx.fillStyle = this.runtimePalette.wallFill;
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
    if (PERF.shadowBlurEnabled) {
    ctx.shadowColor = "rgba(255,255,255,0.35)";
      ctx.shadowBlur = Math.min(10, PERF.maxShadowBlur);
    }
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
      try {
      diskGrad.addColorStop(0.55, this.runtimePalette.trail);
      } catch {
        diskGrad.addColorStop(0.55, "rgba(120, 255, 244, 0.30)");
      }
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

  // Draw Nebula Clouds - swirling semi-transparent hazard zones with 3 color layers
  private drawNebulas(nebulas: NebulaCloud[]): void {
    const ctx = this.ctx;
    const time = performance.now() * 0.001;
    
    const seededRandom = (seed: number, index: number): number => {
      const x = Math.sin(seed + index * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    
    for (const n of nebulas) {
      ctx.save();
      
      const pulse = 0.7 + 0.3 * Math.sin(time * 1.5 + n.seed * 0.1);
      
      // 3-color palette for each nebula type - outer, middle, inner/core
      let colors: { outer: string; middle: string; inner: string; glow: string; spark: string };
      switch (n.color) {
        case "purple":
          colors = {
            outer: "rgba(80, 40, 160, 0.4)",      // Deep purple outer
            middle: "rgba(180, 80, 220, 0.5)",    // Bright magenta middle
            inner: "rgba(255, 150, 255, 0.6)",    // Hot pink core
            glow: "rgba(200, 100, 255, 0.8)",
            spark: "rgba(255, 200, 255, 0.9)"
          };
          break;
        case "pink":
          colors = {
            outer: "rgba(160, 40, 80, 0.4)",      // Deep rose outer
            middle: "rgba(255, 100, 150, 0.5)",   // Hot pink middle
            inner: "rgba(255, 200, 100, 0.6)",    // Golden orange core
            glow: "rgba(255, 120, 180, 0.8)",
            spark: "rgba(255, 220, 180, 0.9)"
          };
          break;
        case "cyan":
        default:
          colors = {
            outer: "rgba(40, 80, 160, 0.4)",      // Deep blue outer
            middle: "rgba(80, 200, 220, 0.5)",    // Cyan middle
            inner: "rgba(200, 255, 200, 0.6)",    // Greenish-white core
            glow: "rgba(100, 220, 255, 0.8)",
            spark: "rgba(200, 255, 255, 0.9)"
          };
          break;
      }
      
      // Massive outer glow for prominence
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = 50 * pulse;
      
      ctx.globalCompositeOperation = "lighter";
      
      // LAYER 1: Outer color layer - largest, slowest rotation
      for (let i = 0; i < 3; i++) {
        const offset = seededRandom(n.seed, i * 11) * 15 - 7;
        const rotation = time * 0.2 + n.seed + i * 2.1;
        const scale = 1.1 + i * 0.1;
        
        ctx.save();
        ctx.translate(n.x + offset * Math.cos(rotation), n.y + offset * Math.sin(rotation));
        ctx.rotate(rotation * 0.3);
        
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, n.width * scale * 0.6);
        grad.addColorStop(0, colors.outer.replace("0.4", `${0.35 * n.intensity * pulse}`));
        grad.addColorStop(0.6, colors.outer.replace("0.4", `${0.2 * n.intensity * pulse}`));
        grad.addColorStop(1, "rgba(0,0,0,0)");
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 0, n.width * scale * 0.6, n.height * scale * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      
      // LAYER 2: Middle color layer - medium size, medium rotation
      for (let i = 0; i < 3; i++) {
        const offset = seededRandom(n.seed, i * 17 + 50) * 12 - 6;
        const rotation = time * 0.35 + n.seed * 1.3 + i * 2.3;
        const scale = 0.75 + i * 0.08;
        
        ctx.save();
        ctx.translate(n.x + offset * Math.cos(rotation * 1.2), n.y + offset * Math.sin(rotation));
        ctx.rotate(rotation * 0.5);
        
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, n.width * scale * 0.5);
        grad.addColorStop(0, colors.middle.replace("0.5", `${0.45 * n.intensity * pulse}`));
        grad.addColorStop(0.5, colors.middle.replace("0.5", `${0.25 * n.intensity * pulse}`));
        grad.addColorStop(1, "rgba(0,0,0,0)");
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 0, n.width * scale * 0.5, n.height * scale * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      
      // LAYER 3: Inner/core color layer - smallest, fastest rotation, brightest
      for (let i = 0; i < 2; i++) {
        const offset = seededRandom(n.seed, i * 23 + 100) * 8 - 4;
        const rotation = time * 0.5 + n.seed * 1.7 + i * 2.5;
        const scale = 0.45 + i * 0.1;
        
        ctx.save();
        ctx.translate(n.x + offset * Math.cos(rotation * 1.5), n.y + offset * Math.sin(rotation * 1.3));
        ctx.rotate(rotation * 0.7);
        
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, n.width * scale * 0.4);
        grad.addColorStop(0, colors.inner.replace("0.6", `${0.6 * n.intensity * pulse}`));
        grad.addColorStop(0.4, colors.inner.replace("0.6", `${0.35 * n.intensity * pulse}`));
        grad.addColorStop(1, "rgba(0,0,0,0)");
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 0, n.width * scale * 0.4, n.height * scale * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      
      // Bright central hotspot
      ctx.save();
      const coreGrad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.width * 0.15);
      coreGrad.addColorStop(0, `rgba(255, 255, 255, ${0.5 * n.intensity * pulse})`);
      coreGrad.addColorStop(0.5, colors.inner.replace("0.6", `${0.3 * n.intensity * pulse}`));
      coreGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.width * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      
      // Lightning/spark effects inside
      ctx.strokeStyle = colors.spark;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 * n.intensity * pulse;
      
      const sparkCount = 3 + Math.floor(n.intensity * 4);
      for (let i = 0; i < sparkCount; i++) {
        const sparkPhase = seededRandom(n.seed, i * 13 + 50);
        const sparkTime = (time * 2 + sparkPhase * 10) % 3;
        
        if (sparkTime < 0.3) { // Only show spark briefly
          const sx = n.x + (seededRandom(n.seed, i * 17) - 0.5) * n.width * 0.6;
          const sy = n.y + (seededRandom(n.seed, i * 23) - 0.5) * n.height * 0.6;
          
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          
          // Jagged lightning path
          let px = sx, py = sy;
          for (let j = 0; j < 3; j++) {
            const dx = (seededRandom(n.seed, i * 31 + j) - 0.5) * 20;
            const dy = (seededRandom(n.seed, i * 37 + j) - 0.5) * 20;
            px += dx;
            py += dy;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
      
      ctx.restore();
    }
  }

  // Draw Pulsars - rotating energy beams
  private drawPulsars(pulsars: Pulsar[]): void {
    const ctx = this.ctx;
    const time = performance.now() * 0.001;
    
    for (const p of pulsars) {
      ctx.save();
      ctx.translate(p.x, p.y);
      
      // Update angle based on time (for animation)
      const currentAngle = p.angle + time * p.speed;
      
      const pulse = 0.7 + 0.3 * Math.sin(time * 4 + p.x * 0.01);
      
      // Color based on type
      let beamColor: string;
      let glowColor: string;
      let coreColor: string;
      switch (p.color) {
        case "magenta":
          beamColor = "rgba(255, 80, 200, 0.9)";
          glowColor = "rgba(255, 100, 220, 0.7)";
          coreColor = "rgba(255, 200, 240, 1)";
          break;
        case "white":
          beamColor = "rgba(255, 255, 255, 0.9)";
          glowColor = "rgba(200, 220, 255, 0.7)";
          coreColor = "rgba(255, 255, 255, 1)";
          break;
        case "cyan":
        default:
          beamColor = "rgba(80, 220, 255, 0.9)";
          glowColor = this.runtimePalette.waveGlow;
          coreColor = "rgba(200, 255, 255, 1)";
          break;
      }
      
      // Draw two opposing beams
      for (let beam = 0; beam < 2; beam++) {
        const angle = currentAngle + beam * Math.PI;
        
        ctx.save();
        ctx.rotate(angle);
        
        // Beam glow
        ctx.globalCompositeOperation = "lighter";
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 25 * pulse;
        
        // Main beam gradient
        const beamGrad = ctx.createLinearGradient(0, 0, p.radius, 0);
        beamGrad.addColorStop(0, coreColor);
        beamGrad.addColorStop(0.1, beamColor);
        beamGrad.addColorStop(0.7, beamColor.replace("0.9", "0.4"));
        beamGrad.addColorStop(1, "rgba(0,0,0,0)");
        
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        // Tapered beam shape
        ctx.moveTo(0, -p.beamWidth * 0.3);
        ctx.lineTo(p.radius, -p.beamWidth * 0.1);
        ctx.lineTo(p.radius, p.beamWidth * 0.1);
        ctx.lineTo(0, p.beamWidth * 0.3);
        ctx.closePath();
        ctx.fill();
        
        // Inner hot core line
        ctx.strokeStyle = coreColor;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8 * pulse;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(p.radius * 0.8, 0);
        ctx.stroke();
        
        ctx.restore();
      }
      
      // Central pulsar core
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 20 * pulse;
      
      // Outer glow ring
      ctx.strokeStyle = beamColor;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.5 * pulse;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.stroke();
      
      // Core
      const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
      coreGrad.addColorStop(0, coreColor);
      coreGrad.addColorStop(0.5, beamColor);
      coreGrad.addColorStop(1, "rgba(0,0,0,0)");
      
      ctx.globalAlpha = 1;
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
    }
  }

  // Draw Comets - moving obstacles with glowing trails
  private drawComets(comets: Comet[]): void {
    const ctx = this.ctx;
    const time = performance.now() * 0.001;
    
    for (const c of comets) {
      ctx.save();
      
      const pulse = 0.8 + 0.2 * Math.sin(time * 3 + c.startX * 0.01);
      
      // Color based on type
      let coreColor: string;
      let tailColor: string;
      let glowColor: string;
      switch (c.color) {
        case "orange":
          coreColor = "rgba(255, 200, 100, 1)";
          tailColor = "rgba(255, 150, 50, 0.6)";
          glowColor = "rgba(255, 180, 80, 0.7)";
          break;
        case "green":
          coreColor = "rgba(150, 255, 150, 1)";
          tailColor = "rgba(80, 200, 80, 0.6)";
          glowColor = "rgba(120, 255, 120, 0.7)";
          break;
        case "blue":
        default:
          coreColor = "rgba(180, 220, 255, 1)";
          tailColor = "rgba(100, 180, 255, 0.6)";
          glowColor = "rgba(150, 200, 255, 0.7)";
          break;
      }
      
      // Calculate direction for tail
      const dx = c.endX - c.startX;
      const dy = c.endY - c.startY;
      const angle = Math.atan2(dy, dx);
      
      // Draw tail (behind comet)
      ctx.globalCompositeOperation = "lighter";
      
      // Tail gradient
      const tailEndX = c.x - Math.cos(angle) * c.tailLength;
      const tailEndY = c.y - Math.sin(angle) * c.tailLength;
      
      const tailGrad = ctx.createLinearGradient(c.x, c.y, tailEndX, tailEndY);
      tailGrad.addColorStop(0, tailColor);
      tailGrad.addColorStop(0.3, tailColor.replace("0.6", "0.3"));
      tailGrad.addColorStop(1, "rgba(0,0,0,0)");
      
      ctx.fillStyle = tailGrad;
      ctx.beginPath();
      // Tail shape widens toward end
      const perpX = Math.cos(angle + Math.PI / 2);
      const perpY = Math.sin(angle + Math.PI / 2);
      ctx.moveTo(c.x + perpX * c.size * 0.3, c.y + perpY * c.size * 0.3);
      ctx.lineTo(c.x - perpX * c.size * 0.3, c.y - perpY * c.size * 0.3);
      ctx.lineTo(tailEndX - perpX * c.size * 1.2, tailEndY - perpY * c.size * 1.2);
      ctx.lineTo(tailEndX + perpX * c.size * 1.2, tailEndY + perpY * c.size * 1.2);
      ctx.closePath();
      ctx.fill();
      
      // Particle sparkles in tail
      ctx.fillStyle = coreColor;
      for (let i = 0; i < 8; i++) {
        const t = i / 8;
        const sparkX = c.x + (tailEndX - c.x) * t + (Math.sin(time * 5 + i * 2) * 3);
        const sparkY = c.y + (tailEndY - c.y) * t + (Math.cos(time * 5 + i * 2) * 3);
        const sparkSize = (1 - t) * 2 + 1;
        ctx.globalAlpha = (1 - t) * 0.6 * pulse;
        ctx.beginPath();
        ctx.arc(sparkX, sparkY, sparkSize, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Comet core with glow
      ctx.globalAlpha = 1;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 20 * pulse;
      
      // Outer glow
      const coreGrad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.size * 1.5);
      coreGrad.addColorStop(0, coreColor);
      coreGrad.addColorStop(0.4, tailColor);
      coreGrad.addColorStop(1, "rgba(0,0,0,0)");
      
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.size * 1.5, 0, Math.PI * 2);
      ctx.fill();
      
      // Bright core center
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.size * 0.4, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
    }
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
    // Check if color changed - if not and pattern exists, reuse it
    const currentColor = this.runtimePalette.wallPattern;
    if (this.wallPattern && this.lastWallPatternColor === currentColor) {
      return; // Pattern is still valid
    }
    this.lastWallPatternColor = currentColor;
    
    // A small tiled pattern we can repeat cheaply.
    const tileSize = 96;
    const tile = document.createElement("canvas");
    tile.width = tileSize;
    tile.height = tileSize;
    const tctx = tile.getContext("2d");
    if (!tctx) return;

    tctx.clearRect(0, 0, tileSize, tileSize);
    tctx.fillStyle = this.runtimePalette.wallPattern;
    tctx.strokeStyle = this.runtimePalette.wallPattern;
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
    try {
    neb.addColorStop(0.35, this.runtimePalette.trail);
    } catch {
      neb.addColorStop(0.35, "rgba(120, 255, 244, 0.30)");
    }
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

  // Nebula variant (uses the same block placement/collision as floating obstacles)
  private drawNebulaBlock(b: Block): void {
    const ctx = this.ctx;
    const seed = b.seed;
    const time = performance.now() * 0.001;

    const frac = (v: number): number => v - Math.floor(v);
    const hash01 = (v: number): number => frac(Math.sin(v) * 43758.5453123);
    const s1 = hash01(seed * 91.7 + b.x * 0.0031 + b.y * 0.0047);
    const s2 = hash01(seed * 33.3 + b.x * 0.0019);
    const pulse = 0.65 + 0.35 * Math.sin(time * (1.4 + s1) + seed * 20.0);

    const cx = b.x;
    const cy = b.y + b.h * 0.5;
    const r = Math.max(18, Math.min(b.w, b.h) * 0.62);

    ctx.save();
    ctx.translate(cx, cy);

    // Big soft glow cloud (stacked radial blobs)
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.shadowBlur = 54;
    ctx.globalAlpha = 0.34 + 0.22 * pulse;

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + s2 * 3.0;
      const rr = r * (0.44 + 0.32 * hash01(seed * 10 + i * 7.7));
      const ox = Math.cos(a) * r * (0.24 + 0.18 * hash01(seed * 20 + i * 3.3));
      const oy = Math.sin(a) * r * (0.20 + 0.16 * hash01(seed * 30 + i * 5.9));
      const grad = ctx.createRadialGradient(ox, oy, rr * 0.10, ox, oy, rr);
      grad.addColorStop(0.0, "rgba(255,255,255,0.16)");
      try {
      grad.addColorStop(0.35, this.runtimePalette.trail);
      } catch {
        grad.addColorStop(0.35, "rgba(120, 255, 244, 0.30)");
      }
      grad.addColorStop(1.0, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ox, oy, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Colored core (nebula should NOT be black)
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.88;
    const core = ctx.createRadialGradient(0, 0, r * 0.10, 0, 0, r * 0.70);
    core.addColorStop(0.0, "rgba(255,255,255,0.16)");
    core.addColorStop(0.25, "rgba(255,120,220,0.24)");
    try {
    core.addColorStop(0.55, this.runtimePalette.trail);
    } catch {
      core.addColorStop(0.55, "rgba(120, 255, 244, 0.30)");
    }
    core.addColorStop(1.0, "rgba(10,12,28,0.96)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.fill();

    // Rim highlight + "lightning" streaks
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.shadowBlur = 22;
    ctx.globalAlpha = 0.28 + 0.16 * pulse;
    ctx.strokeStyle = "rgba(255,255,255,0.26)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.60, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 16;
    ctx.globalAlpha = 0.12 + 0.12 * pulse;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = (seed * 10 + i * 2.4) % (Math.PI * 2);
      const r0 = r * (0.20 + 0.10 * hash01(seed * 70 + i * 7.1));
      const r1 = r * (0.70 + 0.10 * hash01(seed * 90 + i * 5.3));
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a + 0.55) * r1, Math.sin(a + 0.55) * r1 * 0.85);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Asteroid variant (spinning rock) - uses circular collision
  private drawAsteroidBlock(b: Block): void {
    const ctx = this.ctx;
    const seed = b.seed;
    const time = performance.now() * 0.001;

    const frac = (v: number): number => v - Math.floor(v);
    const hash01 = (v: number): number => frac(Math.sin(v) * 43758.5453123);
    const s1 = hash01(seed * 91.7 + b.x * 0.0031 + b.y * 0.0047);
    const s2 = hash01(seed * 33.3 + b.x * 0.0019);
    const s3 = hash01(seed * 17.1 + b.y * 0.0027);
    const pulse = 0.7 + 0.3 * Math.sin(time * 1.6 + seed * 15.0);

    const cx = b.x;
    const cy = b.y + b.h * 0.5;
    const r = Math.min(b.w, b.h) * 0.5;
    const spin = time * (0.8 + s1 * 0.6);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);

    // Big outer glow (space crystal/energy)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.shadowBlur = 42;
    ctx.globalAlpha = 0.32 + 0.18 * pulse;
    ctx.strokeStyle = this.runtimePalette.trail;
    ctx.lineWidth = Math.max(8, Math.floor(r * 0.4));
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.shadowBlur = 24;
    ctx.globalAlpha = 0.22 + 0.12 * pulse;
    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.lineWidth = Math.max(5, Math.floor(r * 0.25));
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Rock surface with craters and bumps (irregular shape) - space-themed colors
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const rockGrad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    rockGrad.addColorStop(0.0, "rgba(180,220,255,0.85)");
    rockGrad.addColorStop(0.4, "rgba(100,160,220,0.75)");
    rockGrad.addColorStop(0.8, "rgba(40,80,140,0.85)");
    rockGrad.addColorStop(1.0, "rgba(20,40,80,0.95)");
    ctx.fillStyle = rockGrad;
    ctx.strokeStyle = "rgba(200,240,255,0.6)";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 0;

    // Draw irregular rock shape using multiple points
    ctx.beginPath();
    const points = 12;
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const variance = 0.75 + 0.25 * hash01(seed * 100 + i * 7.3);
      const rr = r * variance;
      const x = Math.cos(angle) * rr;
      const y = Math.sin(angle) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Add craters and surface details (darker spots)
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 4; i++) {
      const ca = (i / 4) * Math.PI * 2 + s2 * 2.0;
      const cr = r * (0.15 + 0.15 * hash01(seed * 200 + i * 11.7));
      const cx2 = Math.cos(ca) * r * (0.3 + 0.3 * hash01(seed * 300 + i * 13.1));
      const cy2 = Math.sin(ca) * r * (0.3 + 0.3 * hash01(seed * 400 + i * 17.3));
      ctx.fillStyle = "rgba(10,30,60,0.5)";
      ctx.beginPath();
      ctx.arc(cx2, cy2, cr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Glowing highlight edges
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "rgba(200,240,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const variance = 0.75 + 0.25 * hash01(seed * 100 + i * 7.3);
      const rr = r * variance;
      const x = Math.cos(angle) * rr;
      const y = Math.sin(angle) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // Inner glow core
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.shadowBlur = 20;
    ctx.globalAlpha = 0.4 + 0.3 * pulse;
    const coreGrad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 0.6);
    coreGrad.addColorStop(0.0, "rgba(255,255,255,0.3)");
    try {
    coreGrad.addColorStop(0.5, this.runtimePalette.trail);
    } catch {
      coreGrad.addColorStop(0.5, "rgba(120, 255, 244, 0.30)");
    }
    coreGrad.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Orbiting crystal fragments (glowing particles)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.shadowBlur = 10;
    for (let i = 0; i < 6; i++) {
      const h = hash01(seed * 50.0 + i * 9.1);
      const a = spin * 0.8 + (i / 6) * Math.PI * 2 + seed * 3.0;
      const rr = r * (1.05 + h * 0.3);
      const sx = Math.cos(a) * rr;
      const sy = Math.sin(a) * rr;
      const s = 1 + Math.floor(h * 2);
      ctx.globalAlpha = 0.3 + 0.4 * pulse;
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.9)" : this.runtimePalette.trail;
      ctx.fillRect(Math.round(sx - s * 0.5), Math.round(sy - s * 0.5), s, s);
    }
    ctx.restore();

    ctx.restore();
  }

  private drawSpikes(spikes: SpikeTri[]): void {
    const ctx = this.ctx;
    const time = performance.now() * 0.001;
    
    for (const t of spikes) {
    ctx.save();
      
      // Calculate spike center and dimensions for effects
      const centerX = (t.bx + t.cx) * 0.5;
      const centerY = (t.ay + t.by) * 0.5;
      const tipX = t.ax;
      const tipY = t.ay;
      const w = Math.abs(t.cx - t.bx);
      const h = Math.abs(t.ay - t.by);
      
      // Subtle pulse effect
      const pulse = 0.7 + 0.3 * Math.sin(time * 2.5 + centerX * 0.01);
      
      switch (t.kind) {
        case "crystal": {
          // Crystal Energy Shards - translucent with glowing core
          // Outer glow
          ctx.shadowColor = this.runtimePalette.waveGlow;
          ctx.shadowBlur = 15 * pulse;
          
          // Gradient fill from bright center to translucent edge
          const grad = ctx.createLinearGradient(tipX, tipY, centerX, t.by);
          grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
          try {
            grad.addColorStop(0.3, this.runtimePalette.waveGlow);
          } catch {
            grad.addColorStop(0.3, "rgba(120, 255, 244, 0.60)");
          }
          grad.addColorStop(0.7, "rgba(120, 255, 244, 0.6)");
          grad.addColorStop(1, "rgba(80, 200, 220, 0.3)");
          
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(t.ax, t.ay);
          ctx.lineTo(t.bx, t.by);
          ctx.lineTo(t.cx, t.cy);
          ctx.closePath();
          ctx.fill();
          
          // Bright edge highlight
          ctx.strokeStyle = "rgba(200, 255, 250, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          break;
        }
        
        case "plasma": {
          // Plasma Spikes - glowing energy with hot core
          // Big outer glow
          ctx.shadowColor = "rgba(255, 150, 100, 0.8)";
          ctx.shadowBlur = 20 * pulse;
          
          // Hot gradient from white core to orange/red edges
          const grad = ctx.createLinearGradient(tipX, tipY, centerX, t.by);
          grad.addColorStop(0, "rgba(255, 255, 255, 1)");
          grad.addColorStop(0.2, "rgba(255, 220, 150, 0.95)");
          grad.addColorStop(0.5, "rgba(255, 140, 80, 0.8)");
          grad.addColorStop(0.8, "rgba(255, 80, 50, 0.6)");
          grad.addColorStop(1, "rgba(200, 50, 30, 0.4)");
          
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(t.ax, t.ay);
          ctx.lineTo(t.bx, t.by);
          ctx.lineTo(t.cx, t.cy);
          ctx.closePath();
          ctx.fill();
          
          // Inner glow line
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = "rgba(255, 200, 150, 0.6)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(centerX, t.by);
          ctx.stroke();
          break;
        }
        
        case "void": {
          // Void Thorns - dark with glowing edges (inverted look)
          // Dark fill with bright outline
          ctx.fillStyle = "rgba(10, 5, 20, 0.9)";
          ctx.beginPath();
          ctx.moveTo(t.ax, t.ay);
          ctx.lineTo(t.bx, t.by);
          ctx.lineTo(t.cx, t.cy);
          ctx.closePath();
          ctx.fill();
          
          // Glowing edge effect
          ctx.shadowColor = this.runtimePalette.waveGlow;
          ctx.shadowBlur = 12 * pulse;
          ctx.strokeStyle = this.runtimePalette.trail;
          ctx.lineWidth = 2;
          ctx.stroke();
          
          // Inner void highlight
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = "rgba(150, 100, 255, 0.4)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo((t.bx + centerX) * 0.5, (t.by + tipY) * 0.5);
          ctx.stroke();
          break;
        }
        
        case "asteroid": {
          // Asteroid Fragments - rocky with glowing cracks
          // Base rocky color
          ctx.fillStyle = "rgba(80, 70, 90, 0.95)";
          ctx.beginPath();
          ctx.moveTo(t.ax, t.ay);
          ctx.lineTo(t.bx, t.by);
          ctx.lineTo(t.cx, t.cy);
          ctx.closePath();
          ctx.fill();
          
          // Darker inner layer for depth - use interpolation to stay inside spike
          ctx.fillStyle = "rgba(50, 45, 60, 0.7)";
          const inset = 0.15;
          // Inner triangle vertices interpolated toward center
          const innerTipX = tipX + (centerX - tipX) * inset;
          const innerTipY = tipY + (t.by - tipY) * inset;
          const innerLeftX = t.bx + (centerX - t.bx) * inset * 2;
          const innerLeftY = t.by + (tipY - t.by) * inset; // Interpolate toward tip
          const innerRightX = t.cx + (centerX - t.cx) * inset * 2;
          const innerRightY = t.cy + (tipY - t.cy) * inset; // Interpolate toward tip
          ctx.beginPath();
          ctx.moveTo(innerTipX, innerTipY);
          ctx.lineTo(innerLeftX, innerLeftY);
          ctx.lineTo(innerRightX, innerRightY);
          ctx.closePath();
          ctx.fill();
          
          // Glowing cracks - use proper interpolation between tip and base
          ctx.shadowColor = "rgba(255, 100, 50, 0.6)";
          ctx.shadowBlur = 6 * pulse;
          ctx.strokeStyle = "rgba(255, 150, 80, 0.7)";
          ctx.lineWidth = 1;
          // Crack points at 40% and 75% from tip to base (stays inside spike)
          const crackY1 = tipY + (t.by - tipY) * 0.4;
          const crackY2 = tipY + (t.by - tipY) * 0.75;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(centerX + w * 0.08, crackY1);
          ctx.lineTo(centerX - w * 0.12, crackY2);
          ctx.stroke();
          
          // Outline
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(40, 35, 50, 0.9)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(t.ax, t.ay);
          ctx.lineTo(t.bx, t.by);
          ctx.lineTo(t.cx, t.cy);
          ctx.closePath();
          ctx.stroke();
          break;
        }
        
        default: {
          // Fallback to original style
    ctx.fillStyle = CONFIG.SPIKE_FILL;
    ctx.strokeStyle = CONFIG.SPIKE_STROKE;
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255,255,255,0.18)";
    ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(t.ax, t.ay);
      ctx.lineTo(t.bx, t.by);
      ctx.lineTo(t.cx, t.cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
      }
      
    ctx.restore();
    }
  }

  // Draw spike fields as unified jagged shapes
  private drawSpikeFields(fields: SpikeField[]): void {
    const ctx = this.ctx;
    const time = performance.now() * 0.001;
    
    // Seeded random for consistent jagged edges
    const seededRandom = (seed: number, index: number): number => {
      const x = Math.sin(seed + index * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    
    for (const f of fields) {
      ctx.save();
      
      const halfWidth = f.width * 0.5;
      const leftX = f.x - halfWidth;
      const rightX = f.x + halfWidth;
      
      // Subtle pulse effect
      const pulse = 0.85 + 0.15 * Math.sin(time * 2 + f.seed * 0.01);
      
      // Generate jagged outline path points
      // The path goes: bottom-left corner, jagged top edge, bottom-right corner
      const points: { x: number; y: number }[] = [];
      
      // Start at left base corner
      points.push({ x: leftX, y: f.baseY });
      
      // Generate jagged peaks across the width
      const segmentWidth = f.width / f.peakCount;
      for (let i = 0; i <= f.peakCount; i++) {
        const t = i / f.peakCount; // 0 to 1 across width
        const x = leftX + t * f.width;
        
        // Vary height and create peaks/valleys
        const heightMod = seededRandom(f.seed, i * 3) * 0.6 + 0.4; // 0.4 to 1.0
        const peakHeight = f.height * heightMod;
        
        // Add slight X offset for irregular look
        const xOffset = (seededRandom(f.seed, i * 5 + 100) - 0.5) * segmentWidth * 0.5;
        
        // Determine point direction (alternating peaks and valleys with variation)
        const isPeak = i % 2 === 0 || seededRandom(f.seed, i * 7) > 0.7;
        
        if (isPeak && i > 0 && i < f.peakCount) {
          // This is a peak - goes toward the corridor center
          const peakY = f.isTop ? f.baseY + peakHeight : f.baseY - peakHeight;
          points.push({ x: x + xOffset, y: peakY });
        } else if (i > 0 && i < f.peakCount) {
          // Valley point - stays closer to base
          const valleyHeight = f.height * 0.15 * seededRandom(f.seed, i * 11);
          const valleyY = f.isTop ? f.baseY + valleyHeight : f.baseY - valleyHeight;
          points.push({ x: x + xOffset * 0.5, y: valleyY });
        }
      }
      
      // End at right base corner
      points.push({ x: rightX, y: f.baseY });
      
      // Draw the unified shape based on kind
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
      
      switch (f.kind) {
        case "crystal": {
          // Crystal field - translucent blue-cyan glow
          ctx.shadowColor = this.runtimePalette.waveGlow;
          ctx.shadowBlur = 18 * pulse;
          
          const tipY = f.isTop ? f.baseY + f.height : f.baseY - f.height;
          const grad = ctx.createLinearGradient(f.x, f.baseY, f.x, tipY);
          grad.addColorStop(0, "rgba(120, 200, 220, 0.3)");
          grad.addColorStop(0.4, "rgba(150, 255, 244, 0.6)");
          try {
            grad.addColorStop(0.8, this.runtimePalette.waveGlow);
          } catch {
            grad.addColorStop(0.8, "rgba(120, 255, 244, 0.60)");
          }
          grad.addColorStop(1, "rgba(255, 255, 255, 0.9)");
          
          ctx.fillStyle = grad;
          ctx.fill();
          
          // Glowing edge
          ctx.strokeStyle = "rgba(200, 255, 250, 0.6)";
          ctx.lineWidth = 2;
          ctx.stroke();
          break;
        }
        
        case "plasma": {
          // Plasma field - hot orange/red energy
          ctx.shadowColor = "rgba(255, 150, 100, 0.7)";
          ctx.shadowBlur = 22 * pulse;
          
          const tipY = f.isTop ? f.baseY + f.height : f.baseY - f.height;
          const grad = ctx.createLinearGradient(f.x, f.baseY, f.x, tipY);
          grad.addColorStop(0, "rgba(200, 50, 30, 0.35)");
          grad.addColorStop(0.3, "rgba(255, 100, 50, 0.6)");
          grad.addColorStop(0.6, "rgba(255, 180, 100, 0.8)");
          grad.addColorStop(1, "rgba(255, 255, 200, 0.95)");
          
          ctx.fillStyle = grad;
          ctx.fill();
          
          // Hot edge
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = "rgba(255, 220, 150, 0.5)";
          ctx.lineWidth = 2.5;
          ctx.stroke();
          break;
        }
        
        case "void": {
          // Void field - dark with glowing edges
          ctx.fillStyle = "rgba(8, 4, 18, 0.92)";
          ctx.fill();
          
          // Glowing edge effect
          ctx.shadowColor = this.runtimePalette.waveGlow;
          ctx.shadowBlur = 15 * pulse;
          ctx.strokeStyle = this.runtimePalette.trail;
          ctx.lineWidth = 2.5;
          ctx.stroke();
          
          // Inner glow lines
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = "rgba(140, 90, 255, 0.25)";
          ctx.lineWidth = 1;
          // Draw some internal glow lines toward peaks
          for (let i = 2; i < points.length - 2; i += 2) {
            ctx.beginPath();
            ctx.moveTo(f.x, f.baseY);
            ctx.lineTo(points[i].x, points[i].y);
            ctx.stroke();
          }
          break;
        }
        
        case "asteroid": {
          // Asteroid field - rocky texture with glowing cracks
          ctx.fillStyle = "rgba(75, 65, 85, 0.93)";
          ctx.fill();
          
          // Inner darker layer
          ctx.fillStyle = "rgba(45, 40, 55, 0.5)";
          ctx.beginPath();
          const inset = 0.3;
          ctx.moveTo(
            points[0].x + (f.x - points[0].x) * inset,
            points[0].y + (f.isTop ? f.height * 0.1 : -f.height * 0.1)
          );
          for (let i = 1; i < points.length - 1; i++) {
            const px = points[i].x + (f.x - points[i].x) * inset * 0.5;
            const py = points[i].y + (f.baseY - points[i].y) * inset;
            ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          
          // Glowing cracks
          ctx.shadowColor = "rgba(255, 100, 50, 0.5)";
          ctx.shadowBlur = 5 * pulse;
          ctx.strokeStyle = "rgba(255, 140, 70, 0.6)";
          ctx.lineWidth = 1;
          // Draw cracks from base toward some peaks
          for (let i = 2; i < points.length - 2; i += 3) {
            const crackEndY = f.baseY + (points[i].y - f.baseY) * 0.65;
            ctx.beginPath();
            ctx.moveTo(points[i].x + (seededRandom(f.seed, i * 17) - 0.5) * 8, f.baseY);
            ctx.lineTo(points[i].x, crackEndY);
            ctx.stroke();
          }
          
          // Outer edge
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(35, 30, 45, 0.85)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
          }
          ctx.closePath();
          ctx.stroke();
          break;
        }
      }
      
      ctx.restore();
    }
  }

  private drawWave(): void {
    const ctx = this.ctx;
    const rScrollX = this.renderScrollX();
    const rCamY = this.renderCamY();

    // trail (diagonal zig-zag, 45° segments relative to scrolling level)
    if (this.trail.size > 1) {
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
      this.trail.forEach((p, i) => {
        const sx = p.x - rScrollX;
        const sy = p.y - rCamY;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      
      // Draw main trail on top (thinner, brighter)
      ctx.lineWidth = 12;
      ctx.strokeStyle = this.runtimePalette.trail;
      ctx.beginPath();
      this.trail.forEach((p, i) => {
        const sx = p.x - rScrollX;
        const sy = p.y - rCamY;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      ctx.restore();
    }

    // Spaceship (screen space) - Sci-Fi Wedge design
    if ((this.state === "DYING" || this.state === "GAME_OVER") && this.deathShards.length > 0) return;
    const size = CONFIG.WAVE_SIZE;
    const x = this.waveX;
    const y = this.waveWorldY - rCamY;
    const time = performance.now() * 0.003;
    const enginePulse = 0.7 + 0.3 * Math.sin(time * 4); // Engine throb
    
    ctx.save();
    ctx.translate(x, y);
    // Point forward when sliding on roof/ground, otherwise point at 45° up/down
    if (this.isSlidingOnSurface) {
      ctx.rotate(0);
    } else {
      const dirUp = this.holding;
      ctx.rotate(dirUp ? -Math.PI / 4 : Math.PI / 4);
    }
    
    // Engine thruster glow (behind ship)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const thrustGrad = ctx.createRadialGradient(-size * 0.5, 0, 0, -size * 0.5, 0, size * 0.8);
    thrustGrad.addColorStop(0, `rgba(120, 255, 244, ${0.6 * enginePulse})`);
    thrustGrad.addColorStop(0.3, `rgba(80, 200, 255, ${0.4 * enginePulse})`);
    thrustGrad.addColorStop(0.6, `rgba(150, 100, 255, ${0.2 * enginePulse})`);
    thrustGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = thrustGrad;
    ctx.beginPath();
    ctx.ellipse(-size * 0.5, 0, size * 0.7 * enginePulse, size * 0.4 * enginePulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Main hull shadow/glow
    ctx.shadowColor = this.runtimePalette.waveGlow;
    ctx.shadowBlur = 16;
    
    // Main hull body - sleek wedge shape
    const hullGrad = ctx.createLinearGradient(-size * 0.6, -size * 0.6, size * 0.3, size * 0.3);
    hullGrad.addColorStop(0, "#d0f0ff"); // Light top
    hullGrad.addColorStop(0.4, "#a8e8f8"); // Mid
    hullGrad.addColorStop(0.7, "#78c8e8"); // Darker bottom
    hullGrad.addColorStop(1, "#58a8d0"); // Shadow edge
    
    ctx.fillStyle = hullGrad;
    ctx.beginPath();
    // Nose tip
    ctx.moveTo(size * 1.1, 0);
    // Top wing edge
    ctx.lineTo(size * 0.2, -size * 0.25);
    ctx.lineTo(-size * 0.3, -size * 0.55);
    // Back top corner
    ctx.lineTo(-size * 0.55, -size * 0.45);
    // Engine indent top
    ctx.lineTo(-size * 0.45, -size * 0.15);
    // Engine bay
    ctx.lineTo(-size * 0.55, 0);
    // Engine indent bottom
    ctx.lineTo(-size * 0.45, size * 0.15);
    // Back bottom corner
    ctx.lineTo(-size * 0.55, size * 0.45);
    // Bottom wing edge
    ctx.lineTo(-size * 0.3, size * 0.55);
    ctx.lineTo(size * 0.2, size * 0.25);
    ctx.closePath();
    ctx.fill();
    
    // Hull outline
    ctx.strokeStyle = "rgba(30, 60, 80, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Wing accent lines (panel details)
    ctx.strokeStyle = "rgba(40, 80, 100, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Top wing line
    ctx.moveTo(size * 0.1, -size * 0.2);
    ctx.lineTo(-size * 0.35, -size * 0.45);
    // Bottom wing line
    ctx.moveTo(size * 0.1, size * 0.2);
    ctx.lineTo(-size * 0.35, size * 0.45);
    ctx.stroke();
    
    // Cockpit window - glowing
    ctx.save();
    ctx.shadowColor = "rgba(120, 255, 244, 0.8)";
    ctx.shadowBlur = 8;
    const cockpitGrad = ctx.createLinearGradient(size * 0.6, -size * 0.1, size * 0.2, size * 0.1);
    cockpitGrad.addColorStop(0, "rgba(200, 255, 255, 0.95)");
    cockpitGrad.addColorStop(0.5, "rgba(120, 220, 255, 0.9)");
    cockpitGrad.addColorStop(1, "rgba(80, 180, 220, 0.85)");
    ctx.fillStyle = cockpitGrad;
    ctx.beginPath();
    ctx.moveTo(size * 0.7, 0);
    ctx.lineTo(size * 0.35, -size * 0.12);
    ctx.lineTo(size * 0.15, -size * 0.08);
    ctx.lineTo(size * 0.15, size * 0.08);
    ctx.lineTo(size * 0.35, size * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    
    // Engine core glow (in the indent)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const coreGrad = ctx.createRadialGradient(-size * 0.5, 0, 0, -size * 0.5, 0, size * 0.2);
    coreGrad.addColorStop(0, `rgba(255, 255, 255, ${0.9 * enginePulse})`);
    coreGrad.addColorStop(0.4, `rgba(120, 255, 244, ${0.7 * enginePulse})`);
    coreGrad.addColorStop(1, "rgba(80, 200, 255, 0)");
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.ellipse(-size * 0.5, 0, size * 0.15, size * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Highlight edge on top
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size * 0.9, -size * 0.02);
    ctx.lineTo(size * 0.15, -size * 0.22);
    ctx.stroke();
    
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
