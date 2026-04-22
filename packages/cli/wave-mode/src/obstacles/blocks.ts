/**
 * Block obstacles - solid obstacles in the corridor with different visual styles
 * Includes: Ship (diamond), Nebula (cloud), Asteroid (spinning rock)
 * Optimized: Uses capped shadowBlur for better performance
 */

import type { Block, RuntimePalette } from "../types";
import type { GradientCache } from "../utils/GradientCache";
import type { GlowCache } from "../rendering/GlowCache";
import { hash01, rgba } from "../utils";
import { PERF } from "../config";

// ============================================================================
// BLOCK DRAWING - Main entry point
// ============================================================================

/**
 * Draw blocks based on their kind (ship, nebula, asteroid)
 */
export function drawBlocks(
  ctx: CanvasRenderingContext2D,
  blocks: Block[],
  runtimePalette: RuntimePalette,
  gradientCache?: GradientCache,
  glowCache?: GlowCache
): void {
  for (const b of blocks) {
    switch (b.kind) {
      case "asteroid":
        drawAsteroidBlock(ctx, b, runtimePalette, gradientCache, glowCache);
        break;
      case "nebula":
        drawNebulaBlock(ctx, b, runtimePalette, gradientCache, glowCache);
        break;
      case "ship":
      default:
        drawShipBlock(ctx, b, runtimePalette, gradientCache, glowCache);
        break;
    }
  }
}

// ============================================================================
// SHIP BLOCK - Diamond ship with glowing effects and constellation points
// ============================================================================

function drawShipBlock(
  ctx: CanvasRenderingContext2D,
  b: Block,
  runtimePalette: RuntimePalette,
  gradientCache?: GradientCache,
  glowCache?: GlowCache
): void {
  const maxBlur = PERF.maxShadowBlur;
  const useGlowCache = glowCache && PERF.useCachedGlows;
  const seed = b.seed;
  const frac = (v: number): number => v - Math.floor(v);
  const h01 = (v: number): number => frac(Math.sin(v) * 43758.5453123);
  const v1 = h01(seed * 91.7 + b.x * 0.0031 + b.y * 0.0047);
  const v2 = h01(seed * 33.3 + b.x * 0.0019);
  const v3 = h01(seed * 17.1 + b.y * 0.0027);

  const time = performance.now() * 0.001;
  const pulse = 0.6 + 0.4 * Math.sin(time * 2.2 + seed * 18.0);

  const cx = b.x;
  const cy = b.y + b.h * 0.5;
  const rx = b.w * 0.5;
  const ry = b.h * 0.5;

  const tip = rx * (1.06 + 0.1 * v2);
  const fin = 0.56 + 0.12 * v1;
  const cut = 0.44 + 0.1 * v3;

  const pathInterstellar = (): void => {
    ctx.beginPath();
    // A "diamond ship" with a forward nose and side fins (interstellar silhouette)
    ctx.moveTo(0, -ry);
    ctx.lineTo(rx * fin, -ry * cut);
    ctx.lineTo(tip, 0);
    ctx.lineTo(rx * fin, ry * cut);
    ctx.lineTo(0, ry);
    ctx.lineTo(-rx * 0.85, ry * 0.3);
    ctx.lineTo(-rx, 0);
    ctx.lineTo(-rx * 0.85, -ry * 0.3);
    ctx.closePath();
  };

  ctx.save();
  ctx.translate(cx, cy);

  // BIG glow bloom (two passes)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (useGlowCache) {
    // Draw cached glow instead of shadowBlur
    glowCache.drawCircleGlow(ctx, 0, 0, Math.max(rx, ry), 46, 0.63, 1, 0.96, 0.22 + 0.18 * pulse);
    glowCache.drawCircleGlow(ctx, 0, 0, Math.max(rx, ry) * 0.8, 20, 1, 1, 1, 0.12 + 0.1 * pulse);
  } else if (PERF.shadowBlurEnabled) {
    ctx.shadowColor = runtimePalette.waveGlow;
    ctx.shadowBlur = Math.min(46, maxBlur);
    ctx.strokeStyle = rgba(160, 255, 245, 0.22 + 0.18 * pulse);
    ctx.lineWidth = Math.max(10, Math.floor(Math.min(rx, ry) * 0.45));
    pathInterstellar();
    ctx.stroke();

    ctx.shadowBlur = Math.min(20, maxBlur);
    ctx.strokeStyle = rgba(255, 255, 255, 0.12 + 0.1 * pulse);
    ctx.lineWidth = Math.max(6, Math.floor(Math.min(rx, ry) * 0.26));
    pathInterstellar();
    ctx.stroke();
  }
  ctx.restore();

  // Base body (dark hull with subtle nebula tint)
  const fillGrad = gradientCache
    ? gradientCache.getLinear(`ship_hull_${b.seed}`, cx - rx, cy - ry, cx + tip, cy + ry, [
        [0, "#05040d"],
        [0.55, "#0c1430"],
        [1, "#0b2b3b"],
      ])
    : (() => {
        const g = ctx.createLinearGradient(-rx, -ry, tip, ry);
        g.addColorStop(0, "#05040d");
        g.addColorStop(0.55, "#0c1430");
        g.addColorStop(1, "#0b2b3b");
        return g;
      })();
  ctx.fillStyle = fillGrad;
  ctx.strokeStyle = "rgba(230,255,248,0.86)";
  ctx.lineWidth = 3;
  if (!useGlowCache) ctx.shadowBlur = 0;
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
  const neb = gradientCache
    ? gradientCache.getRadialOffset(`ship_neb_${b.seed}`, rx * 0.1, -ry * 0.12, coreR * 0.08, 0, 0, coreR, [
        [0, rgba(255, 255, 255, 0.18)],
        [0.35, runtimePalette.trail],
        [1, "rgba(0,0,0,0)"],
      ])
    : (() => {
        const g = ctx.createRadialGradient(rx * 0.1, -ry * 0.12, coreR * 0.08, 0, 0, coreR);
        g.addColorStop(0, rgba(255, 255, 255, 0.18));
        g.addColorStop(0.35, runtimePalette.trail);
        g.addColorStop(1, "rgba(0,0,0,0)");
        return g;
      })();
  ctx.fillStyle = neb;
  ctx.fillRect(-rx * 1.4, -ry * 1.4, rx * 2.8, ry * 2.8);

  // Constellation points (pixel-friendly squares) + a few connecting lines
  ctx.globalCompositeOperation = "lighter";
  if (PERF.shadowBlurEnabled && !useGlowCache) {
    ctx.shadowColor = runtimePalette.waveGlow;
    ctx.shadowBlur = Math.min(10, maxBlur);
  }
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const px = (h01(seed * 100.0 + i * 12.7) - 0.5) * rx * 1.1;
    const py = (h01(seed * 200.0 + i * 9.9) - 0.5) * ry * 0.95;
    pts.push({ x: px, y: py });

    const s = 2 + Math.floor(h01(seed * 300.0 + i * 7.3) * 3);
    ctx.globalAlpha = 0.25 + 0.35 * h01(seed * 400.0 + i * 3.1);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(Math.round(px - s * 0.5), Math.round(py - s * 0.5), s, s);
  }

  ctx.globalAlpha = 0.18 + 0.14 * pulse;
  ctx.strokeStyle = runtimePalette.trail;
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
  if (PERF.shadowBlurEnabled && !useGlowCache) {
    ctx.shadowBlur = Math.min(22, maxBlur);
    ctx.shadowColor = runtimePalette.waveGlow;
  }
  ctx.fillStyle = rgba(255, 255, 255, 0.1 + 0.12 * corePulse);
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
  ctx.strokeStyle = runtimePalette.trail;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.85, ry * 0.3, (v1 - 0.5) * 0.9, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

// ============================================================================
// NEBULA BLOCK - Glowing cloud with rotating outer wisps and distinct core
// ============================================================================

function drawNebulaBlock(
  ctx: CanvasRenderingContext2D,
  b: Block,
  runtimePalette: RuntimePalette,
  gradientCache?: GradientCache,
  glowCache?: GlowCache
): void {
  const maxBlur = PERF.maxShadowBlur;
  const useGlowCache = glowCache && PERF.useCachedGlows;
  const seed = b.seed;
  const time = performance.now() * 0.001;

  const frac = (v: number): number => v - Math.floor(v);
  const h01 = (v: number): number => frac(Math.sin(v) * 43758.5453123);
  const s1 = h01(seed * 91.7 + b.x * 0.0031 + b.y * 0.0047);
  const s2 = h01(seed * 33.3 + b.x * 0.0019);
  const pulse = 0.65 + 0.35 * Math.sin(time * (1.4 + s1) + seed * 20.0);

  const cx = b.x;
  const cy = b.y + b.h * 0.5;
  const r = Math.max(18, Math.min(b.w, b.h) * 0.62);

  // Rotation speeds for different layers
  const outerRotation = time * 0.3 + seed * 10;
  const middleRotation = time * -0.5 + seed * 5;
  const innerRotation = time * 0.8 + seed * 3;

  ctx.save();
  ctx.translate(cx, cy);

  // ==========================================================================
  // LAYER 1: OUTER ROTATING WISPS (very visible, safe to touch)
  // ==========================================================================
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.rotate(outerRotation);
  
  // Large outer cloud wisps - highly visible
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const wispR = r * (1.4 + 0.3 * h01(seed * 10 + i * 7.7));
    const wispWidth = r * (0.5 + 0.2 * h01(seed * 20 + i * 3.3));
    const ox = Math.cos(angle) * r * 0.7;
    const oy = Math.sin(angle) * r * 0.7;
    
    const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, wispWidth);
    grad.addColorStop(0.0, "rgba(255,255,255,0.25)");
    grad.addColorStop(0.4, runtimePalette.trail.replace(/[\d.]+\)$/, "0.4)"));
    grad.addColorStop(1.0, "rgba(0,0,0,0)");
    
    ctx.globalAlpha = 0.5 + 0.2 * pulse;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(ox, oy, wispWidth, wispWidth * 0.6, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ==========================================================================
  // LAYER 2: MIDDLE ROTATING CLOUD LAYER
  // ==========================================================================
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.rotate(middleRotation);
  if (PERF.shadowBlurEnabled && !useGlowCache) {
    ctx.shadowColor = runtimePalette.waveGlow;
    ctx.shadowBlur = Math.min(30, maxBlur);
  }
  
  // Medium cloud blobs
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + s2 * 3.0;
    const blobR = r * (0.5 + 0.25 * h01(seed * 30 + i * 5.9));
    const ox = Math.cos(angle) * r * 0.5;
    const oy = Math.sin(angle) * r * 0.5;
    
    const grad = ctx.createRadialGradient(ox, oy, blobR * 0.1, ox, oy, blobR);
    grad.addColorStop(0.0, "rgba(255,255,255,0.3)");
    grad.addColorStop(0.5, runtimePalette.trail.replace(/[\d.]+\)$/, "0.35)"));
    grad.addColorStop(1.0, "rgba(0,0,0,0)");
    
    ctx.globalAlpha = 0.45 + 0.25 * pulse;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ox, oy, blobR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ==========================================================================
  // LAYER 3: ORBITING PARTICLES (animated sparkles)
  // ==========================================================================
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (PERF.shadowBlurEnabled && !useGlowCache) {
    ctx.shadowColor = runtimePalette.waveGlow;
    ctx.shadowBlur = Math.min(12, maxBlur);
  }
  
  for (let i = 0; i < 12; i++) {
    const h = h01(seed * 50.0 + i * 9.1);
    const orbitSpeed = 0.6 + h * 0.8;
    const orbitR = r * (0.9 + h * 0.5);
    const angle = time * orbitSpeed + (i / 12) * Math.PI * 2 + seed * 3.0;
    const px = Math.cos(angle) * orbitR;
    const py = Math.sin(angle) * orbitR * (0.7 + 0.3 * h);
    const particleSize = 2 + Math.floor(h * 3);
    
    ctx.globalAlpha = 0.4 + 0.4 * Math.sin(time * 2 + i);
    ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.9)" : runtimePalette.trail;
    ctx.beginPath();
    ctx.arc(px, py, particleSize, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ==========================================================================
  // LAYER 4: DISTINCT CORE (the dangerous hitbox - visually solid)
  // ==========================================================================
  ctx.save();
  ctx.rotate(innerRotation);
  
  // Core outer glow ring - marks the danger zone boundary
  ctx.globalCompositeOperation = "lighter";
  if (PERF.shadowBlurEnabled && !useGlowCache) {
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = Math.min(15, maxBlur);
  }
  ctx.globalAlpha = 0.6 + 0.3 * pulse;
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
  ctx.stroke();
  
  // Solid core fill - clearly the "dangerous" part
  ctx.globalCompositeOperation = "source-over";
  if (!useGlowCache) ctx.shadowBlur = 0;
  ctx.globalAlpha = 1.0;
  
  const coreGrad = gradientCache
    ? gradientCache.getRadial(`nebblock_core_${b.seed}`, cx, cy, 0, r * 0.35, [
        [0.0, "rgba(255,255,255,0.95)"],
        [0.3, "rgba(255,200,255,0.85)"],
        [0.6, runtimePalette.trail],
        [1.0, "rgba(80,40,120,0.9)"],
      ])
    : (() => {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.35);
        g.addColorStop(0.0, "rgba(255,255,255,0.95)");
        g.addColorStop(0.3, "rgba(255,200,255,0.85)");
        g.addColorStop(0.6, runtimePalette.trail);
        g.addColorStop(1.0, "rgba(80,40,120,0.9)");
        return g;
      })();
  
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  
  // Inner bright spot - very bright center
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.7 + 0.3 * pulse;
  const innerGlow = gradientCache
    ? gradientCache.getRadial(`nebblock_inner_${b.seed}`, cx, cy, 0, r * 0.15, [
        [0.0, "rgba(255,255,255,1)"],
        [0.5, "rgba(255,255,255,0.5)"],
        [1.0, "rgba(255,255,255,0)"],
      ])
    : (() => {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.15);
        g.addColorStop(0.0, "rgba(255,255,255,1)");
        g.addColorStop(0.5, "rgba(255,255,255,0.5)");
        g.addColorStop(1.0, "rgba(255,255,255,0)");
        return g;
      })();
  ctx.fillStyle = innerGlow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.15, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();

  // ==========================================================================
  // LAYER 5: LIGHTNING STREAKS (from core outward)
  // ==========================================================================
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (PERF.shadowBlurEnabled && !useGlowCache) {
    ctx.shadowColor = runtimePalette.waveGlow;
    ctx.shadowBlur = Math.min(10, maxBlur);
  }
  ctx.globalAlpha = 0.25 + 0.2 * pulse;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  
  for (let i = 0; i < 4; i++) {
    const baseAngle = (seed * 10 + i * 1.57) + time * 0.2;
    const r0 = r * 0.35; // Start from core edge
    const r1 = r * (0.9 + 0.3 * h01(seed * 90 + i * 5.3));
    
    ctx.beginPath();
    ctx.moveTo(Math.cos(baseAngle) * r0, Math.sin(baseAngle) * r0);
    // Jagged lightning path
    const midR = (r0 + r1) * 0.5;
    const jag = 0.15 + 0.1 * h01(seed * 100 + i);
    ctx.lineTo(Math.cos(baseAngle + jag) * midR, Math.sin(baseAngle + jag) * midR);
    ctx.lineTo(Math.cos(baseAngle - jag * 0.5) * (midR + r * 0.15), Math.sin(baseAngle - jag * 0.5) * (midR + r * 0.15));
    ctx.lineTo(Math.cos(baseAngle + jag * 0.3) * r1, Math.sin(baseAngle + jag * 0.3) * r1);
    ctx.stroke();
  }
  ctx.restore();

  ctx.restore();
}

// ============================================================================
// ASTEROID BLOCK - Spinning irregular rock with craters and orbiting fragments
// ============================================================================

function drawAsteroidBlock(
  ctx: CanvasRenderingContext2D,
  b: Block,
  _runtimePalette: RuntimePalette,
  gradientCache?: GradientCache,
  _glowCache?: GlowCache
): void {
  const seed = b.seed;
  const time = performance.now() * 0.001;

  const frac = (v: number): number => v - Math.floor(v);
  const h01 = (v: number): number => frac(Math.sin(v) * 43758.5453123);
  const s1 = h01(seed * 91.7 + b.x * 0.0031 + b.y * 0.0047);
  const s2 = h01(seed * 33.3 + b.x * 0.0019);

  const cx = b.x;
  const cy = b.y + b.h * 0.5;
  const r = Math.min(b.w, b.h) * 0.5;
  const spin = time * (0.8 + s1 * 0.6);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spin);

  // Faint outer ring (where glow used to be)
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = "rgba(180,220,255,1)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Rock surface with craters and bumps (irregular shape) - space-themed colors
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  const rockGrad = gradientCache
    ? gradientCache.getRadial(`ast_rock_${b.seed}`, cx, cy, r * 0.2, r, [
        [0.0, "rgba(180,220,255,0.85)"],
        [0.4, "rgba(100,160,220,0.75)"],
        [0.8, "rgba(40,80,140,0.85)"],
        [1.0, "rgba(20,40,80,0.95)"],
      ])
    : (() => {
        const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
        g.addColorStop(0.0, "rgba(180,220,255,0.85)");
        g.addColorStop(0.4, "rgba(100,160,220,0.75)");
        g.addColorStop(0.8, "rgba(40,80,140,0.85)");
        g.addColorStop(1.0, "rgba(20,40,80,0.95)");
        return g;
      })();
  ctx.fillStyle = rockGrad;
  ctx.strokeStyle = "rgba(200,240,255,0.6)";
  ctx.lineWidth = 2;
  ctx.shadowBlur = 0;

  // Draw irregular rock shape using multiple points
  ctx.beginPath();
  const points = 12;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const variance = 0.75 + 0.25 * h01(seed * 100 + i * 7.3);
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
    const cr = r * (0.15 + 0.15 * h01(seed * 200 + i * 11.7));
    const cx2 = Math.cos(ca) * r * (0.3 + 0.3 * h01(seed * 300 + i * 13.1));
    const cy2 = Math.sin(ca) * r * (0.3 + 0.3 * h01(seed * 400 + i * 17.3));
    ctx.fillStyle = "rgba(10,30,60,0.5)";
    ctx.beginPath();
    ctx.arc(cx2, cy2, cr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Highlight edges (no glow)
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(200,240,255,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const variance = 0.75 + 0.25 * h01(seed * 100 + i * 7.3);
    const rr = r * variance;
    const x = Math.cos(angle) * rr;
    const y = Math.sin(angle) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Orbiting crystal fragments (no glow)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 6; i++) {
    const h = h01(seed * 50.0 + i * 9.1);
    const a = spin * 0.8 + (i / 6) * Math.PI * 2 + seed * 3.0;
    const rr = r * (1.05 + h * 0.3);
    const sx = Math.cos(a) * rr;
    const sy = Math.sin(a) * rr;
    const s = 1 + Math.floor(h * 2);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.9)" : "rgba(120,255,244,0.8)";
    ctx.fillRect(Math.round(sx - s * 0.5), Math.round(sy - s * 0.5), s, s);
  }
  ctx.restore();

  ctx.restore();
}
