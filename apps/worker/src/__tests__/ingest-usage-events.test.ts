import type { DbClient, NewUsageEvent } from "@photon/db";
import { usageEvents } from "@photon/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertedRows: NewUsageEvent[] = [];

const fakeDb: DbClient = {
  db: {
    insert: (table: unknown) => {
      if (table !== usageEvents) throw new Error("unsupported table");
      return {
        values: async (rows: NewUsageEvent[]) => {
          insertedRows.push(...rows);
        },
      };
    },
  },
  close: async () => {},
} as unknown as DbClient;

vi.mock("../db", () => ({ getDbClient: () => fakeDb }));

const { ingestUsageEvents } = await import("../ingest-usage-events");

beforeEach(() => {
  insertedRows.length = 0;
});

describe("ingestUsageEvents", () => {
  it("inserts events with occurredAt parsed back to a Date", async () => {
    const occurredAt = "2026-08-02T10:00:00.000Z";
    await ingestUsageEvents({
      data: {
        events: [
          { orgId: "org_1", kind: "request", quantity: 1, occurredAt },
          { orgId: "org_1", kind: "bandwidth", quantity: 2048, occurredAt },
        ],
      },
    });

    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0]).toEqual({
      orgId: "org_1",
      kind: "request",
      quantity: 1,
      occurredAt: new Date(occurredAt),
    });
    expect(insertedRows[1]?.occurredAt).toBeInstanceOf(Date);
  });

  it("logs and rethrows when the insert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failingDb: DbClient = {
      db: {
        insert: () => ({
          values: async () => {
            throw new Error("db down");
          },
        }),
      },
      close: async () => {},
    } as unknown as DbClient;

    vi.resetModules();
    vi.doMock("../db", () => ({ getDbClient: () => failingDb }));
    const { ingestUsageEvents: ingestWithFailingDb } = await import("../ingest-usage-events");

    await expect(
      ingestWithFailingDb({
        data: {
          events: [
            {
              orgId: "org_1",
              kind: "request",
              quantity: 1,
              occurredAt: "2026-08-02T00:00:00.000Z",
            },
          ],
        },
      }),
    ).rejects.toThrow("db down");
  });
});
