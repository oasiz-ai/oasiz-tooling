/**
 * CircularBuffer - Fixed-size buffer that overwrites oldest entries
 * Avoids array shift/unshift which are O(n) operations
 */

export class CircularBuffer<T> {
  private buffer: (T | null)[];
  private head = 0; // Index of oldest element
  private tail = 0; // Index of next write position
  private _size = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity).fill(null);
  }

  get size(): number {
    return this._size;
  }

  get length(): number {
    return this._size;
  }

  /**
   * Add an item to the buffer
   * If full, overwrites the oldest item
   */
  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;

    if (this._size < this.capacity) {
      this._size++;
    } else {
      // Buffer is full, move head forward (overwrite oldest)
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * Get item at index (0 = oldest, size-1 = newest)
   */
  get(index: number): T | null {
    if (index < 0 || index >= this._size) return null;
    return this.buffer[(this.head + index) % this.capacity];
  }

  /**
   * Get the oldest item without removing it
   */
  peekFirst(): T | null {
    if (this._size === 0) return null;
    return this.buffer[this.head];
  }

  /**
   * Get the newest item without removing it
   */
  peekLast(): T | null {
    if (this._size === 0) return null;
    const lastIndex = (this.tail - 1 + this.capacity) % this.capacity;
    return this.buffer[lastIndex];
  }

  /**
   * Remove and return the oldest item
   */
  shift(): T | null {
    if (this._size === 0) return null;
    const item = this.buffer[this.head];
    this.buffer[this.head] = null;
    this.head = (this.head + 1) % this.capacity;
    this._size--;
    return item;
  }

  /**
   * Iterate over all items from oldest to newest
   */
  forEach(fn: (item: T, index: number) => void): void {
    for (let i = 0; i < this._size; i++) {
      const item = this.buffer[(this.head + i) % this.capacity];
      if (item !== null) {
        fn(item, i);
      }
    }
  }

  /**
   * Map over all items
   */
  map<U>(fn: (item: T, index: number) => U): U[] {
    const result: U[] = [];
    for (let i = 0; i < this._size; i++) {
      const item = this.buffer[(this.head + i) % this.capacity];
      if (item !== null) {
        result.push(fn(item, i));
      }
    }
    return result;
  }

  /**
   * Filter items
   */
  filter(fn: (item: T) => boolean): T[] {
    const result: T[] = [];
    for (let i = 0; i < this._size; i++) {
      const item = this.buffer[(this.head + i) % this.capacity];
      if (item !== null && fn(item)) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Clear all items from the buffer
   */
  clear(): void {
    this.buffer.fill(null);
    this._size = 0;
    this.head = 0;
    this.tail = 0;
  }

  /**
   * Convert to array (oldest to newest)
   */
  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this._size; i++) {
      const item = this.buffer[(this.head + i) % this.capacity];
      if (item !== null) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Check if condition holds for first item
   * Used for pruning: while (buffer.size > 0 && condition(buffer.peekFirst())) buffer.shift()
   */
  removeWhile(condition: (item: T) => boolean): void {
    while (this._size > 0) {
      const item = this.buffer[this.head];
      if (item === null || !condition(item)) break;
      this.buffer[this.head] = null;
      this.head = (this.head + 1) % this.capacity;
      this._size--;
    }
  }
}
