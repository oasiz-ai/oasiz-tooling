/**
 * Wheel obstacles - rolling black holes with accretion disks
 * Optimized: Uses cached glows instead of expensive shadowBlur
 */

import type { Wheel, RuntimePalette } from "../types";
import type { GradientCache } from "../utils/GradientCache";
import type { GlowCache } from "../rendering/GlowCache";
import { hash01 } from "../utils";
import { PERF } from "../config";

// ============================================================================
// WHEEL DRAWING
// ============================================================================

/**
 * Draw wheels as black holes with spinning accretion disks
 */
export function drawWheels(
  ctx: CanvasRenderingContext2D,
  wheels: Wheel[],
  runtimePalette: RuntimePalette,
  gradientCache?: GradientCache,
  glowCache?: GlowCache
): void {
  const time = performance.now() * 0.001;
  const useGlowCache = glowCache && PERF.useCachedGlows;

  ctx.save();
  for (const w of wheels) {
    const seed = hash01(w.x * 0.0037 + w.y * 0.0049 + w.radius * 0.11);
    const seed2 = hash01(seed * 91.7 + 0.123);

    ctx.save();
    ctx.translate(w.x, w.y);

    const r = w.radius;
    const diskR = r * 1.55;
    const diskRy = r * (0.42 + 0.1 * seed2);
    const tilt = (seed - 0.5) * 0.9;
    const spin = time * (1.4 + seed * 1.2);
    const pulse = 0.65 + 0.35 * Math.sin(time * 2.0 + seed * 30.0);

    // Big bloom / gravity glow - USE CACHED GLOW
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    
    if (useGlowCache) {
      // Draw cached ring glows instead of shadowBlur
      const alpha1 = 0.28 + 0.18 * pulse;
      const alpha2 = 0.18 + 0.12 * pulse;
      glowCache.drawRingGlow(ctx, 0, 0, r * 0.9, r * 1.2, 46, 0.47, 1, 0.96, alpha1);
      glowCache.drawRingGlow(ctx, 0, 0, r * 0.85, r * 1.15, 22, 1, 1, 1, alpha2 * 0.18);
    } else if (PERF.shadowBlurEnabled) {
      ctx.shadowColor = runtimePalette.waveGlow;
      ctx.shadowBlur = Math.min(46, PERF.maxShadowBlur);
      ctx.globalAlpha = 0.28 + 0.18 * pulse;
      ctx.strokeStyle = runtimePalette.trail;
      ctx.lineWidth = Math.max(8, Math.floor(r * 0.4));
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = Math.min(22, PERF.maxShadowBlur);
      ctx.globalAlpha = 0.18 + 0.12 * pulse;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = Math.max(5, Math.floor(r * 0.22));
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.04, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Accretion disk (tilted ellipse with hot inner edge)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.rotate(tilt);
    ctx.rotate(spin);
    const diskGrad = gradientCache
      ? gradientCache.getRadial(`wheel_disk_${Math.round(w.x)}_${Math.round(w.y)}`, w.x, w.y, r * 0.18, diskR, [
          [0.0, "rgba(0,0,0,0)"],
          [0.3, "rgba(0,0,0,0)"],
          [0.55, runtimePalette.trail],
          [0.82, "rgba(255,255,255,0.14)"],
          [1.0, "rgba(0,0,0,0)"],
        ])
      : (() => {
          const g = ctx.createRadialGradient(0, 0, r * 0.18, 0, 0, diskR);
          g.addColorStop(0.0, "rgba(0,0,0,0)");
          g.addColorStop(0.3, "rgba(0,0,0,0)");
          g.addColorStop(0.55, runtimePalette.trail);
          g.addColorStop(0.82, "rgba(255,255,255,0.14)");
          g.addColorStop(1.0, "rgba(0,0,0,0)");
          return g;
        })();
    ctx.globalAlpha = 0.34 + 0.22 * pulse;
    ctx.fillStyle = diskGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, diskR, diskRy, 0, 0, Math.PI * 2);
    ctx.fill();

    // Inner hot ring - USE CACHED GLOW
    if (useGlowCache) {
      const innerAlpha = 0.3 + 0.22 * pulse;
      glowCache.drawRingGlow(ctx, 0, 0, r * 0.9, r * 1.1, 20, 1, 1, 1, innerAlpha * 0.22);
    } else if (PERF.shadowBlurEnabled) {
      ctx.shadowColor = runtimePalette.waveGlow;
      ctx.shadowBlur = Math.min(20, PERF.maxShadowBlur);
      ctx.globalAlpha = 0.3 + 0.22 * pulse;
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = Math.max(2, Math.floor(r * 0.1));
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.08, r * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Event horizon (solid black) + subtle rim
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "lighter";
    if (useGlowCache) {
      glowCache.drawRingGlow(ctx, 0, 0, r * 0.88, r * 0.98, 12, 1, 1, 1, 0.16);
    } else if (PERF.shadowBlurEnabled) {
      ctx.shadowColor = "rgba(255,255,255,0.20)";
      ctx.shadowBlur = Math.min(12, PERF.maxShadowBlur);
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Lensing arcs (suggest bending light) - USE CACHED GLOW
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const arcAlpha = 0.16 + 0.12 * pulse;
    
    if (useGlowCache) {
      for (let i = 0; i < 3; i++) {
        const arcR = r * (1.2 + i * 0.18);
        glowCache.drawRingGlow(ctx, 0, 0, arcR - 4, arcR + 4, 18, 1, 1, 1, arcAlpha * 0.22);
      }
    } else if (PERF.shadowBlurEnabled) {
      ctx.shadowColor = runtimePalette.waveGlow;
      ctx.shadowBlur = Math.min(18, PERF.maxShadowBlur);
      ctx.globalAlpha = arcAlpha;
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a0 = (time * 0.9 + seed * 10 + i * 2.1) % (Math.PI * 2);
        const arcR = r * (1.2 + i * 0.18);
        ctx.beginPath();
        ctx.arc(0, 0, arcR, a0, a0 + 0.9);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Orbiting sparks (pixel-friendly squares), deterministic - USE CACHED GLOW
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    
    if (useGlowCache) {
      // Draw spark glows without shadowBlur
      for (let i = 0; i < 10; i++) {
        const h = hash01(seed * 100.0 + i * 12.7);
        const a = time * (1.2 + h * 2.8) + i * 0.7 + seed * 10.0;
        const rr = r * (1.05 + h * 0.95);
        const sx = Math.cos(a) * rr;
        const sy = Math.sin(a * (1.0 + seed2 * 0.25)) * rr * (0.55 + 0.15 * seed2);
        const s = 1 + Math.floor(h * 3);
        const sparkAlpha = 0.1 + 0.22 * (0.5 + 0.5 * Math.sin(a * 1.7));
        
        // Draw small glow sprite
        glowCache.drawCircleGlow(ctx, sx, sy, s * 2, 8, 0.47, 1, 0.96, sparkAlpha);
        
        // Draw core
        ctx.globalAlpha = sparkAlpha;
        ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.9)" : runtimePalette.trail;
        ctx.fillRect(Math.round(sx - s * 0.5), Math.round(sy - s * 0.5), s, s);
      }
    } else if (PERF.shadowBlurEnabled) {
      ctx.shadowColor = runtimePalette.waveGlow;
      ctx.shadowBlur = Math.min(12, PERF.maxShadowBlur);
      for (let i = 0; i < 10; i++) {
        const h = hash01(seed * 100.0 + i * 12.7);
        const a = time * (1.2 + h * 2.8) + i * 0.7 + seed * 10.0;
        const rr = r * (1.05 + h * 0.95);
        const sx = Math.cos(a) * rr;
        const sy = Math.sin(a * (1.0 + seed2 * 0.25)) * rr * (0.55 + 0.15 * seed2);
        const s = 1 + Math.floor(h * 3);
        ctx.globalAlpha = 0.1 + 0.22 * (0.5 + 0.5 * Math.sin(a * 1.7));
        ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.9)" : runtimePalette.trail;
        ctx.fillRect(Math.round(sx - s * 0.5), Math.round(sy - s * 0.5), s, s);
      }
    }
    ctx.restore();

    ctx.restore();
  }
  ctx.restore();
}
