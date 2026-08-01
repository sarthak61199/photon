import type { DbClient, NewUsageDaily, UsageEvent } from "@photon/db";
import { usageDaily, usageEvents } from "@photon/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

let eventStore: UsageEvent[] = [];
let dailyStore: Map<string, NewUsageDaily> = new Map();
let nextId = 1;
let selectShouldThrow = false;

function seedEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  const row: UsageEvent = {
    id: nextId++,
    orgId: "org_1",
    kind: "request",
    quantity: 1,
    occurredAt: new Date(),
    ...overrides,
  };
  eventStore.push(row);
  return row;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function groupUsageEvents(cutoff: Date) {
  const groups = new Map<string, { orgId: string; day: string; kind: string; total: number }>();
  for (const row of eventStore) {
    if (row.occurredAt >= cutoff) continue;
    const day = dayKey(row.occurredAt);
    const key = `${row.orgId}|${day}|${row.kind}`;
    const entry = groups.get(key) ?? { orgId: row.orgId, day, kind: row.kind, total: 0 };
    entry.total += row.quantity;
    groups.set(key, entry);
  }
  return [...groups.values()].map((g) => ({ ...g, total: String(g.total) }));
}

const fakeDb: DbClient = {
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table !== usageEvents) throw new Error("unsupported table");
        return {
          where: () => ({
            groupBy: async () => {
              if (selectShouldThrow) throw new Error("select failed");
              // cutoff is captured by the caller via `where(lt(occurredAt, cutoff))`;
              // this fake ignores the drizzle expression and re-derives cutoff as "now"
              // at call time, which is close enough since tests seed fixed timestamps.
              return groupUsageEvents(new Date());
            },
          }),
        };
      },
    }),
    insert: (table: unknown) => {
      if (table !== usageDaily) throw new Error("unsupported table");
      return {
        values: (rows: NewUsageDaily[]) => ({
          onConflictDoUpdate: async () => {
            for (const row of rows) {
              const key = `${row.orgId}|${row.day}`;
              const existing = dailyStore.get(key);
              if (existing) {
                dailyStore.set(key, {
                  orgId: row.orgId,
                  day: row.day,
                  requests: Number(existing.requests ?? 0) + Number(row.requests ?? 0),
                  transforms: Number(existing.transforms ?? 0) + Number(row.transforms ?? 0),
                  bandwidth: Number(existing.bandwidth ?? 0) + Number(row.bandwidth ?? 0),
                });
              } else {
                dailyStore.set(key, row);
              }
            }
          },
        }),
      };
    },
    delete: (table: unknown) => {
      if (table !== usageEvents) throw new Error("unsupported table");
      return {
        where: async () => {
          eventStore = [];
        },
      };
    },
  },
  close: async () => {},
} as unknown as DbClient;

vi.mock("../db", () => ({ getDbClient: () => fakeDb }));

const { rollupUsage } = await import("../rollup-usage");

beforeEach(() => {
  eventStore = [];
  dailyStore = new Map();
  nextId = 1;
  selectShouldThrow = false;
});

describe("rollupUsage", () => {
  it("aggregates multi-org, multi-kind events into usage_daily", async () => {
    const day = new Date("2026-08-01T12:00:00.000Z");
    seedEvent({ orgId: "org_1", kind: "request", quantity: 1, occurredAt: day });
    seedEvent({ orgId: "org_1", kind: "request", quantity: 1, occurredAt: day });
    seedEvent({ orgId: "org_1", kind: "transform", quantity: 1, occurredAt: day });
    seedEvent({ orgId: "org_1", kind: "bandwidth", quantity: 500, occurredAt: day });
    seedEvent({ orgId: "org_2", kind: "request", quantity: 1, occurredAt: day });

    await rollupUsage();

    const org1 = dailyStore.get("org_1|2026-08-01");
    expect(org1).toMatchObject({ requests: 2, transforms: 1, bandwidth: 500 });
    const org2 = dailyStore.get("org_2|2026-08-01");
    expect(org2).toMatchObject({ requests: 1, transforms: 0, bandwidth: 0 });
    expect(eventStore).toHaveLength(0);
  });

  it("is idempotent across repeated runs with no new events", async () => {
    const day = new Date("2026-08-01T12:00:00.000Z");
    seedEvent({ orgId: "org_1", kind: "request", quantity: 3, occurredAt: day });

    await rollupUsage();
    const afterFirst = dailyStore.get("org_1|2026-08-01");
    await rollupUsage();
    const afterSecond = dailyStore.get("org_1|2026-08-01");

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond?.requests).toBe(3);
  });

  it("leaves events untouched when aggregation fails, and rethrows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    seedEvent({ orgId: "org_1", kind: "request", quantity: 1, occurredAt: new Date() });
    selectShouldThrow = true;

    await expect(rollupUsage()).rejects.toThrow("select failed");
    expect(eventStore).toHaveLength(1);
    expect(dailyStore.size).toBe(0);
  });
});
