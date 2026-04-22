/**
 * Comet obstacles - moving obstacles with glowing trails
 * Optimized: Uses capped shadowBlur for better performance
 */

import type { Comet, Chunk } from "../types";
import type { GradientCache } from "../utils/GradientCache";
import type { GlowCache } from "../rendering/GlowCache";
import { PERF } from "../config";

// ============================================================================
// COMET UPDATE
// ============================================================================

/**
 * Update comet positions (they move along their paths)
 */
export function updateComets(chunks: Chunk[], dt: number): void {
  for (const chunk of chunks) {
    for (const c of chunk.comets) {
      // Calculate movement based on path length (minimum 50px to prevent freeze/NaN)
      const pathLength = Math.max(
        50,
        Math.sqrt(Math.pow(c.endX - c.startX, 2) + Math.pow(c.endY - c.startY, 2))
      );

      const progressDelta = (c.speed * dt) / pathLength;
      c.progress += progressDelta;

      // Bounce back and forth
      if (c.progress >= 1) {
        c.progress = 1;
        // Reverse direction
        const tempX = c.startX;
        const tempY = c.startY;
        c.startX = c.endX;
        c.startY = c.endY;
        c.endX = tempX;
        c.endY = tempY;
        c.progress = 0;
      }

      // Interpolate position
      c.x = c.startX + (c.endX - c.startX) * c.progress;
      c.y = c.startY + (c.endY - c.startY) * c.progress;
    }
  }
}

// ============================================================================
// COMET DRAWING
// ============================================================================

/**
 * Draw comets - moving obstacles with glowing trails
 */
export function drawComets(
  ctx: CanvasRenderingContext2D,
  comets: Comet[],
  gradientCache?: GradientCache,
  glowCache?: GlowCache
): void {
  const time = performance.now() * 0.001;
  const maxBlur = PERF.maxShadowBlur;

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

    const tailGrad = gradientCache
      ? gradientCache.getLinear(`comet_tail_${Math.round(c.startX)}`, c.x, c.y, tailEndX, tailEndY, [
          [0, tailColor],
          [0.3, tailColor.replace("0.6", "0.3")],
          [1, "rgba(0,0,0,0)"],
        ])
      : (() => {
          const g = ctx.createLinearGradient(c.x, c.y, tailEndX, tailEndY);
          g.addColorStop(0, tailColor);
          g.addColorStop(0.3, tailColor.replace("0.6", "0.3"));
          g.addColorStop(1, "rgba(0,0,0,0)");
          return g;
        })();

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
      const sparkX = c.x + (tailEndX - c.x) * t + Math.sin(time * 5 + i * 2) * 3;
      const sparkY = c.y + (tailEndY - c.y) * t + Math.cos(time * 5 + i * 2) * 3;
      const sparkSize = (1 - t) * 2 + 1;
      ctx.globalAlpha = (1 - t) * 0.6 * pulse;
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, sparkSize, 0, Math.PI * 2);
      ctx.fill();
    }

    // Comet core with glow
    ctx.globalAlpha = 1;
    if (PERF.shadowBlurEnabled) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = Math.min(20 * pulse, maxBlur);
    }

    // Outer glow
    const cometCoreGrad = gradientCache
      ? gradientCache.getRadial(`comet_core_${Math.round(c.startX)}`, c.x, c.y, 0, c.size * 1.5, [
          [0, coreColor],
          [0.4, tailColor],
          [1, "rgba(0,0,0,0)"],
        ])
      : (() => {
          const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.size * 1.5);
          g.addColorStop(0, coreColor);
          g.addColorStop(0.4, tailColor);
          g.addColorStop(1, "rgba(0,0,0,0)");
          return g;
        })();

    ctx.fillStyle = cometCoreGrad;
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
