import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenBucket } from "../token-bucket";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TokenBucket", () => {
  it("allows consumption up to capacity", () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1 });
    expect(bucket.tryConsume("org_1")).toBe(true);
    expect(bucket.tryConsume("org_1")).toBe(true);
    expect(bucket.tryConsume("org_1")).toBe(true);
  });

  it("rejects once capacity is exhausted", () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 1 });
    bucket.tryConsume("org_1");
    bucket.tryConsume("org_1");
    expect(bucket.tryConsume("org_1")).toBe(false);
  });

  it("tracks separate buckets per key", () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1 });
    expect(bucket.tryConsume("org_1")).toBe(true);
    expect(bucket.tryConsume("org_1")).toBe(false);
    expect(bucket.tryConsume("org_2")).toBe(true);
  });

  it("refills over time up to capacity", () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 1 });
    bucket.tryConsume("org_1");
    bucket.tryConsume("org_1");
    expect(bucket.tryConsume("org_1")).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(bucket.tryConsume("org_1")).toBe(true);
    expect(bucket.tryConsume("org_1")).toBe(false);
  });

  it("never refills past capacity", () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 100 });
    bucket.tryConsume("org_1");
    vi.advanceTimersByTime(10_000);
    expect(bucket.tryConsume("org_1")).toBe(true);
    expect(bucket.tryConsume("org_1")).toBe(true);
    expect(bucket.tryConsume("org_1")).toBe(false);
  });

  it("supports a custom cost per consumption", () => {
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 1 });
    expect(bucket.tryConsume("org_1", 7)).toBe(true);
    expect(bucket.tryConsume("org_1", 4)).toBe(false);
    expect(bucket.tryConsume("org_1", 3)).toBe(true);
  });
});
