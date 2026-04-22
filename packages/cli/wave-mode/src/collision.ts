/**
 * Collision detection utilities for Wave Mode
 * Contains obstacle-specific collision checks
 */

import type { Point, Chunk, SpikeTri, SpikeField, Wheel, NebulaCloud, Pulsar, Comet, Block, CollisionInfo } from "./types";
import { CONFIG } from "./config";
import { dist2, circleIntersectsRect, circleIntersectsTri, pointSegDistSq } from "./utils";

/**
 * Check if a circle intersects a polyline (wall path)
 */
export function hitPolyline(
  worldX: number,
  worldY: number,
  r: number,
  path: Point[]
): boolean {
  const r2 = r * r;
  // Only check nearby segments for performance
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (worldX < a.x - 120 || worldX > b.x + 120) continue;
    if (pointSegDistSq(worldX, worldY, a.x, a.y, b.x, b.y) <= r2) return true;
  }
  return false;
}

/**
 * Check collision with a block
 * Hitbox reduced to 85% of visual size (solid core, not the glow effects)
 */
export function collideWithBlock(
  worldX: number,
  worldY: number,
  r: number,
  block: Block
): boolean {
  // Shrink hitbox to 85% of visual size
  const shrink = 0.85;
  const w = block.w * shrink;
  const h = block.h * shrink;
  const x0 = block.x - w * 0.5;
  const y0 = block.y + block.h * (1 - shrink) * 0.5; // Center the smaller hitbox
  return circleIntersectsRect(worldX, worldY, r, x0, y0, w, h);
}

/**
 * Check collision with a spike
 */
export function collideWithSpike(
  worldX: number,
  worldY: number,
  r: number,
  spike: SpikeTri
): boolean {
  return circleIntersectsTri(worldX, worldY, r, spike);
}

/**
 * Check collision with a spike field
 */
export function collideWithSpikeField(
  worldX: number,
  worldY: number,
  r: number,
  sf: SpikeField
): boolean {
  const halfWidth = sf.width * 0.5;
  const minX = sf.x - halfWidth;
  const maxX = sf.x + halfWidth;

  // Quick bounding box check
  if (worldX + r < minX || worldX - r > maxX) return false;

  const baseY = sf.baseY;
  const tipY = sf.isTop ? baseY + sf.height : baseY - sf.height;
  const minY = Math.min(baseY, tipY);
  const maxY = Math.max(baseY, tipY);

  if (worldY + r < minY || worldY - r > maxY) return false;

  // Check if circle center is inside the spike field bounds
  if (worldX >= minX && worldX <= maxX) {
    if (sf.isTop) {
      // Field extends downward from top
      if (worldY - r <= baseY + sf.height * 0.7 && worldY + r >= baseY) return true;
    } else {
      // Field extends upward from bottom
      if (worldY + r >= baseY - sf.height * 0.7 && worldY - r <= baseY) return true;
    }
  }

  return false;
}

/**
 * Check collision with a wheel (black hole)
 * Hitbox reduced to 60% of visual radius (event horizon only, not the glowing accretion disk)
 */
export function collideWithWheel(
  worldX: number,
  worldY: number,
  r: number,
  wheel: Wheel
): boolean {
  const coreRadius = wheel.radius * 0.6; // Only the dark event horizon, not the glow
  return dist2(worldX, worldY, wheel.x, wheel.y) <= (coreRadius + r) * (coreRadius + r);
}

/**
 * Check collision with a nebula cloud
 * Hitbox reduced to 25% of visual size (dense core only, not the glowing aura)
 */
export function collideWithNebula(
  worldX: number,
  worldY: number,
  _r: number,
  nebula: NebulaCloud
): boolean {
  // Use ellipse collision - normalize to circle space
  const dx = worldX - nebula.x;
  const dy = worldY - nebula.y;
  const halfW = nebula.width * 0.25; // Only the dense core, not the glow
  const halfH = nebula.height * 0.25;
  const normalizedDist = (dx * dx) / (halfW * halfW) + (dy * dy) / (halfH * halfH);
  return normalizedDist <= 1;
}

/**
 * Check collision with a pulsar (rotating beam)
 * Hitboxes reduced: smaller core, narrower beam collision
 */
export function collideWithPulsar(
  worldX: number,
  worldY: number,
  r: number,
  pulsar: Pulsar,
  time: number
): boolean {
  // Check distance to center first
  const dx = worldX - pulsar.x;
  const dy = worldY - pulsar.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Core collision - reduced from 12 to 8 (smaller core hitbox)
  if (dist <= 8 + r) return true;

  // Beam collision - check if player is in beam path
  // Use 80% of visual radius for beam reach
  if (dist <= pulsar.radius * 0.8 + r) {
    const currentAngle = pulsar.angle + time * pulsar.speed;
    const playerAngle = Math.atan2(dy, dx);

    // Check both beams (opposite directions)
    for (let beam = 0; beam < 2; beam++) {
      const beamAngle = currentAngle + beam * Math.PI;
      let angleDiff = Math.abs(playerAngle - beamAngle);
      // Normalize to 0-PI range
      while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - Math.PI * 2);

      // Beam width in radians at this distance - use 60% of visual width
      const beamWidthRad = Math.atan2(pulsar.beamWidth * 0.3 + r, dist);
      if (angleDiff <= beamWidthRad) return true;
    }
  }

  return false;
}

/**
 * Check collision with a comet
 * Hitbox reduced to 70% of visual size (solid core only, not the glowing tail/aura)
 */
export function collideWithComet(
  worldX: number,
  worldY: number,
  r: number,
  comet: Comet
): boolean {
  const dx = worldX - comet.x;
  const dy = worldY - comet.y;
  const collisionRadius = comet.size * 0.7 + r; // Core only, not the glow
  return dx * dx + dy * dy <= collisionRadius * collisionRadius;
}

/**
 * Check collision with all obstacles in a chunk
 * @param chunk - The chunk to check
 * @param worldX - Player world X position
 * @param worldY - Player world Y position
 * @param time - Current time (for animated obstacles like pulsars)
 * @returns true if collision detected
 */
export function checkChunkCollision(
  chunk: Chunk,
  worldX: number,
  worldY: number,
  time: number
): boolean {
  const r = CONFIG.WAVE_SIZE * 0.55;

  // Walls (top & bottom polylines) are lethal
  if (hitPolyline(worldX, worldY, r, chunk.top)) return true;
  if (hitPolyline(worldX, worldY, r, chunk.bottom)) return true;

  // Blocks
  for (const b of chunk.blocks) {
    if (collideWithBlock(worldX, worldY, r, b)) return true;
  }

  // Spikes
  for (const s of chunk.spikes) {
    if (collideWithSpike(worldX, worldY, r, s)) return true;
  }

  // Spike fields
  for (const sf of chunk.spikeFields) {
    if (collideWithSpikeField(worldX, worldY, r, sf)) return true;
  }

  // Wheels (black holes)
  for (const w of chunk.wheels) {
    if (collideWithWheel(worldX, worldY, r, w)) return true;
  }

  // Nebula clouds
  for (const n of chunk.nebulas) {
    if (collideWithNebula(worldX, worldY, r, n)) return true;
  }

  // Pulsars
  for (const p of chunk.pulsars) {
    if (collideWithPulsar(worldX, worldY, r, p, time)) return true;
  }

  // Comets
  for (const c of chunk.comets) {
    if (collideWithComet(worldX, worldY, r, c)) return true;
  }

  return false;
}

/**
 * Find the visual impact point when a collision occurs.
 * This extends from the player position to the obstacle's visual boundary
 * (not the hitbox), making death more visually clear.
 */
export function findCollisionImpactPoint(
  chunk: Chunk,
  worldX: number,
  worldY: number,
  time: number
): CollisionInfo | null {
  const r = CONFIG.WAVE_SIZE * 0.55;

  // Check walls - find nearest point on wall
  for (const path of [chunk.top, chunk.bottom]) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (worldX < a.x - 120 || worldX > b.x + 120) continue;
      const dsq = pointSegDistSq(worldX, worldY, a.x, a.y, b.x, b.y);
      if (dsq <= r * r) {
        // Find closest point on segment
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((worldX - a.x) * dx + (worldY - a.y) * dy) / len2)) : 0;
        return {
          type: "wall",
          impactX: a.x + t * dx,
          impactY: a.y + t * dy
        };
      }
    }
  }

  // Check blocks - find nearest point on visual boundary
  for (const b of chunk.blocks) {
    if (collideWithBlock(worldX, worldY, r, b)) {
      // Use full visual size (not hitbox) for impact point
      const halfW = b.w * 0.5;
      const halfH = b.h * 0.5;
      const cx = b.x;
      const cy = b.y + halfH;
      
      // Find closest point on block rectangle boundary
      const dx = worldX - cx;
      const dy = worldY - cy;
      const clampedX = Math.max(-halfW, Math.min(halfW, dx));
      const clampedY = Math.max(-halfH, Math.min(halfH, dy));
      
      return {
        type: "block",
        impactX: cx + clampedX,
        impactY: cy + clampedY
      };
    }
  }

  // Check spikes - find centroid of spike triangle
  for (const s of chunk.spikes) {
    if (collideWithSpike(worldX, worldY, r, s)) {
      // Impact at the tip of the spike (closest point to center)
      const tipX = (s.ax + s.bx + s.cx) / 3;
      const tipY = Math.min(s.ay, s.by, s.cy); // Top spike tip or
      const baseY = Math.max(s.ay, s.by, s.cy);
      // Choose tip closer to player
      const impactY = Math.abs(worldY - tipY) < Math.abs(worldY - baseY) ? tipY : baseY;
      return {
        type: "spike",
        impactX: (s.ax + s.bx + s.cx) / 3,
        impactY: impactY
      };
    }
  }

  // Check spike fields
  for (const sf of chunk.spikeFields) {
    if (collideWithSpikeField(worldX, worldY, r, sf)) {
      // Impact at the tip of spike field
      const tipY = sf.isTop ? sf.baseY + sf.height : sf.baseY - sf.height;
      return {
        type: "spikeField",
        impactX: sf.x,
        impactY: tipY
      };
    }
  }

  // Check wheels (black holes) - find point on visual edge
  for (const w of chunk.wheels) {
    if (collideWithWheel(worldX, worldY, r, w)) {
      const dx = worldX - w.x;
      const dy = worldY - w.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Use full visual radius for impact point
      const visualRadius = w.radius;
      const nx = dist > 0 ? dx / dist : 1;
      const ny = dist > 0 ? dy / dist : 0;
      return {
        type: "wheel",
        impactX: w.x + nx * visualRadius,
        impactY: w.y + ny * visualRadius
      };
    }
  }

  // Check nebulas - find point on visual ellipse edge
  for (const n of chunk.nebulas) {
    if (collideWithNebula(worldX, worldY, r, n)) {
      const dx = worldX - n.x;
      const dy = worldY - n.y;
      const angle = Math.atan2(dy, dx);
      // Use 40% of visual size (the main visible body, not the outer glow)
      const visualHalfW = n.width * 0.4;
      const visualHalfH = n.height * 0.4;
      return {
        type: "nebula",
        impactX: n.x + Math.cos(angle) * visualHalfW,
        impactY: n.y + Math.sin(angle) * visualHalfH
      };
    }
  }

  // Check pulsars
  for (const p of chunk.pulsars) {
    if (collideWithPulsar(worldX, worldY, r, p, time)) {
      const dx = worldX - p.x;
      const dy = worldY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // If close to core, impact at core edge
      if (dist <= 15 + r) {
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        return {
          type: "pulsar",
          impactX: p.x + nx * 15,
          impactY: p.y + ny * 15
        };
      }
      
      // Otherwise impact at beam - project to nearest beam line
      const currentAngle = p.angle + time * p.speed;
      const playerAngle = Math.atan2(dy, dx);
      
      // Find which beam we hit
      for (let beam = 0; beam < 2; beam++) {
        const beamAngle = currentAngle + beam * Math.PI;
        let angleDiff = Math.abs(playerAngle - beamAngle);
        while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - Math.PI * 2);
        
        if (angleDiff <= Math.PI / 8) {
          // Project player position onto beam line
          const beamDirX = Math.cos(beamAngle);
          const beamDirY = Math.sin(beamAngle);
          const proj = dx * beamDirX + dy * beamDirY;
          return {
            type: "pulsar",
            impactX: p.x + beamDirX * proj,
            impactY: p.y + beamDirY * proj
          };
        }
      }
      
      // Fallback to center
      return {
        type: "pulsar",
        impactX: p.x,
        impactY: p.y
      };
    }
  }

  // Check comets - find point on visual edge
  for (const c of chunk.comets) {
    if (collideWithComet(worldX, worldY, r, c)) {
      const dx = worldX - c.x;
      const dy = worldY - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Use full visual size for impact
      const visualRadius = c.size;
      const nx = dist > 0 ? dx / dist : 1;
      const ny = dist > 0 ? dy / dist : 0;
      return {
        type: "comet",
        impactX: c.x + nx * visualRadius,
        impactY: c.y + ny * visualRadius
      };
    }
  }

  return null;
}
