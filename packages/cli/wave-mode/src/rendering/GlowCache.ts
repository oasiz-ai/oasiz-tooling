/**
 * GlowCache - Pre-renders glow effects to offscreen canvases
 * Eliminates expensive shadowBlur by using cached glow sprites
 */

interface GlowSprite {
  canvas: HTMLCanvasElement;
  radius: number;
  blur: number;
}

export class GlowCache {
  private circleGlows: Map<string, GlowSprite> = new Map();
  private ringGlows: Map<string, GlowSprite> = new Map();
  private softGlows: Map<string, GlowSprite> = new Map();
  
  // Performance settings
  private qualityScale = 1.0; // Reduce for mobile/low-end
  private maxCacheSize = 100;
  
  constructor(isMobile: boolean = false) {
    // Lower quality on mobile for better performance
    this.qualityScale = isMobile ? 0.75 : 1.0;
  }

  /**
   * Set quality scale (0.5 = half res, 1.0 = full res)
   */
  setQuality(scale: number): void {
    if (scale !== this.qualityScale) {
      this.qualityScale = scale;
      this.clear(); // Clear cache to regenerate at new quality
    }
  }

  /**
   * Get or create a circular glow sprite
   * Used for: black hole glows, pulsar cores, comet cores
   */
  getCircleGlow(
    radius: number,
    blur: number,
    r: number,
    g: number,
    b: number,
    a: number = 1
  ): HTMLCanvasElement {
    // Round values to reduce cache fragmentation
    const rr = Math.round(radius / 4) * 4;
    const rb = Math.round(blur / 4) * 4;
    const cr = Math.round(r * 255);
    const cg = Math.round(g * 255);
    const cb = Math.round(b * 255);
    const ca = Math.round(a * 100);
    
    const key = `C_${rr}_${rb}_${cr}_${cg}_${cb}_${ca}`;
    
    let sprite = this.circleGlows.get(key);
    if (!sprite) {
      sprite = this.createCircleGlow(rr, rb, cr, cg, cb, ca / 100);
      this.circleGlows.set(key, sprite);
      this.evictIfNeeded(this.circleGlows);
    }
    
    return sprite.canvas;
  }

  /**
   * Get or create a ring glow sprite
   * Used for: accretion disks, orbit rings, pulse rings
   */
  getRingGlow(
    innerRadius: number,
    outerRadius: number,
    blur: number,
    r: number,
    g: number,
    b: number,
    a: number = 1
  ): HTMLCanvasElement {
    const ri = Math.round(innerRadius / 4) * 4;
    const ro = Math.round(outerRadius / 4) * 4;
    const rb = Math.round(blur / 4) * 4;
    const cr = Math.round(r * 255);
    const cg = Math.round(g * 255);
    const cb = Math.round(b * 255);
    const ca = Math.round(a * 100);
    
    const key = `R_${ri}_${ro}_${rb}_${cr}_${cg}_${cb}_${ca}`;
    
    let sprite = this.ringGlows.get(key);
    if (!sprite) {
      sprite = this.createRingGlow(ri, ro, rb, cr, cg, cb, ca / 100);
      this.ringGlows.set(key, sprite);
      this.evictIfNeeded(this.ringGlows);
    }
    
    return sprite.canvas;
  }

  /**
   * Get or create a soft radial gradient glow (no blur needed)
   * Used for: nebula layers, background glows
   */
  getSoftGlow(
    radius: number,
    r: number,
    g: number,
    b: number,
    a: number = 1
  ): HTMLCanvasElement {
    const rr = Math.round(radius / 8) * 8;
    const cr = Math.round(r * 255);
    const cg = Math.round(g * 255);
    const cb = Math.round(b * 255);
    const ca = Math.round(a * 100);
    
    const key = `S_${rr}_${cr}_${cg}_${cb}_${ca}`;
    
    let sprite = this.softGlows.get(key);
    if (!sprite) {
      sprite = this.createSoftGlow(rr, cr, cg, cb, ca / 100);
      this.softGlows.set(key, sprite);
      this.evictIfNeeded(this.softGlows);
    }
    
    return sprite.canvas;
  }

  private createCircleGlow(
    radius: number,
    blur: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): GlowSprite {
    const scale = this.qualityScale;
    const size = Math.ceil((radius + blur * 2) * 2 * scale);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    
    const ctx = canvas.getContext("2d")!;
    const cx = size / 2;
    const cy = size / 2;
    const scaledRadius = radius * scale;
    const scaledBlur = blur * scale;
    
    // Create radial gradient that simulates gaussian blur
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, scaledRadius + scaledBlur);
    const color = `rgba(${r},${g},${b},`;
    
    // Approximate gaussian falloff with gradient stops
    grad.addColorStop(0, color + a + ")");
    grad.addColorStop(scaledRadius / (scaledRadius + scaledBlur) * 0.6, color + (a * 0.8) + ")");
    grad.addColorStop(scaledRadius / (scaledRadius + scaledBlur), color + (a * 0.5) + ")");
    grad.addColorStop(Math.min(1, (scaledRadius + scaledBlur * 0.5) / (scaledRadius + scaledBlur)), color + (a * 0.2) + ")");
    grad.addColorStop(1, color + "0)");
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    
    return { canvas, radius, blur };
  }

  private createRingGlow(
    innerRadius: number,
    outerRadius: number,
    blur: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): GlowSprite {
    const scale = this.qualityScale;
    const size = Math.ceil((outerRadius + blur * 2) * 2 * scale);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    
    const ctx = canvas.getContext("2d")!;
    const cx = size / 2;
    const cy = size / 2;
    const scaledInner = innerRadius * scale;
    const scaledOuter = outerRadius * scale;
    const scaledBlur = blur * scale;
    
    // Draw ring with gradient to simulate blur
    const ringWidth = scaledOuter - scaledInner;
    const midRadius = (scaledInner + scaledOuter) / 2;
    
    const grad = ctx.createRadialGradient(cx, cy, Math.max(0, scaledInner - scaledBlur), cx, cy, scaledOuter + scaledBlur);
    const color = `rgba(${r},${g},${b},`;
    
    grad.addColorStop(0, color + "0)");
    grad.addColorStop(scaledInner / (scaledOuter + scaledBlur), color + (a * 0.3) + ")");
    grad.addColorStop(midRadius / (scaledOuter + scaledBlur), color + a + ")");
    grad.addColorStop(scaledOuter / (scaledOuter + scaledBlur), color + (a * 0.3) + ")");
    grad.addColorStop(1, color + "0)");
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, scaledOuter + scaledBlur, 0, Math.PI * 2);
    ctx.fill();
    
    return { canvas, radius: outerRadius, blur };
  }

  private createSoftGlow(
    radius: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): GlowSprite {
    const scale = this.qualityScale;
    const size = Math.ceil(radius * 2 * scale);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    
    const ctx = canvas.getContext("2d")!;
    const cx = size / 2;
    const cy = size / 2;
    const scaledRadius = radius * scale;
    
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, scaledRadius);
    const color = `rgba(${r},${g},${b},`;
    
    grad.addColorStop(0, color + a + ")");
    grad.addColorStop(0.3, color + (a * 0.6) + ")");
    grad.addColorStop(0.6, color + (a * 0.3) + ")");
    grad.addColorStop(1, color + "0)");
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    
    return { canvas, radius, blur: 0 };
  }

  private evictIfNeeded(cache: Map<string, GlowSprite>): void {
    if (cache.size > this.maxCacheSize) {
      // Remove oldest 25%
      const toRemove = Math.floor(this.maxCacheSize * 0.25);
      const keys = Array.from(cache.keys());
      for (let i = 0; i < toRemove && i < keys.length; i++) {
        cache.delete(keys[i]);
      }
    }
  }

  /**
   * Draw a cached circle glow centered at (x, y)
   */
  drawCircleGlow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    blur: number,
    r: number,
    g: number,
    b: number,
    a: number = 1
  ): void {
    const sprite = this.getCircleGlow(radius, blur, r, g, b, a);
    const size = (radius + blur * 2) * 2;
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  /**
   * Draw a cached ring glow centered at (x, y)
   */
  drawRingGlow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    innerRadius: number,
    outerRadius: number,
    blur: number,
    r: number,
    g: number,
    b: number,
    a: number = 1
  ): void {
    const sprite = this.getRingGlow(innerRadius, outerRadius, blur, r, g, b, a);
    const size = (outerRadius + blur * 2) * 2;
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  /**
   * Draw a cached soft glow centered at (x, y)
   */
  drawSoftGlow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    r: number,
    g: number,
    b: number,
    a: number = 1
  ): void {
    const sprite = this.getSoftGlow(radius, r, g, b, a);
    const size = radius * 2;
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  /**
   * Clear all cached glows
   */
  clear(): void {
    this.circleGlows.clear();
    this.ringGlows.clear();
    this.softGlows.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { circles: number; rings: number; soft: number } {
    return {
      circles: this.circleGlows.size,
      rings: this.ringGlows.size,
      soft: this.softGlows.size,
    };
  }
}

/**
 * Helper to parse rgba color string to components
 */
export function parseColor(color: string): [number, number, number, number] {
  // Handle rgba(r,g,b,a) format
  const rgba = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgba) {
    return [
      parseInt(rgba[1]) / 255,
      parseInt(rgba[2]) / 255,
      parseInt(rgba[3]) / 255,
      rgba[4] ? parseFloat(rgba[4]) : 1,
    ];
  }
  // Default white
  return [1, 1, 1, 1];
}
