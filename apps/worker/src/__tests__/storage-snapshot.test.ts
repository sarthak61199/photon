import type { Asset, DbClient, NewUsageDaily } from "@photon/db";
import { assets, usageDaily } from "@photon/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

let assetStore: Asset[] = [];
let dailyStore: Map<string, NewUsageDaily> = new Map();
let selectShouldThrow = false;

function seedAsset(overrides: Partial<Asset> = {}): Asset {
  const row: Asset = {
    id: `asset_${assetStore.length + 1}`,
    orgId: "org_1",
    publicId: "products/shoe",
    storageKey: "orgs/org_1/orig/x",
    status: "ready",
    mimeType: null,
    bytes: 0,
    width: null,
    height: null,
    checksum: null,
    metadata: {},
    tags: [],
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
  assetStore.push(row);
  return row;
}

function groupReadyAssets(): { orgId: string; totalBytes: string }[] {
  const groups = new Map<string, number>();
  for (const row of assetStore) {
    if (row.status !== "ready" || row.deletedAt) continue;
    groups.set(row.orgId, (groups.get(row.orgId) ?? 0) + (row.bytes ?? 0));
  }
  return [...groups.entries()].map(([orgId, total]) => ({ orgId, totalBytes: String(total) }));
}

const fakeDb: DbClient = {
  db: {
    select: () => ({
      from: (table: unknown) => {
        if (table !== assets) throw new Error("unsupported table");
        return {
          where: () => ({
            groupBy: async () => {
              if (selectShouldThrow) throw new Error("select failed");
              return groupReadyAssets();
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
              dailyStore.set(`${row.orgId}|${row.day}`, row);
            }
          },
        }),
      };
    },
  },
  close: async () => {},
} as unknown as DbClient;

vi.mock("../db", () => ({ getDbClient: () => fakeDb }));

const { storageSnapshot } = await import("../storage-snapshot");

beforeEach(() => {
  assetStore = [];
  dailyStore = new Map();
  selectShouldThrow = false;
});

describe("storageSnapshot", () => {
  it("sums ready, non-deleted asset bytes per org into today's usage_daily.storage", async () => {
    seedAsset({ orgId: "org_1", bytes: 100 });
    seedAsset({ orgId: "org_1", bytes: 200 });
    seedAsset({ orgId: "org_2", bytes: 50 });

    await storageSnapshot();

    const day = new Date().toISOString().slice(0, 10);
    expect(dailyStore.get(`org_1|${day}`)).toMatchObject({ orgId: "org_1", storage: 300 });
    expect(dailyStore.get(`org_2|${day}`)).toMatchObject({ orgId: "org_2", storage: 50 });
  });

  it("excludes non-ready and soft-deleted assets", async () => {
    seedAsset({ orgId: "org_1", bytes: 100, status: "pending" });
    seedAsset({ orgId: "org_1", bytes: 200, status: "ready", deletedAt: new Date() });
    seedAsset({ orgId: "org_1", bytes: 10, status: "ready" });

    await storageSnapshot();

    const day = new Date().toISOString().slice(0, 10);
    expect(dailyStore.get(`org_1|${day}`)).toMatchObject({ storage: 10 });
  });

  it("overwrites rather than accumulates when run twice in the same day", async () => {
    seedAsset({ orgId: "org_1", bytes: 100 });
    await storageSnapshot();

    seedAsset({ orgId: "org_1", bytes: 50 });
    await storageSnapshot();

    const day = new Date().toISOString().slice(0, 10);
    expect(dailyStore.get(`org_1|${day}`)).toMatchObject({ storage: 150 });
  });

  it("is a no-op when there are no ready assets", async () => {
    await storageSnapshot();
    expect(dailyStore.size).toBe(0);
  });

  it("rethrows on aggregation failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    selectShouldThrow = true;

    await expect(storageSnapshot()).rejects.toThrow("select failed");
  });
});
