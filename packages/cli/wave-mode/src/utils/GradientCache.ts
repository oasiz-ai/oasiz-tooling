/**
 * GradientCache - Caches canvas gradients to avoid recreation overhead
 * Gradients are cached by rounded coordinates and palette version
 */

export class GradientCache {
  private cache: Map<string, CanvasGradient> = new Map();
  private paletteVersion = 0;
  private ctx: CanvasRenderingContext2D;
  private maxCacheSize = 200;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  /**
   * Invalidate cache when palette changes or on major state changes
   */
  invalidate(): void {
    this.paletteVersion++;
    this.cache.clear();
  }

  /**
   * Clear cache to free memory (call on game reset)
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get or create a linear gradient
   * Coordinates are rounded to reduce cache fragmentation
   */
  getLinear(
    key: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    stops: [number, string][]
  ): CanvasGradient {
    // Round coordinates to nearest 2 pixels to reduce unique keys
    const rx0 = Math.round(x0 / 2) * 2;
    const ry0 = Math.round(y0 / 2) * 2;
    const rx1 = Math.round(x1 / 2) * 2;
    const ry1 = Math.round(y1 / 2) * 2;

    const cacheKey = `L_${key}_${this.paletteVersion}_${rx0}_${ry0}_${rx1}_${ry1}`;
    let grad = this.cache.get(cacheKey);

    if (!grad) {
      // Evict old entries if cache is too large
      if (this.cache.size >= this.maxCacheSize) {
        this.evictOldest();
      }

      grad = this.ctx.createLinearGradient(x0, y0, x1, y1);
      for (const [offset, color] of stops) {
        try {
          grad.addColorStop(offset, color);
        } catch {
          // Invalid color, skip
        }
      }
      this.cache.set(cacheKey, grad);
    }

    return grad;
  }

  /**
   * Get or create a radial gradient
   * Coordinates and radii are rounded to reduce cache fragmentation
   */
  getRadial(
    key: string,
    x: number,
    y: number,
    r0: number,
    r1: number,
    stops: [number, string][]
  ): CanvasGradient {
    // Round coordinates and radii
    const rx = Math.round(x / 2) * 2;
    const ry = Math.round(y / 2) * 2;
    const rr0 = Math.round(r0);
    const rr1 = Math.round(r1);

    const cacheKey = `R_${key}_${this.paletteVersion}_${rx}_${ry}_${rr0}_${rr1}`;
    let grad = this.cache.get(cacheKey);

    if (!grad) {
      // Evict old entries if cache is too large
      if (this.cache.size >= this.maxCacheSize) {
        this.evictOldest();
      }

      grad = this.ctx.createRadialGradient(x, y, r0, x, y, r1);
      for (const [offset, color] of stops) {
        try {
          grad.addColorStop(offset, color);
        } catch {
          // Invalid color, skip
        }
      }
      this.cache.set(cacheKey, grad);
    }

    return grad;
  }

  /**
   * Get or create a radial gradient with offset center
   */
  getRadialOffset(
    key: string,
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
    stops: [number, string][]
  ): CanvasGradient {
    const rx0 = Math.round(x0 / 2) * 2;
    const ry0 = Math.round(y0 / 2) * 2;
    const rx1 = Math.round(x1 / 2) * 2;
    const ry1 = Math.round(y1 / 2) * 2;
    const rr0 = Math.round(r0);
    const rr1 = Math.round(r1);

    const cacheKey = `RO_${key}_${this.paletteVersion}_${rx0}_${ry0}_${rr0}_${rx1}_${ry1}_${rr1}`;
    let grad = this.cache.get(cacheKey);

    if (!grad) {
      if (this.cache.size >= this.maxCacheSize) {
        this.evictOldest();
      }

      grad = this.ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
      for (const [offset, color] of stops) {
        try {
          grad.addColorStop(offset, color);
        } catch {
          // Invalid color, skip
        }
      }
      this.cache.set(cacheKey, grad);
    }

    return grad;
  }

  /**
   * Evict the oldest entries from the cache
   */
  private evictOldest(): void {
    // Remove 25% of entries when cache is full
    const toRemove = Math.floor(this.maxCacheSize * 0.25);
    const keys = Array.from(this.cache.keys());
    for (let i = 0; i < toRemove && i < keys.length; i++) {
      this.cache.delete(keys[i]);
    }
  }

  /**
   * Get current cache statistics
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
    };
  }
}
