import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drainUsageBuffer, recordRequestUsage, recordUsage, startUsageFlush } from "../usage";

describe("recordUsage / recordRequestUsage / drainUsageBuffer", () => {
  beforeEach(() => {
    drainUsageBuffer();
  });

  it("records a single event with an occurredAt timestamp", () => {
    recordUsage({ orgId: "acme", kind: "request", quantity: 1 });
    const drained = drainUsageBuffer();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({ orgId: "acme", kind: "request", quantity: 1 });
    expect(drained[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it("records request+bandwidth for a cache hit (not transformed)", () => {
    recordRequestUsage("acme", { transformed: false, bytes: 1234 });
    const drained = drainUsageBuffer();
    expect(drained.map((e) => e.kind)).toEqual(["request", "bandwidth"]);
    expect(drained.find((e) => e.kind === "bandwidth")?.quantity).toBe(1234);
  });

  it("records request+transform+bandwidth for a cache miss (transformed)", () => {
    recordRequestUsage("acme", { transformed: true, bytes: 5678 });
    const drained = drainUsageBuffer();
    expect(drained.map((e) => e.kind)).toEqual(["request", "transform", "bandwidth"]);
    expect(drained.find((e) => e.kind === "bandwidth")?.quantity).toBe(5678);
  });

  it("drains and clears the buffer (swap semantics)", () => {
    recordUsage({ orgId: "acme", kind: "request", quantity: 1 });
    const first = drainUsageBuffer();
    expect(first).toHaveLength(1);
    const second = drainUsageBuffer();
    expect(second).toHaveLength(0);
  });
});

describe("startUsageFlush", () => {
  beforeEach(() => {
    drainUsageBuffer();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("flushes the buffer on the interval", async () => {
    const sendBatch = vi.fn().mockResolvedValue(undefined);
    const stop = startUsageFlush(sendBatch, { intervalMs: 5000 });

    recordUsage({ orgId: "acme", kind: "request", quantity: 1 });
    await vi.advanceTimersByTimeAsync(5000);

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch).toHaveBeenCalledWith([expect.objectContaining({ orgId: "acme" })]);

    await stop();
  });

  it("does not call sendBatch when the buffer is empty", async () => {
    const sendBatch = vi.fn().mockResolvedValue(undefined);
    const stop = startUsageFlush(sendBatch, { intervalMs: 5000 });

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendBatch).not.toHaveBeenCalled();

    await stop();
  });

  it("stop() clears the interval and flushes any remaining buffer", async () => {
    const sendBatch = vi.fn().mockResolvedValue(undefined);
    const stop = startUsageFlush(sendBatch, { intervalMs: 5000 });

    recordUsage({ orgId: "acme", kind: "request", quantity: 1 });
    await stop();
    expect(sendBatch).toHaveBeenCalledTimes(1);

    sendBatch.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("swallows and logs sendBatch failures without throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const sendBatch = vi.fn().mockRejectedValue(new Error("queue down"));
    const stop = startUsageFlush(sendBatch, { intervalMs: 5000 });

    recordUsage({ orgId: "acme", kind: "request", quantity: 1 });
    await vi.advanceTimersByTimeAsync(5000);

    expect(consoleError).toHaveBeenCalled();
    await stop();
  });
});
