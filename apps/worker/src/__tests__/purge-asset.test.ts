import type { Asset, DbClient, Derivative } from "@photon/db";
import { derivatives } from "@photon/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const assetsStore = new Map<string, Asset>();
const derivativesStore = new Map<string, Derivative>();
const storageDelete = vi.fn().mockResolvedValue(undefined);

function baseAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset_1",
    orgId: "org_1",
    publicId: "products/shoe",
    storageKey: "orgs/org_1/orig/asset_1",
    status: "ready",
    mimeType: "image/jpeg",
    bytes: 1234,
    width: 100,
    height: 100,
    checksum: "abc",
    metadata: {},
    tags: [],
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function baseDerivative(overrides: Partial<Derivative> = {}): Derivative {
  return {
    id: overrides.id ?? `deriv_${derivativesStore.size + 1}`,
    assetId: "asset_1",
    transformKey: "w_10.jpg",
    storageKey: "orgs/org_1/deriv/asset_1/w_10.jpg",
    bytes: 100,
    createdAt: new Date(),
    ...overrides,
  };
}

type Ops = {
  eq: (field: unknown, val: unknown) => (row: never) => boolean;
};

function makeOps(): Ops {
  return {
    eq: (field, val) => (row) => (row as never)[field as string] === val,
  };
}

const fieldProxy = new Proxy({}, { get: (_t, prop) => prop });

const fakeDb: DbClient = {
  db: {
    query: {
      assets: {
        findFirst: async ({
          where,
        }: {
          where: (a: unknown, ops: Ops) => (row: never) => boolean;
        }) => {
          const predicate = where(fieldProxy, makeOps());
          return [...assetsStore.values()].find(predicate as never);
        },
      },
      derivatives: {
        findMany: async ({
          where,
        }: {
          where: (d: unknown, ops: Ops) => (row: never) => boolean;
        }) => {
          const predicate = where(fieldProxy, makeOps());
          return [...derivativesStore.values()].filter(predicate as never);
        },
      },
    },
    delete: (table: unknown) => {
      if (table !== derivatives) throw new Error("unsupported table");
      return {
        where: async () => {
          // Only ever called as eq(derivatives.assetId, assetId) in purge-asset.ts.
          for (const [id, row] of derivativesStore) {
            if (row.assetId === [...assetsStore.values()][0]?.id) derivativesStore.delete(id);
          }
        },
      };
    },
  },
  close: async () => {},
} as unknown as DbClient;

vi.mock("../db", () => ({ getDbClient: () => fakeDb }));
vi.mock("../storage", () => ({ getStorageClient: () => ({ delete: storageDelete }) }));

const { purgeAsset } = await import("../purge-asset");

beforeEach(() => {
  assetsStore.clear();
  derivativesStore.clear();
  storageDelete.mockClear();
  storageDelete.mockResolvedValue(undefined);
});

describe("purgeAsset", () => {
  it("deletes the original and all derivative storage objects, then the derivatives rows", async () => {
    const asset = baseAsset();
    assetsStore.set(asset.id, asset);
    const d1 = baseDerivative({ id: "d1", storageKey: "orgs/org_1/deriv/asset_1/w_10.jpg" });
    const d2 = baseDerivative({ id: "d2", storageKey: "orgs/org_1/deriv/asset_1/w_20.jpg" });
    derivativesStore.set(d1.id, d1);
    derivativesStore.set(d2.id, d2);

    await purgeAsset({ data: { assetId: asset.id } });

    expect(storageDelete).toHaveBeenCalledWith(d1.storageKey);
    expect(storageDelete).toHaveBeenCalledWith(d2.storageKey);
    expect(storageDelete).toHaveBeenCalledWith(asset.storageKey);
    expect(derivativesStore.size).toBe(0);
  });

  it("is a no-op when the asset does not exist", async () => {
    await purgeAsset({ data: { assetId: "missing" } });
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it("continues purging other objects when one storage delete fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const asset = baseAsset();
    assetsStore.set(asset.id, asset);
    const d1 = baseDerivative({ id: "d1", storageKey: "orgs/org_1/deriv/asset_1/w_10.jpg" });
    derivativesStore.set(d1.id, d1);
    storageDelete.mockRejectedValueOnce(new Error("s3 down")).mockResolvedValue(undefined);

    await expect(purgeAsset({ data: { assetId: asset.id } })).resolves.toBeUndefined();

    expect(storageDelete).toHaveBeenCalledWith(asset.storageKey);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
