/**
 * Spike obstacles - individual spikes and spike fields
 * Spikes are triangular hazards that spawn on flat surfaces
 */

import type { SpikeTri, SpikeField, Chunk, SpikeKind, RuntimePalette, Point } from "../types";
import type { GradientCache } from "../utils/GradientCache";
import { CONFIG } from "../config";
import { lerp, seededRandom } from "../utils";

// ============================================================================
// SPIKE KIND SELECTION
// ============================================================================

/**
 * Pick a random spike visual type with weighted distribution
 */
export function pickSpikeKind(): SpikeKind {
  const r = Math.random();
  if (r < 0.30) return "crystal";
  if (r < 0.55) return "plasma";
  if (r < 0.80) return "void";
  return "asteroid";
}

// ============================================================================
// SPIKE CREATION
// ============================================================================

/**
 * Create a spike at the given position
 */
export function makeSpike(
  cx: number,
  baseY: number,
  fromTop: boolean,
  scaleOverride?: number,
  kindOverride?: SpikeKind
): SpikeTri {
  const scale = scaleOverride ?? (CONFIG.SPIKE_SCALE_MIN + Math.random() * (CONFIG.SPIKE_SCALE_MAX - CONFIG.SPIKE_SCALE_MIN));
  const w = CONFIG.SPIKE_W * scale;
  const h = CONFIG.SPIKE_H * scale;
  const kind = kindOverride ?? pickSpikeKind();

  if (fromTop) {
    // base on top surface, tip down into corridor
    return {
      ax: cx,
      ay: baseY + h,
      bx: cx - w * 0.5,
      by: baseY,
      cx: cx + w * 0.5,
      cy: baseY,
      scale,
      kind,
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
    scale,
    kind,
  };
}

// ============================================================================
// SPIKE PLACEMENT VALIDATION
// ============================================================================

/**
 * Check if a spike can be placed without overlapping existing spikes
 */
export function canPlaceSpike(chunk: Chunk, cx: number, scale: number): boolean {
  const w = CONFIG.SPIKE_W * scale;
  const buffer = 8; // Extra spacing between spikes

  for (const s of chunk.spikes) {
    const existingW = CONFIG.SPIKE_W * s.scale;
    const existingCx = (s.bx + s.cx) * 0.5;
    const minSpacing = (w + existingW) * 0.5 + buffer;

    if (Math.abs(cx - existingCx) < minSpacing) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a position is within an obstacle's clearance zone
 */
export function isInObstacleZone(chunk: Chunk, cx: number): boolean {
  const clearanceX = CONFIG.OBSTACLE_CLEARANCE_X;

  // Check blocks
  for (const b of chunk.blocks) {
    const blockLeft = b.x - b.w * 0.5 - clearanceX;
    const blockRight = b.x + b.w * 0.5 + clearanceX;
    if (cx >= blockLeft && cx <= blockRight) return true;
  }

  // Check wheels
  for (const w of chunk.wheels) {
    if (Math.abs(cx - w.x) < w.radius + clearanceX) return true;
  }

  // Check nebulas
  for (const n of chunk.nebulas) {
    const halfW = n.width * 0.5;
    if (Math.abs(cx - n.x) < halfW + clearanceX) return true;
  }

  // Check pulsars
  for (const p of chunk.pulsars) {
    if (Math.abs(cx - p.x) < p.radius + clearanceX) return true;
  }

  // Check comets
  for (const c of chunk.comets) {
    if (Math.abs(cx - c.startX) < c.size * 2 + clearanceX) return true;
  }

  return false;
}

// ============================================================================
// SPIKE PATTERN SELECTION
// ============================================================================

export type SpikePattern = "single_big" | "field" | "staggered" | "sparse";

/**
 * Pick a spike pattern based on difficulty
 * Early game: balanced mix with good field visibility
 * Later game: more fields and staggered patterns
 */
export function pickSpikePattern(diff: number): SpikePattern {
  const r = Math.random();

  if (diff < 0.3) {
    if (r < 0.30) return "single_big";
    if (r < 0.50) return "sparse";
    if (r < 0.70) return "staggered";
    return "field"; // 30% chance for field
  } else if (diff < 0.6) {
    if (r < 0.20) return "single_big";
    if (r < 0.40) return "sparse";
    if (r < 0.65) return "staggered";
    return "field"; // 35% chance for field
  } else {
    if (r < 0.15) return "single_big";
    if (r < 0.45) return "sparse";
    if (r < 0.75) return "staggered";
    return "field";
  }
}

// ============================================================================
// SPIKE DRAWING
// ============================================================================

/**
 * Draw individual spikes with visual style based on kind
 * No glow effects - clean solid spikes for better visibility
 */
export function drawSpikes(
  ctx: CanvasRenderingContext2D,
  spikes: SpikeTri[],
  runtimePalette: RuntimePalette,
  gradientCache?: GradientCache
): void {
  for (const t of spikes) {
    ctx.save();

    // Calculate spike center and dimensions
    const centerX = (t.bx + t.cx) * 0.5;
    const tipX = t.ax;
    const tipY = t.ay;

    switch (t.kind) {
      case "crystal": {
        // Crystal Energy Shards - translucent gradient (no glow)
        const grad = gradientCache
          ? gradientCache.getLinear(`spike_crystal_${Math.round(centerX)}`, tipX, tipY, centerX, t.by, [
              [0, "rgba(255, 255, 255, 0.95)"],
              [0.3, runtimePalette.waveGlow],
              [0.7, "rgba(120, 255, 244, 0.6)"],
              [1, "rgba(80, 200, 220, 0.3)"],
            ])
          : (() => {
              const g = ctx.createLinearGradient(tipX, tipY, centerX, t.by);
              g.addColorStop(0, "rgba(255, 255, 255, 0.95)");
              g.addColorStop(0.3, runtimePalette.waveGlow);
              g.addColorStop(0.7, "rgba(120, 255, 244, 0.6)");
              g.addColorStop(1, "rgba(80, 200, 220, 0.3)");
              return g;
            })();

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(t.ax, t.ay);
        ctx.lineTo(t.bx, t.by);
        ctx.lineTo(t.cx, t.cy);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = "rgba(200, 255, 250, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      }

      case "plasma": {
        // Plasma Spikes - hot gradient (no glow)
        const grad = gradientCache
          ? gradientCache.getLinear(`spike_plasma_${Math.round(centerX)}`, tipX, tipY, centerX, t.by, [
              [0, "rgba(255, 255, 255, 1)"],
              [0.2, "rgba(255, 220, 150, 0.95)"],
              [0.5, "rgba(255, 140, 80, 0.8)"],
              [0.8, "rgba(255, 80, 50, 0.6)"],
              [1, "rgba(200, 50, 30, 0.4)"],
            ])
          : (() => {
              const g = ctx.createLinearGradient(tipX, tipY, centerX, t.by);
              g.addColorStop(0, "rgba(255, 255, 255, 1)");
              g.addColorStop(0.2, "rgba(255, 220, 150, 0.95)");
              g.addColorStop(0.5, "rgba(255, 140, 80, 0.8)");
              g.addColorStop(0.8, "rgba(255, 80, 50, 0.6)");
              g.addColorStop(1, "rgba(200, 50, 30, 0.4)");
              return g;
            })();

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(t.ax, t.ay);
        ctx.lineTo(t.bx, t.by);
        ctx.lineTo(t.cx, t.cy);
        ctx.closePath();
        ctx.fill();

        // Inner hot line
        ctx.strokeStyle = "rgba(255, 200, 150, 0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(centerX, t.by);
        ctx.stroke();
        break;
      }

      case "void": {
        // Void Thorns - dark solid (no glow)
        ctx.fillStyle = "rgba(10, 5, 20, 0.9)";
        ctx.beginPath();
        ctx.moveTo(t.ax, t.ay);
        ctx.lineTo(t.bx, t.by);
        ctx.lineTo(t.cx, t.cy);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = runtimePalette.trail;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner detail line
        ctx.strokeStyle = "rgba(150, 100, 255, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo((t.bx + centerX) * 0.5, (t.by + tipY) * 0.5);
        ctx.stroke();
        break;
      }

      case "asteroid": {
        // Asteroid Fragments - rocky (no glow)
        ctx.fillStyle = "rgba(80, 70, 90, 0.95)";
        ctx.beginPath();
        ctx.moveTo(t.ax, t.ay);
        ctx.lineTo(t.bx, t.by);
        ctx.lineTo(t.cx, t.cy);
        ctx.closePath();
        ctx.fill();

        // Darker inner layer for depth
        ctx.fillStyle = "rgba(50, 45, 60, 0.7)";
        const inset = 0.15;
        const innerTipX = tipX + (centerX - tipX) * inset;
        const innerTipY = tipY + (t.by - tipY) * inset;
        const innerLeftX = t.bx + (centerX - t.bx) * inset * 2;
        const innerLeftY = t.by + (tipY - t.by) * inset;
        const innerRightX = t.cx + (centerX - t.cx) * inset * 2;
        const innerRightY = t.cy + (tipY - t.cy) * inset;
        ctx.beginPath();
        ctx.moveTo(innerTipX, innerTipY);
        ctx.lineTo(innerLeftX, innerLeftY);
        ctx.lineTo(innerRightX, innerRightY);
        ctx.closePath();
        ctx.fill();

        // Cracks (no glow)
        ctx.strokeStyle = "rgba(255, 150, 80, 0.7)";
        ctx.lineWidth = 1;
        const crackY1 = tipY + (t.by - tipY) * 0.4;
        const crackY2 = tipY + (t.by - tipY) * 0.75;
        const w = Math.abs(t.cx - t.bx);
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(centerX + w * 0.08, crackY1);
        ctx.lineTo(centerX - w * 0.12, crackY2);
        ctx.stroke();

        // Outline
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
        // Fallback style (no glow)
        ctx.fillStyle = CONFIG.SPIKE_FILL;
        ctx.strokeStyle = CONFIG.SPIKE_STROKE;
        ctx.lineWidth = 2;
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

// ============================================================================
// SPIKE FIELD DRAWING
// ============================================================================

/**
 * Draw spike fields as unified jagged shapes
 * No glow effects - clean solid spikes for better visibility
 */
export function drawSpikeFields(
  ctx: CanvasRenderingContext2D,
  fields: SpikeField[],
  runtimePalette: RuntimePalette,
  gradientCache?: GradientCache
): void {
  for (const f of fields) {
    ctx.save();

    const halfWidth = f.width * 0.5;
    const leftX = f.x - halfWidth;
    const rightX = f.x + halfWidth;

    // Generate jagged outline path points
    const points: { x: number; y: number }[] = [];

    // Start at left base corner
    points.push({ x: leftX, y: f.baseY });

    // Generate jagged peaks across the width
    const segmentWidth = f.width / f.peakCount;
    for (let i = 0; i <= f.peakCount; i++) {
      const t = i / f.peakCount;
      const x = leftX + t * f.width;

      const heightMod = seededRandom(f.seed, i * 3) * 0.6 + 0.4;
      const peakHeight = f.height * heightMod;

      const xOffset = (seededRandom(f.seed, i * 5 + 100) - 0.5) * segmentWidth * 0.5;
      const isPeak = i % 2 === 0 || seededRandom(f.seed, i * 7) > 0.7;

      if (isPeak && i > 0 && i < f.peakCount) {
        const peakY = f.isTop ? f.baseY + peakHeight : f.baseY - peakHeight;
        points.push({ x: x + xOffset, y: peakY });
      } else if (i > 0 && i < f.peakCount) {
        const valleyHeight = f.height * 0.15 * seededRandom(f.seed, i * 11);
        const valleyY = f.isTop ? f.baseY + valleyHeight : f.baseY - valleyHeight;
        points.push({ x: x + xOffset * 0.5, y: valleyY });
      }
    }

    // End at right base corner
    points.push({ x: rightX, y: f.baseY });

    // Draw the unified shape
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();

    switch (f.kind) {
      case "crystal": {
        const tipY = f.isTop ? f.baseY + f.height : f.baseY - f.height;
        const crystalGrad = gradientCache
          ? gradientCache.getLinear(`field_crystal_${Math.round(f.x)}`, f.x, f.baseY, f.x, tipY, [
              [0, "rgba(120, 200, 220, 0.3)"],
              [0.4, "rgba(150, 255, 244, 0.6)"],
              [0.8, runtimePalette.waveGlow],
              [1, "rgba(255, 255, 255, 0.9)"],
            ])
          : (() => {
              const g = ctx.createLinearGradient(f.x, f.baseY, f.x, tipY);
              g.addColorStop(0, "rgba(120, 200, 220, 0.3)");
              g.addColorStop(0.4, "rgba(150, 255, 244, 0.6)");
              g.addColorStop(0.8, runtimePalette.waveGlow);
              g.addColorStop(1, "rgba(255, 255, 255, 0.9)");
              return g;
            })();

        ctx.fillStyle = crystalGrad;
        ctx.fill();

        ctx.strokeStyle = "rgba(200, 255, 250, 0.6)";
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }

      case "plasma": {
        const plasmaTipY = f.isTop ? f.baseY + f.height : f.baseY - f.height;
        const plasmaGrad = gradientCache
          ? gradientCache.getLinear(`field_plasma_${Math.round(f.x)}`, f.x, f.baseY, f.x, plasmaTipY, [
              [0, "rgba(200, 50, 30, 0.35)"],
              [0.3, "rgba(255, 100, 50, 0.6)"],
              [0.6, "rgba(255, 180, 100, 0.8)"],
              [1, "rgba(255, 255, 200, 0.95)"],
            ])
          : (() => {
              const g = ctx.createLinearGradient(f.x, f.baseY, f.x, plasmaTipY);
              g.addColorStop(0, "rgba(200, 50, 30, 0.35)");
              g.addColorStop(0.3, "rgba(255, 100, 50, 0.6)");
              g.addColorStop(0.6, "rgba(255, 180, 100, 0.8)");
              g.addColorStop(1, "rgba(255, 255, 200, 0.95)");
              return g;
            })();

        ctx.fillStyle = plasmaGrad;
        ctx.fill();

        ctx.strokeStyle = "rgba(255, 220, 150, 0.5)";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        break;
      }

      case "void": {
        ctx.fillStyle = "rgba(8, 4, 18, 0.92)";
        ctx.fill();

        ctx.strokeStyle = runtimePalette.trail;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Inner detail lines
        ctx.strokeStyle = "rgba(140, 90, 255, 0.25)";
        ctx.lineWidth = 1;
        for (let i = 2; i < points.length - 2; i += 2) {
          ctx.beginPath();
          ctx.moveTo(f.x, f.baseY);
          ctx.lineTo(points[i].x, points[i].y);
          ctx.stroke();
        }
        break;
      }

      case "asteroid": {
        ctx.fillStyle = "rgba(75, 65, 85, 0.93)";
        ctx.fill();

        // Inner darker layer
        ctx.fillStyle = "rgba(45, 40, 55, 0.5)";
        ctx.beginPath();
        const inset = 0.3;
        ctx.moveTo(
          points[0].x + (f.x - points[0].x) * inset,
          points[0].y
        );
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(
            points[i].x + (f.x - points[i].x) * inset,
            points[i].y + (f.baseY - points[i].y) * inset * 0.5
          );
        }
        ctx.closePath();
        ctx.fill();

        // Cracks (no glow)
        ctx.strokeStyle = "rgba(255, 160, 90, 0.6)";
        ctx.lineWidth = 1.5;

        for (let i = 2; i < points.length - 2; i += 3) {
          ctx.beginPath();
          ctx.moveTo(f.x, f.baseY);
          ctx.lineTo(points[i].x, points[i].y * 0.85 + f.baseY * 0.15);
          ctx.stroke();
        }

        // Outline
        ctx.strokeStyle = "rgba(35, 30, 45, 0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        break;
      }

      default: {
        ctx.fillStyle = CONFIG.SPIKE_FILL;
        ctx.fill();
        ctx.strokeStyle = CONFIG.SPIKE_STROKE;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}
