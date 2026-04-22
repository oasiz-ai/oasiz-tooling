/**
 * Wave Mode Utility Functions
 * Helper functions for math, collision, and haptics
 */

import type { SpikeTri, Settings } from './types';

// ==================== Math Utilities ====================

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function lerp4(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number
): [number, number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
}

export function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ==================== Color Utilities ====================

export function rgb(r: number, g: number, b: number): string {
  // Defensive: clamp and handle NaN to prevent canvas errors
  const rr = Number.isFinite(r) ? clamp(Math.round(r), 0, 255) : 0;
  const gg = Number.isFinite(g) ? clamp(Math.round(g), 0, 255) : 0;
  const bb = Number.isFinite(b) ? clamp(Math.round(b), 0, 255) : 0;
  return `rgb(${rr}, ${gg}, ${bb})`;
}

export function rgba(r: number, g: number, b: number, a: number): string {
  // Defensive: clamp and handle NaN to prevent canvas errors
  const rr = Number.isFinite(r) ? clamp(Math.round(r), 0, 255) : 0;
  const gg = Number.isFinite(g) ? clamp(Math.round(g), 0, 255) : 0;
  const bb = Number.isFinite(b) ? clamp(Math.round(b), 0, 255) : 0;
  const aa = Number.isFinite(a) ? clamp(a, 0, 1) : 1;
  return `rgba(${rr}, ${gg}, ${bb}, ${aa.toFixed(3)})`;
}

// ==================== Distance/Geometry Utilities ====================

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function pointSegDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
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

// ==================== Collision Utilities ====================

export function pointInTri(px: number, py: number, t: SpikeTri): boolean {
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

export function circleIntersectsTri(cx: number, cy: number, r: number, t: SpikeTri): boolean {
  if (pointInTri(cx, cy, t)) return true;
  const r2 = r * r;
  if (pointSegDistSq(cx, cy, t.ax, t.ay, t.bx, t.by) <= r2) return true;
  if (pointSegDistSq(cx, cy, t.bx, t.by, t.cx, t.cy) <= r2) return true;
  if (pointSegDistSq(cx, cy, t.cx, t.cy, t.ax, t.ay) <= r2) return true;
  return false;
}

export function circleIntersectsRect(
  cx: number,
  cy: number,
  r: number,
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  // rect is top-left (x,y)
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  return dist2(cx, cy, nx, ny) <= r * r;
}

// ==================== Platform Utilities ====================

export function triggerHaptic(
  settings: Settings,
  type: "light" | "medium" | "heavy" | "success" | "error"
): void {
  if (!settings.haptics) return;
  if (typeof (window as any).triggerHaptic === "function") {
    (window as any).triggerHaptic(type);
  }
}

export function submitScore(score: number): void {
  if (typeof (window as any).submitScore === "function") {
    (window as any).submitScore(score);
  }
}

// ==================== Random/Hash Utilities ====================

export function seededRandom(seed: number, index: number): number {
  const x = Math.sin(seed + index * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function hash01(v: number): number {
  const frac = (x: number): number => x - Math.floor(x);
  return frac(Math.sin(v) * 43758.5453123);
}
