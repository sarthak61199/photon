export interface TtlLruCacheOptions {
  maxEntries: number;
  ttlMs: number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

// Backed by a plain Map: insertion order doubles as recency order, so
// re-inserting a key on access/update is enough to implement LRU without a
// separate linked list.
export class TtlLruCache<K, V> {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly store = new Map<K, CacheEntry<V>>();

  constructor(options: TtlLruCacheOptions) {
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    if (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as K;
      this.store.delete(oldestKey);
    }
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }
}
