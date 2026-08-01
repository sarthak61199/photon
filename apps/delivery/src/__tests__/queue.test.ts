import { beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.fn().mockResolvedValue(undefined);
const createQueue = vi.fn().mockResolvedValue(undefined);
const send = vi.fn().mockResolvedValue(undefined);
const on = vi.fn();

vi.mock("pg-boss", () => ({
  PgBoss: class {
    start = start;
    createQueue = createQueue;
    send = send;
    on = on;
  },
}));

const { enqueueUsageEvents } = await import("../queue");

describe("enqueueUsageEvents", () => {
  beforeEach(() => {
    send.mockClear();
  });

  it("sends a job to the ingest-usage-events queue with serialized timestamps", async () => {
    const occurredAt = new Date("2026-08-02T00:00:00.000Z");
    await enqueueUsageEvents([{ orgId: "acme", kind: "request", quantity: 1, occurredAt }]);

    expect(send).toHaveBeenCalledWith("ingest-usage-events", {
      events: [
        { orgId: "acme", kind: "request", quantity: 1, occurredAt: occurredAt.toISOString() },
      ],
    });
  });
});
