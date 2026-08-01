import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlLruCache } from "../ttl-lru-cache";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TtlLruCache", () => {
  it("returns undefined for a missing key", () => {
    const cache = new TtlLruCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns a value that was set", () => {
    const cache = new TtlLruCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("expires entries after ttlMs", () => {
    const cache = new TtlLruCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
    cache.set("a", 1);

    vi.advanceTimersByTime(999);
    expect(cache.get("a")).toBe(1);

    vi.advanceTimersByTime(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the least-recently-used entry once over capacity", () => {
    const cache = new TtlLruCache<string, number>({ maxEntries: 2, ttlMs: 1000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("treats a get() as touching recency", () => {
    const cache = new TtlLruCache<string, number>({ maxEntries: 2, ttlMs: 1000 });
    cache.set("a", 1);
    cache.set("b", 2);

    cache.get("a"); // "a" is now more recent than "b"
    cache.set("c", 3); // should evict "b", not "a"

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("deletes a key on demand", () => {
    const cache = new TtlLruCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
    cache.set("a", 1);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
  });

  it("refreshes the TTL when a key is overwritten", () => {
    const cache = new TtlLruCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
    cache.set("a", 1);
    vi.advanceTimersByTime(999);
    cache.set("a", 2);
    vi.advanceTimersByTime(999);
    expect(cache.get("a")).toBe(2);
  });
});
