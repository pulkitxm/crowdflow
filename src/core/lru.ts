export class LruSet<T> {
  private readonly values = new Map<T, true>();

  constructor(private readonly capacity = 512) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('LRU capacity must be a positive integer');
    }
  }

  /** Returns true if already present. New values are recorded. */
  seenOrAdd(value: T): boolean {
    if (this.values.has(value)) {
      this.values.delete(value);
      this.values.set(value, true);
      return true;
    }
    this.values.set(value, true);
    if (this.values.size > this.capacity) {
      const eldest = this.values.keys().next().value as T | undefined;
      if (eldest !== undefined) this.values.delete(eldest);
    }
    return false;
  }

  clear(): void {
    this.values.clear();
  }

  get size(): number {
    return this.values.size;
  }
}
