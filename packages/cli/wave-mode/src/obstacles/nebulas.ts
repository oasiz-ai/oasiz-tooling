/**
 * Nebula obstacles - swirling semi-transparent hazard zones
 * Optimized: Uses cached glows instead of expensive shadowBlur
 */

import type { NebulaCloud } from "../types";
import type { GradientCache } from "../utils/GradientCache";
import type { GlowCache } from "../rendering/GlowCache";
import { seededRandom } from "../utils";
import { PERF } from "../config";

// ============================================================================
// NEBULA DRAWING
// ============================================================================

/**
 * Draw nebula clouds - swirling semi-transparent hazard zones with 3 color layers
 * Optimized: Uses cached glows instead of expensive shadowBlur
 */
export function drawNebulas(
  ctx: CanvasRenderingContext2D,
  nebulas: NebulaCloud[],
  gradientCache?: GradientCache,
  glowCache?: GlowCache
): void {
  const time = performance.now() * 0.001;
  const useGlowCache = glowCache && PERF.useCachedGlows;

  for (const n of nebulas) {
    ctx.save();

    const pulse = 0.7 + 0.3 * Math.sin(time * 1.5 + n.seed * 0.1);

    // 3-color palette for each nebula type - outer, middle, inner/core
    let colors: {
      outer: string;
      middle: string;
      inner: string;
      glow: string;
      spark: string;
      glowRGB: [number, number, number];
    };

    switch (n.color) {
      case "purple":
        colors = {
          outer: "rgba(80, 40, 160, 0.4)",
          middle: "rgba(180, 80, 220, 0.5)",
          inner: "rgba(255, 150, 255, 0.6)",
          glow: "rgba(200, 100, 255, 0.8)",
          spark: "rgba(255, 200, 255, 0.9)",
          glowRGB: [0.78, 0.39, 1],
        };
        break;
      case "pink":
        colors = {
          outer: "rgba(160, 40, 80, 0.4)",
          middle: "rgba(255, 100, 150, 0.5)",
          inner: "rgba(255, 200, 100, 0.6)",
          glow: "rgba(255, 120, 180, 0.8)",
          spark: "rgba(255, 220, 180, 0.9)",
          glowRGB: [1, 0.47, 0.71],
        };
        break;
      case "cyan":
      default:
        colors = {
          outer: "rgba(40, 80, 160, 0.4)",
          middle: "rgba(80, 200, 220, 0.5)",
          inner: "rgba(200, 255, 200, 0.6)",
          glow: "rgba(100, 220, 255, 0.8)",
          spark: "rgba(200, 255, 255, 0.9)",
          glowRGB: [0.39, 0.86, 1],
        };
        break;
    }

    // Massive outer glow for prominence - USE CACHED GLOW
    if (useGlowCache) {
      // Draw a large soft glow behind the entire nebula instead of shadowBlur
      const glowSize = Math.max(n.width, n.height) * 1.5;
      glowCache.drawSoftGlow(ctx, n.x, n.y, glowSize, colors.glowRGB[0], colors.glowRGB[1], colors.glowRGB[2], 0.35 * pulse * n.intensity);
    } else if (PERF.shadowBlurEnabled) {
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = Math.min(50 * pulse, PERF.maxShadowBlur);
    }

    ctx.globalCompositeOperation = "lighter";

    // LAYER 1: Outer color layer - largest, slowest rotation
    for (let i = 0; i < 3; i++) {
      const offset = seededRandom(n.seed, i * 11) * 15 - 7;
      const rotation = time * 0.2 + n.seed + i * 2.1;
      const scale = 1.1 + i * 0.1;

      ctx.save();
      ctx.translate(
        n.x + offset * Math.cos(rotation),
        n.y + offset * Math.sin(rotation)
      );
      ctx.rotate(rotation * 0.3);

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, n.width * scale * 0.6);
      grad.addColorStop(
        0,
        colors.outer.replace("0.4", `${0.35 * n.intensity * pulse}`)
      );
      grad.addColorStop(
        0.6,
        colors.outer.replace("0.4", `${0.2 * n.intensity * pulse}`)
      );
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
      ctx.translate(
        n.x + offset * Math.cos(rotation * 1.2),
        n.y + offset * Math.sin(rotation)
      );
      ctx.rotate(rotation * 0.5);

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, n.width * scale * 0.5);
      grad.addColorStop(
        0,
        colors.middle.replace("0.5", `${0.45 * n.intensity * pulse}`)
      );
      grad.addColorStop(
        0.5,
        colors.middle.replace("0.5", `${0.25 * n.intensity * pulse}`)
      );
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
      ctx.translate(
        n.x + offset * Math.cos(rotation * 1.5),
        n.y + offset * Math.sin(rotation * 1.3)
      );
      ctx.rotate(rotation * 0.7);

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, n.width * scale * 0.4);
      grad.addColorStop(
        0,
        colors.inner.replace("0.6", `${0.6 * n.intensity * pulse}`)
      );
      grad.addColorStop(
        0.4,
        colors.inner.replace("0.6", `${0.35 * n.intensity * pulse}`)
      );
      grad.addColorStop(1, "rgba(0,0,0,0)");

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, n.width * scale * 0.4, n.height * scale * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Bright central hotspot
    ctx.save();
    const nebCoreGrad = gradientCache
      ? gradientCache.getRadial(`neb_core_${Math.round(n.x)}_${n.color}`, n.x, n.y, 0, n.width * 0.15, [
          [0, `rgba(255, 255, 255, ${0.5 * n.intensity * pulse})`],
          [0.5, colors.inner.replace("0.6", `${0.3 * n.intensity * pulse}`)],
          [1, "rgba(0,0,0,0)"],
        ])
      : (() => {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.width * 0.15);
          g.addColorStop(0, `rgba(255, 255, 255, ${0.5 * n.intensity * pulse})`);
          g.addColorStop(0.5, colors.inner.replace("0.6", `${0.3 * n.intensity * pulse}`));
          g.addColorStop(1, "rgba(0,0,0,0)");
          return g;
        })();
    ctx.fillStyle = nebCoreGrad;
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

      if (sparkTime < 0.3) {
        const sx = n.x + (seededRandom(n.seed, i * 17) - 0.5) * n.width * 0.6;
        const sy = n.y + (seededRandom(n.seed, i * 23) - 0.5) * n.height * 0.6;

        ctx.beginPath();
        ctx.moveTo(sx, sy);

        let px = sx,
          py = sy;
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
