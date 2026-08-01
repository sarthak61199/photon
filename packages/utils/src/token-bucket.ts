export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
}

interface BucketState {
  tokens: number;
  lastRefillAt: number;
}

// In-memory, per-process token bucket keyed by an arbitrary string (org id,
// API key id, ...). Per design doc §8/§9: fine for a single instance; a
// multi-instance deployment would need this backed by Redis/PG instead.
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly buckets = new Map<string, BucketState>();

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
  }

  private refill(state: BucketState): void {
    const now = Date.now();
    const elapsedSeconds = (now - state.lastRefillAt) / 1000;
    if (elapsedSeconds <= 0) return;
    state.tokens = Math.min(this.capacity, state.tokens + elapsedSeconds * this.refillPerSecond);
    state.lastRefillAt = now;
  }

  tryConsume(key: string, cost = 1): boolean {
    let state = this.buckets.get(key);
    if (!state) {
      state = { tokens: this.capacity, lastRefillAt: Date.now() };
      this.buckets.set(key, state);
    }
    this.refill(state);
    if (state.tokens < cost) return false;
    state.tokens -= cost;
    return true;
  }
}
