/**
 * ObjectPool - Generic object pool to reduce GC pressure
 * Objects are reused instead of being created and destroyed
 */

export class ObjectPool<T> {
  private pool: T[] = [];
  private activeCount = 0;

  constructor(
    private factory: () => T,
    private reset: (obj: T) => void,
    initialSize = 50
  ) {
    // Pre-allocate initial pool
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }

  /**
   * Get an object from the pool
   * Creates a new one if pool is exhausted
   */
  acquire(): T {
    if (this.activeCount >= this.pool.length) {
      // Grow pool by 50%
      const growBy = Math.max(10, Math.floor(this.pool.length * 0.5));
      for (let i = 0; i < growBy; i++) {
        this.pool.push(this.factory());
      }
    }
    return this.pool[this.activeCount++];
  }

  /**
   * Return an object to the pool
   */
  release(obj: T): void {
    this.reset(obj);
    const idx = this.pool.indexOf(obj);
    if (idx >= 0 && idx < this.activeCount) {
      // Swap with last active and decrement
      [this.pool[idx], this.pool[this.activeCount - 1]] = [
        this.pool[this.activeCount - 1],
        this.pool[idx],
      ];
      this.activeCount--;
    }
  }

  /**
   * Release all objects back to the pool
   */
  releaseAll(): void {
    for (let i = 0; i < this.activeCount; i++) {
      this.reset(this.pool[i]);
    }
    this.activeCount = 0;
  }

  /**
   * Get current pool statistics
   */
  getStats(): { active: number; total: number } {
    return {
      active: this.activeCount,
      total: this.pool.length,
    };
  }
}

/**
 * ArrayPool - Pool of reusable arrays to avoid allocation
 */
export class ArrayPool<T> {
  private pools: Map<number, T[][]> = new Map();

  /**
   * Get a cleared array of approximately the given capacity
   */
  acquire(capacity: number = 32): T[] {
    // Round up to power of 2 for better pooling
    const size = Math.pow(2, Math.ceil(Math.log2(Math.max(8, capacity))));
    
    let pool = this.pools.get(size);
    if (!pool) {
      pool = [];
      this.pools.set(size, pool);
    }

    if (pool.length > 0) {
      return pool.pop()!;
    }

    return new Array<T>(size);
  }

  /**
   * Return an array to the pool
   */
  release(arr: T[]): void {
    arr.length = 0;
    const size = arr.length || 32;
    const poolSize = Math.pow(2, Math.ceil(Math.log2(Math.max(8, size))));
    
    let pool = this.pools.get(poolSize);
    if (!pool) {
      pool = [];
      this.pools.set(poolSize, pool);
    }

    // Limit pool size to avoid memory bloat
    if (pool.length < 20) {
      pool.push(arr);
    }
  }

  /**
   * Clear all pools
   */
  clear(): void {
    this.pools.clear();
  }
}
