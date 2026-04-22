/**
 * Pulsar obstacles - rotating energy beams that sweep the corridor
 * Optimized: Uses capped shadowBlur for better performance
 */

import type { Pulsar, RuntimePalette } from "../types";
import type { GradientCache } from "../utils/GradientCache";
import type { GlowCache } from "../rendering/GlowCache";
import { PERF } from "../config";

// ============================================================================
// PULSAR DRAWING
// ============================================================================

/**
 * Draw pulsars - rotating energy beams
 */
export function drawPulsars(
  ctx: CanvasRenderingContext2D,
  pulsars: Pulsar[],
  runtimePalette: RuntimePalette,
  gradientCache?: GradientCache,
  glowCache?: GlowCache
): void {
  const time = performance.now() * 0.001;
  const maxBlur = PERF.maxShadowBlur;

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
        glowColor = runtimePalette.waveGlow;
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
      if (PERF.shadowBlurEnabled) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = Math.min(25 * pulse, maxBlur);
      }

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
    if (PERF.shadowBlurEnabled) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = Math.min(20 * pulse, maxBlur);
    }

    // Outer glow ring
    ctx.strokeStyle = beamColor;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.5 * pulse;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.stroke();

    // Core - static gradient can be cached well
    const pulsarCoreGrad = gradientCache
      ? gradientCache.getRadial(`pulsar_core_${p.color}`, p.x, p.y, 0, 10, [
          [0, coreColor],
          [0.5, beamColor],
          [1, "rgba(0,0,0,0)"],
        ])
      : (() => {
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
          g.addColorStop(0, coreColor);
          g.addColorStop(0.5, beamColor);
          g.addColorStop(1, "rgba(0,0,0,0)");
          return g;
        })();

    ctx.globalAlpha = 1;
    ctx.fillStyle = pulsarCoreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
